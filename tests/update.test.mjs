import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { appendStock, stripUpdates, OVERLAP } from '../tools/lib/update.mjs';
import { expandStock } from '../src/lib/data-quality.js';

const day = (i) => new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
const bar = (i, k = 1) => ({ date: day(i), open: (10000 + i * 10) * k, high: (10200 + i * 10) * k, low: (9800 + i * 10) * k, close: (10100 + i * 10) * k, volume: 10000 + i });
function fixture(market = 'KR') {
  const base = { ticker: market === 'KR' ? 'TEST.KS' : 'TEST', name: '검증', market, currency: market === 'KR' ? 'KRW' : 'USD', type: 'stock', candles: Array.from({ length: 60 }, (_, i) => bar(i)) };
  const all = Array.from({ length: 70 }, (_, i) => bar(i));
  return { base, yahoo: { candles: structuredClone(all), splits: [] }, naver: structuredClone(all) };
}

test('갱신: 겹치는 40봉이 같으면 마지막 날 뒤, until 까지의 봉만 덧붙인다', () => {
  const f = fixture(), r = appendStock(f.base, f.yahoo, f.naver, day(65));
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.added.map((c) => c.date), [60, 61, 62, 63, 64, 65].map(day));
  const us = fixture('US'), u = appendStock(us.base, us.yahoo, null, day(69));
  assert.equal(u.status, 'ok'); assert.equal(u.added.length, 10);
});

test('갱신: 과거 가격이 바뀌었거나(분할 등) 새 봉 대조가 실패하면 덧붙이지 않고 멈춘다', () => {
  const split = fixture(); split.yahoo.splits = [{ date: day(50), ratio: 2 }];
  assert.equal(appendStock(split.base, split.yahoo, split.naver, day(69)).status, 'stop');
  const changed = fixture('US'); changed.yahoo.candles = changed.yahoo.candles.map((c, i) => (i < 60 ? bar(i, 0.5) : c));
  assert.match(appendStock(changed.base, changed.yahoo, null, day(69)).reason, /겹치는 기존 봉/);
  const mismatch = fixture(); mismatch.naver[65] = { ...mismatch.naver[65], open: 1, high: 2, low: 1, close: 2 };
  mismatch.yahoo.candles[65] = { ...mismatch.yahoo.candles[65], close: mismatch.yahoo.candles[65].high + 500 };
  assert.equal(appendStock(mismatch.base, mismatch.yahoo, mismatch.naver, day(69)).status, 'stop');
  assert.ok(OVERLAP >= 20);
});

test('갱신 기록을 지우면 덧붙이기 전 파일과 바이트 단위로 같다', () => {
  const raw = JSON.parse(fs.readFileSync(new URL('../data/stocks/005930.KS.json', import.meta.url)));
  assert.ok(raw.updates?.length, '삼성전자는 2026-11-19 에 덧붙였다');
  const base = stripUpdates(raw), u = raw.updates[0];
  assert.equal(base.candles.length, u.baseCount);
  assert.equal(base.candles.at(-1)[0], u.baseTo);
  assert.equal(raw.candles.length, u.baseCount + u.added);
  assert.equal('updates' in base, false);
  assert.deepEqual(Object.keys(base), Object.keys(raw).filter((k) => k !== 'updates'));
  // 덧붙인 봉은 마지막 날 뒤이고 날짜 순서대로다.
  const s = expandStock(raw);
  for (let i = 1; i < s.candles.length; i++) assert.ok(s.candles[i].date > s.candles[i - 1].date);
});
