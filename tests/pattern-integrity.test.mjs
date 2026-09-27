import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { expandStock, inspectStock } from '../src/lib/data-quality.js';
import { trendBeforePattern, divergenceMagnitude, retracementDepth } from '../src/lib/pattern-context.js';
import { assertSnapshotVersion } from '../src/lib/data.js';
import { formatEvidence } from '../src/lib/ui.js';
import { detectCandlePatterns, CANDLE_PATTERNS } from '../src/lib/candlestick.js';
import { divergence, detectOscillatorPatterns } from '../src/lib/patterns-oscillator.js';
import { detectStock, ALL_PATTERN_IDS } from '../src/lib/engine.js';
import { summarize, baseline, baselineBy } from '../src/lib/stats.js';
import { outcomeAt } from '../src/lib/outcome.js';
import { buildSnapshot, sampleHits, RULES_VERSION } from '../src/lib/build-snapshot.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8'));
const candle = (i, close, open = close + 1) => ({ date: new Date(Date.UTC(2020, 0, i + 1)).toISOString().slice(0, 10),
  open, close, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, volume: 100 });
const stock = (candles, ticker = 'TEST') => ({ candles, ticker, name: ticker, market: 'US', currency: 'USD' });
const mirror = (cs) => cs.map((c) => ({ ...c, open: 400 - c.open, close: 400 - c.close, high: 400 - c.low, low: 400 - c.high }));

test('근거 표시: 몸통 비·DI·포인트는 달러가 아니며 실제 가격만 통화 표시', () => {
  for (const label of ['2봉 몸통 ÷ 1봉 몸통', '+DI', '−DI', 'RSI 차이(포인트)', 'OBV 값 1']) {
    assert.equal(formatEvidence({ label, value: .1129 }, 'USD'), '0.1129');
  }
  assert.equal(formatEvidence({ label: '1봉 몸통', value: .62 }, 'USD'), '$0.62');
  assert.equal(formatEvidence({ label: '표시값', value: 5, unit: 'points' }, 'USD'), '5');
  assert.equal(formatEvidence({ label: '비율', value: null }, 'USD'), '—');
});

test('이중·삼중 패턴 깊이는 넥라인이 아닌 고점·저점 기준이다', () => {
  assert.equal(retracementDepth([98, 100], 90, true), 10);
  assert.ok(retracementDepth([98, 100], 90.1, true) < 10);
  assert.equal(retracementDepth([100, 104], 110, false), 10);
  assert.ok(retracementDepth([100, 104], 109.9, false) < 10);
});

test('로더는 구버전 또는 서로 다른 원자료·생성일의 스냅샷 혼용을 차단한다', () => {
  const index = { generatedAt: '2026-09-23', provenance: { rulesVersion: RULES_VERSION, sourceDigest: 'abc' } };
  assert.doesNotThrow(() => assertSnapshotVersion(index));
  assert.doesNotThrow(() => assertSnapshotVersion(structuredClone(index), index));
  assert.throws(() => assertSnapshotVersion({}), /버전/);
  assert.throws(() => assertSnapshotVersion({ ...index, generatedAt: '2026-09-22' }, index), /버전/);
  assert.throws(() => assertSnapshotVersion({ ...index, provenance: { ...index.provenance, sourceDigest: 'other' } }, index), /버전/);
  assert.throws(() => assertSnapshotVersion({ ...index, provenance: { ...index.provenance, rulesVersion: 'old' } }), /버전/);
});

test('선행 추세는 첫 패턴 봉 이전에 끝나며 충분한 이력이 필요하다', () => {
  const cs = Array.from({ length: 40 }, (_, i) => candle(i, 150 - i));
  const before = trendBeforePattern(cs, 30);
  cs[30].close = 1000; cs[31].close = 1;
  assert.equal(trendBeforePattern(cs, 30), before);
  assert.equal(before, (121 / 131 - 1) * 100);
  assert.equal(trendBeforePattern(cs, 10), null);
});

test('샛별·석별: 같은 3봉 모양도 선행 추세가 없으면 반전 사례로 세지 않는다', () => {
  const prefix = Array.from({ length: 30 }, (_, i) => candle(i, 150 - i * .8));
  const star = [
    { ...candle(30, 116, 126), high: 127, low: 115 },
    { ...candle(31, 115, 114), high: 115.5, low: 113 },
    { ...candle(32, 122, 115), high: 123, low: 114 },
  ];
  const cs = [...prefix, ...star];
  assert.equal(detectCandlePatterns(stock(cs))['morning-star'].some((h) => h.index === 32), true);
  assert.equal(detectCandlePatterns(stock(mirror(cs)))['evening-star'].some((h) => h.index === 32), true);
  const flat = [...prefix.map((c) => ({ ...c, open: 131, close: 130, high: 132, low: 129 })), ...star];
  assert.equal(detectCandlePatterns(stock(flat))['morning-star'].length, 0);
  assert.equal(detectCandlePatterns(stock(mirror(flat)))['evening-star'].length, 0);
  assert.ok(CANDLE_PATTERNS['morning-star'].rules.some((r) => r.includes('패턴 첫 봉 전일')));
});

test('망치형의 당일 급락을 선행 하락 추세로 잘못 세지 않는다', () => {
  const cs = Array.from({ length: 30 }, (_, i) => candle(i, 130));
  cs.push({ ...candle(30, 101, 100), high: 101.2, low: 96 });
  assert.equal(detectCandlePatterns(stock(cs)).hammer.length, 0);
});

test('지표 크기 필터: OBV 상수 이동·거래량 배율 불변, 0 분모 차단', () => {
  const cs = Array.from({ length: 3 }, (_, i) => candle(i, 100));
  const a = divergenceMagnitude('obv', cs, [0, 4, 10], 0, 2);
  assert.equal(a.value, 5); assert.equal(a.passes, true);
  assert.deepEqual(divergenceMagnitude('obv', cs, [-1000, -996, -990], 0, 2), a);
  assert.deepEqual(divergenceMagnitude('obv', cs.map((c) => ({ ...c, volume: c.volume * 10 })), [0, 40, 100], 0, 2), a);
  assert.equal(divergenceMagnitude('obv', cs.map((c) => ({ ...c, volume: 0 })), [0, 0, 0], 0, 2).passes, false);
  assert.equal(divergenceMagnitude('obv', cs, [0, 0, 9.99], 0, 2).passes, false);
});

test('MACD의 미세한 0선 횡단은 통과하지 않으며 가격 단위 배율에 불변', () => {
  const cs = [candle(0, 100), candle(1, 100)];
  assert.equal(divergenceMagnitude('macd', cs, [-.000001, .000001], 0, 1).passes, false);
  const a = divergenceMagnitude('macd', cs, [-.05, .05], 0, 1);
  assert.equal(a.value, .1); assert.equal(a.passes, true);
  assert.equal(divergenceMagnitude('macd', cs.map((c) => ({ ...c, close: c.close * 10 })), [-.5, .5], 0, 1).value, a.value);
  assert.equal(divergenceMagnitude('rsi', cs, [20, 24.9], 0, 1).passes, false);
  assert.equal(divergenceMagnitude('rsi', cs, [20, 25], 0, 1).passes, true);
});

test('OBV 탐지 결과도 시작 누적값 변경에 불변이며 확인일 이전에는 확정하지 않는다', () => {
  const cs = Array.from({ length: 65 }, (_, i) => candle(i, 110 + i * .02));
  cs[15].low = 90; cs[40].low = 85;
  const values = cs.map((_, i) => i * 10);
  const a = divergence(stock(cs), values, true, 'OBV', 'obv');
  assert.ok(a.length > 0);
  const b = divergence(stock(cs), values.map((v) => v + 1000000), true, 'OBV', 'obv');
  assert.deepEqual(a.map((h) => h.date), b.map((h) => h.date));
  assert.equal(a[0].confirmDate, cs[45].date);
  assert.equal(a[0].outcome.fromDate, cs[45].date);
  assert.equal(divergence(stock(cs.slice(0, 45)), values.slice(0, 45), true, 'OBV', 'obv').length, 0);
});

test('실제 OBV 사례: 앞 500봉 제거 후 충분히 지난 공통 구간의 판정 일치', () => {
  for (const ticker of ['AAPL', 'MSFT', 'NVDA', 'GOOGL']) {
    const s = expandStock(read(`data/stocks/${ticker}.json`));
    const cut = 500;
    const a = detectOscillatorPatterns(s);
    const b = detectOscillatorPatterns({ ...s, candles: s.candles.slice(cut) });
    for (const id of ['obv-bullish-divergence', 'obv-bearish-divergence']) {
      assert.deepEqual(a[id].filter((h) => h.index > cut + 120).map((h) => h.date), b[id].filter((h) => h.index > 120).map((h) => h.date), ticker + id);
    }
  }
});

test('불완전 결과는 모든 통계 항목에서 제외하고 기준 종가 대비 극값을 보존한다', () => {
  const cs = Array.from({ length: 40 }, (_, i) => candle(i, 100 + i));
  const complete = { outcome: outcomeAt(cs, 0) };
  const partial = { outcome: { ...outcomeAt(cs, 35), changePct: 999, maxUpPct: 999, maxDownPct: -999 } };
  assert.deepEqual(summarize([complete, partial, { outcome: null }]), summarize([complete]));
  assert.equal(summarize([partial]), null);
  assert.equal(complete.outcome.maxUpPct, 22);
  assert.equal(summarize([complete]).samples, 1);
});

test('데이터 격리는 원본·날짜를 바꾸지 않고 검출과 기준선에 같은 정책을 적용한다', () => {
  const cs = Array.from({ length: 60 }, (_, i) => candle(i, 100 + i));
  const good = stock(cs, 'GOOD');
  const bad = stock(cs.map((c) => ({ ...c })), 'BAD');
  bad.candles[30].low = bad.candles[30].high + 1;
  const raw = JSON.stringify(bad);
  assert.equal(inspectStock(bad).eligible, false);
  assert.ok(Object.values(detectStock(bad)).every((hs) => hs.length === 0));
  assert.deepEqual(baseline([good, bad]), baseline([good]));
  assert.deepEqual(baselineBy([good, bad], 20, () => 'one'), baselineBy([good], 20, () => 'one'));
  assert.equal(JSON.stringify(bad), raw);
  good.candles[0].volume = 0;
  assert.equal(inspectStock(good).eligible, true);
  const duplicate = stock([cs[0], cs[0]]);
  assert.equal(inspectStock(duplicate).eligible, false);
});

test('생성기는 격리·완전 관측수·규칙 버전을 함께 기록하며 입력을 변경하지 않는다', () => {
  const good = stock(Array.from({ length: 100 }, (_, i) => candle(i, 100 + i + Math.sin(i) * 3)), 'GOOD');
  const bad = stock([{ ...candle(0, 100), volume: -1 }], 'BAD');
  const before = JSON.stringify([good, bad]);
  const opts = { generatedAt: '2026-09-23', sourceDigest: 'test', sourceManifest: [] };
  const a = buildSnapshot([good, bad], opts);
  assert.equal(a.index.quality.quarantinedStocks, 1);
  assert.deepEqual(a.index.eligibleTickers, ['GOOD']);
  assert.equal(a.index.provenance.rulesVersion, RULES_VERSION);
  assert.deepEqual(a, buildSnapshot([good, bad], opts));
  assert.equal(JSON.stringify([good, bad]), before);
  assert.throws(() => buildSnapshot([bad], opts), /기존 결과/);
  for (const p of Object.values(a.payloads)) {
    assert.equal(p.count, p.observation.complete + p.observation.partial + p.observation.pending);
    assert.equal(p.stats?.samples || 0, p.observation.complete);
  }
});

test('샘플링은 결정적이며 종목·시기를 분산하고 원본 정렬을 바꾸지 않는다', () => {
  const hits = Array.from({ length: 400 }, (_, i) => ({ ticker: ['A', 'B', 'C'][i % 3], date: candle(i, 100).date }));
  const a = sampleHits(hits);
  assert.equal(a.length, 150); assert.equal(new Set(a).size, 150);
  assert.equal(new Set(a.map((h) => h.ticker)).size, 3);
  assert.deepEqual(a, sampleHits([...hits].reverse()));
});

test('생성된 57개 파일: 원자료 해시·격리·표본수·버전·요약 일관성', () => {
  const index = read('data/patterns/_index.json');
  const quality = read('data/patterns/_quality.json');
  assert.equal(index.provenance.rulesVersion, RULES_VERSION);
  assert.equal(index.patterns.length, ALL_PATTERN_IDS.length);
  for (const entry of quality.sourceManifest) {
    const bytes = fs.readFileSync(new URL('../data/stocks/' + entry.ticker + '.json', import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, entry.ticker);
  }
  for (const row of index.patterns) {
    const p = read(`data/patterns/${row.pattern}.json`);
    assert.deepEqual(p.stats, row.stats);
    assert.deepEqual(p.provenance, index.provenance);
    assert.equal(p.stats?.samples || 0, p.observation.complete);
    assert.equal(p.count, Object.values(p.observation).reduce((a, b) => a + b, 0));
    for (const axis of Object.values(p.byAxis)) assert.equal(Object.values(axis).reduce((n, b) => n + (b?.stats?.samples || 0), 0), p.observation.complete);
    for (const h of p.hits) assert.ok(index.eligibleTickers.includes(h.ticker));
  }
});
