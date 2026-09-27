import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverStock, parseNaver, parseYahoo, splitVolumeFactor } from '../tools/lib/recovery.mjs';
import { inspectStock } from '../src/lib/data-quality.js';
import { detectStock } from '../src/lib/engine.js';
import { baseline } from '../src/lib/stats.js';
import { sampleHits } from '../src/lib/build-snapshot.js';

function fixture() {
  const candles = Array.from({ length: 40 }, (_, i) => ({
    date: new Date(Date.UTC(2020, 0, i + 1)).toISOString().slice(0, 10),
    open: 10000 + i * 100, high: 10200 + i * 100, low: 9800 + i * 100, close: 10100 + i * 100, volume: 10000 + i * 100,
  }));
  return { original: { ticker: 'TEST.KS', name: '검증', market: 'KR', candles: structuredClone(candles) },
    yahoo: { candles: structuredClone(candles), splits: [] }, naver: structuredClone(candles) };
}
const run = (f) => recoverStock(f.original, f.yahoo, f.naver);

test('두 공급자 일치 시 봉을 수정하지 않으며 입력도 불변', () => {
  const f = fixture(), before = JSON.stringify(f), r = run(f);
  assert.equal(r.corrections.length, 0);
  assert.deepEqual(r.candidate.candles, f.original.candles);
  assert.equal(JSON.stringify(f), before);
  assert.equal(r.afterQuality.eligible, true);
});

test('당일 가격 2개 이상·주변 8봉 이상 확인 후 잘못된 종가와 거래량 복구', () => {
  const f = fixture();
  f.yahoo.candles[20].close = f.yahoo.candles[20].high + 1000;
  f.yahoo.candles[20].volume = 3;
  f.original.candles[20] = { ...f.yahoo.candles[20] };
  const r = run(f);
  assert.equal(r.corrections.length, 1);
  assert.deepEqual(r.candidate.candles[20], f.naver[20]);
  assert.ok(r.corrections[0].controls.length >= 8);
  assert.equal(r.afterQuality.eligible, true);
});

test('결측과 거래량 0 채움 봉을 복원하지만 실제 무거래일을 만들어 넣지 않는다', () => {
  const f = fixture(), absent = f.naver[20];
  f.original.candles.splice(20, 1); f.yahoo.candles.splice(20, 1);
  const placeholder = f.yahoo.candles[10];
  Object.assign(placeholder, { high: placeholder.open, low: placeholder.open, close: placeholder.open, volume: 0 });
  f.original.candles[10] = { ...placeholder };
  f.naver[21] = { ...f.naver[21], open: 0, high: 0, low: 0, volume: 0 };
  f.original.candles = f.original.candles.filter((c) => c.date !== f.naver[21].date);
  f.yahoo.candles = f.yahoo.candles.filter((c) => c.date !== f.naver[21].date);
  const r = run(f);
  assert.equal(r.corrections.find((c) => c.date === absent.date).reason, 'missing-session');
  assert.equal(r.corrections.find((c) => c.date === placeholder.date).reason, 'zero-volume-placeholder');
  assert.ok(!r.candidate.candles.some((c) => c.date === f.naver[21].date));
  assert.equal(r.candidate.candles.length, 39);
});

test('분할 후 누적 거래량 배율과 가격 단위를 별도로 검증한다', () => {
  const f = fixture();
  f.yahoo.splits = [{ date: '2021-01-01', ratio: 2 }];
  f.naver = f.naver.map((c) => ({ ...c, open: c.open * 2, high: c.high * 2, low: c.low * 2, close: c.close * 2, volume: c.volume / 2 }));
  f.yahoo.candles[20].close += 1000;
  const r = run(f);
  assert.equal(r.corrections[0].priceFactor, .5);
  assert.equal(r.corrections[0].volumeFactor, 2);
  assert.deepEqual(r.candidate.candles[20], f.original.candles[20]);
  assert.equal(splitVolumeFactor(f.yahoo.splits, '2021-01-01'), 1);
});

test('두 공급자가 확인한 무거래 표시만 제거하고, 불명확한 0 거래량은 격리한다', () => {
  const f = fixture();
  Object.assign(f.yahoo.candles[20], { open: 12000, high: 12000, low: 12000, close: 12000, volume: 0 });
  f.original.candles[20] = { ...f.yahoo.candles[20] };
  Object.assign(f.naver[20], { open: 0, high: 0, low: 0, close: 12000, volume: 0 });
  const r = run(f);
  assert.equal(r.removedNonTrading.length, 1);
  assert.equal(r.candidate.candles.length, 39);
  assert.equal(r.afterQuality.eligible, true);
  assert.equal(f.original.candles.length, 40);
  f.naver.splice(20, 1);
  const s = run(f);
  assert.equal(s.removedNonTrading.length, 0);
  assert.equal(s.candidate.candles.length, 40);
  assert.equal(s.afterQuality.eligible, false);
});

test('공식 공지로 확인한 휴장일은 공급자 행이 없어도 무거래 표시를 제거한다', () => {
  const f = fixture();
  for (const cs of [f.original.candles, f.yahoo.candles, f.naver]) {
    cs.forEach((c, i) => { c.date = new Date(Date.UTC(2015, 7, i + 1)).toISOString().slice(0, 10); });
  }
  f.yahoo.candles[13].volume = 0;
  f.original.candles[13].volume = 0;
  f.naver.splice(13, 1);
  const r = run(f);
  assert.equal(r.removedNonTrading[0].date, '2015-08-14');
  assert.equal(r.removedNonTrading[0].reason, 'official-market-closure');
  assert.equal(r.candidate.candles.length, 39);
});

test('조정 단위를 확인 못한 결측은 가격을 추정하지 않고 종목 전체를 격리', () => {
  const f = fixture(); f.naver = f.naver.map((c) => ({ ...c, volume: c.volume * 1.23 }));
  f.original.candles.splice(20, 1); f.yahoo.candles.splice(20, 1);
  const r = run(f);
  assert.equal(r.corrections.length, 0);
  assert.equal(r.afterQuality.issues.length, 0);
  assert.equal(r.afterQuality.sourceConcerns.length, 1);
  assert.equal(inspectStock(r.candidate).eligible, false);
  assert.ok(Object.values(detectStock(r.candidate)).every((hs) => hs.length === 0));
  assert.deepEqual(baseline([r.candidate]), baseline([]));
});

test('Naver의 1원 범위 오류를 클램핑해서 사용하지 않는다', () => {
  const f = fixture();
  f.naver[20].high = f.naver[20].close - 1;
  f.yahoo.candles[20].close += 1000;
  f.original.candles[20] = { ...f.yahoo.candles[20] };
  const r = run(f);
  assert.equal(r.corrections.length, 0);
  assert.equal(r.afterQuality.eligible, false);
  assert.deepEqual(r.candidate.candles[20], f.yahoo.candles[20]);
});

test('주변 단위가 달라지는 구간과 당일 가격 전체 불일치는 자동 교체 금지', () => {
  const f = fixture(); f.yahoo.candles[20].close += 1000;
  f.naver = f.naver.map((c, i) => i > 20 ? { ...c, open: c.open * 2, high: c.high * 2, low: c.low * 2, close: c.close * 2 } : c);
  const r = run(f);
  assert.ok(!r.corrections.some((c) => c.date === f.naver[20].date));
  assert.equal(r.afterQuality.eligible, false);
  const g = fixture();
  for (const key of ['open', 'high', 'low', 'close']) g.yahoo.candles[20][key] *= 2;
  const s = run(g);
  assert.equal(s.corrections.length, 0);
  assert.equal(s.afterQuality.eligible, false);
});

test('공급자 중복 날짜·잘못된 응답·실행 문자열을 거부한다', () => {
  const f = fixture(); f.naver.push(f.naver[0]);
  assert.throws(() => run(f), /중복/);
  assert.throws(() => parseNaver("[['날짜','시가','고가','저가','종가','거래량'],evil()]"));
  assert.throws(() => parseYahoo('{"chart":{"result":[]}}', 'TEST.KS'));
  assert.deepEqual(parseNaver("[['날짜','시가','고가','저가','종가','거래량'],['20200101',100,110,90,105,1000]]")[0],
    { date: '2020-01-01', open: 100, high: 110, low: 90, close: 105, volume: 1000 });
});

test('상승 신호 탐지는 이후 성공/실패와 무관하며 예시 표본도 결과로 고르지 않는다', () => {
  const f = fixture();
  // 상승 장악형: 첫 봉 이전 하락 추세, 20봉 평균보다 큰 장악 몸통.
  f.original.candles = Array.from({ length: 70 }, (_, i) => {
    const close = 20000 - Math.min(i, 30) * 100;
    return { ...f.original.candles[i % 40], date: new Date(Date.UTC(2020, 0, i + 1)).toISOString().slice(0, 10), open: close + 20, close, high: close + 40, low: close - 40 };
  });
  Object.assign(f.original.candles[30], { open: 17050, close: 17000, high: 17060, low: 16990 });
  Object.assign(f.original.candles[31], { open: 16980, close: 17200, high: 17210, low: 16970 });
  const up = structuredClone(f.original), down = structuredClone(f.original);
  for (let i = 32; i < 70; i++) for (const key of ['open', 'high', 'low', 'close']) {
    up.candles[i][key] += (i - 31) * 100;
    down.candles[i][key] -= (i - 31) * 100;
  }
  const a = detectStock(up)['bullish-engulfing'].find((h) => h.index === 31);
  const b = detectStock(down)['bullish-engulfing'].find((h) => h.index === 31);
  assert.ok(a && b); assert.ok(a.outcome.changePct > 0); assert.ok(b.outcome.changePct < 0);
  const hits = Array.from({ length: 500 }, (_, i) => ({ ticker: ['A', 'B'][i % 2], date: String(i).padStart(4, '0'), outcome: { changePct: i - 250 } }));
  const ids = (hs) => hs.map((h) => h.ticker + h.date);
  assert.deepEqual(ids(sampleHits(hits)), ids(sampleHits(hits.map((h) => ({ ...h, outcome: { changePct: -h.outcome.changePct } })))));
});
