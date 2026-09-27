import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { alignedSeries, historyThrough, closeDrawdown, pickCases, invalidCandles } from '../src/lib/chart-data.js';
import { sma, closes, ichimoku } from '../src/lib/indicators.js';
import { rsi, OSCILLATORS } from '../src/lib/oscillators.js';
import { createStockChart, createOscillatorPanel } from '../src/lib/chart.js';
import { buildPractice, makeCandles, recordAttempt } from '../src/content/practice.js';
import { LESSON_BY_ID, LESSONS } from '../src/content/lessons.js';
import { CURRICULUM } from '../src/content/foundations.js';
import { defaultBenchmark } from '../src/lib/data.js';

const json = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const stocks = new Map();
function stock(ticker) {
  if (!stocks.has(ticker)) {
    const s = json('../data/stocks/' + ticker.replaceAll('^', '_') + '.json');
    stocks.set(ticker, s.format === 2 ? s.candles.map((r) => Object.fromEntries(s.fields.map((k, i) => [k, r[i]]))) : s.candles);
  }
  return stocks.get(ticker);
}

test('표시 구간이 짧아도 MA60·구름대 값은 전체 이력과 일치한다 (저장 사례 전수)', () => {
  for (const id of ['golden-cross', 'ma-alignment', 'cloud-breakout']) {
    const hits = json(`../data/patterns/${id}.json`).hits;
    assert.ok(hits.length > 0);
    for (const hit of hits) {
      const all = stock(hit.ticker);
      const view = all.filter((c) => c.date >= hit.fromDate && c.date <= hit.toDate);
      const history = historyThrough(view, all);
      const values = id === 'cloud-breakout' ? ichimoku(history).spanB : sma(closes(history), 60);
      const full = id === 'cloud-breakout' ? ichimoku(all).spanB : sma(closes(all), 60);
      const signal = alignedSeries(view, history, values).find((p) => p.time === hit.date);
      assert.ok(Number.isFinite(signal?.value), `${id} ${hit.ticker} ${hit.date}`);
      assert.equal(signal.value, full[all.findIndex((c) => c.date === hit.date)]);
    }
  }
});

test('RSI는 잘린 구간에서 초기화하지 않고 전체 이력 값을 표시한다', () => {
  for (const hit of json('../data/patterns/rsi-bullish-divergence.json').hits) {
    const all = stock(hit.ticker);
    const view = all.filter((c) => c.date >= hit.fromDate && c.date <= hit.toDate);
    const history = historyThrough(view, all);
    const values = alignedSeries(view, history, rsi(closes(history), 14));
    const expected = rsi(closes(all), 14);
    for (const p of values) assert.equal(p.value, expected[all.findIndex((c) => c.date === p.time)] ?? undefined);
  }
});

test('끝 날짜 이후 데이터 차단 + 초기 결측도 시간축 날짜 유지', () => {
  const all = makeCandles([100, 102, 101, 110]);
  const view = all.slice(0, 3);
  const history = historyThrough(view, all);
  assert.equal(history.length, 3);
  assert.deepEqual(alignedSeries(view, history, sma(closes(history), 3)), [
    { time: all[0].date }, { time: all[1].date }, { time: all[2].date, value: 101 },
  ]);
  assert.deepEqual(historyThrough([], all), []);
});

test('실제 차트 래퍼가 별도 계산 이력을 전달하고 패널 날짜를 맞춘다', () => {
  const captured = [];
  const series = () => ({ setData: (data) => captured.push(data), applyOptions() {}, createPriceLine() {} });
  const fake = { addCandlestickSeries: series, addHistogramSeries: series, addLineSeries: series,
    priceScale: () => ({ applyOptions() {} }), applyOptions() {}, remove() {} };
  const oldWindow = globalThis.window;
  const oldObserver = globalThis.ResizeObserver;
  globalThis.window = { LightweightCharts: { createChart: () => fake } };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  try {
    const all = makeCandles(Array.from({ length: 100 }, (_, i) => 100 + Math.sin(i) * 5 + i));
    const view = all.slice(80, 90);
    const box = { clientWidth: 800, clientHeight: 300 };
    const chart = createStockChart(box);
    chart.setOverlays({ ma60: true });
    chart.setCandles(view, all);
    const expected = sma(closes(all), 60).slice(80, 90);
    assert.deepEqual(captured.at(-1).map((p) => p.value), expected);
    const panel = createOscillatorPanel(box, OSCILLATORS.rsi, view, undefined, all);
    assert.deepEqual(captured.at(-1).map((p) => p.value), rsi(closes(all), 14).slice(80, 90));
    chart.destroy(); panel.destroy();
  } finally { globalThis.window = oldWindow; globalThis.ResizeObserver = oldObserver; }
});

test('종가 낙폭은 동일 봉 고저 순서를 가정하지 않는다', () => {
  const cs = makeCandles([100, 120, 90, 110]);
  cs[0].high = 1000; cs[0].low = 1;
  assert.equal(closeDrawdown(cs), -25);
  assert.equal(closeDrawdown([cs[0]]), 0);
  assert.equal(closeDrawdown([]), 0);
});

test('사례 순환은 종목과 사례 전체를 방문하고 중복 선택하지 않는다', () => {
  const hits = [{ ticker: 'A', n: 1 }, { ticker: 'A', n: 2 }, { ticker: 'B', n: 1 }, { ticker: 'C', n: 1 }];
  assert.deepEqual(pickCases(hits, 2).map((h) => h.ticker), ['A', 'B']);
  assert.deepEqual(pickCases(hits, 2, 2).map((h) => h.ticker), ['C', 'A']);
  assert.equal(new Set(pickCases(hits, 10)).size, 4);
  assert.deepEqual(pickCases([], 2), []);
});

test('원자료 오류 검출은 가격을 임의 보정하지 않는다', () => {
  const good = makeCandles([100])[0];
  const bad = { ...good, close: good.high + 1 };
  const before = JSON.stringify(bad);
  assert.deepEqual(invalidCandles([good, bad]), [bad]);
  assert.equal(JSON.stringify(bad), before);
});

test('기초 레슨·과정·문제 참조와 모든 수치 변형이 유효하다', () => {
  assert.equal(new Set(LESSONS.map((l) => l.id)).size, LESSONS.length);
  CURRICULUM.forEach((s) => assert.ok(LESSON_BY_ID[s.lesson]));
  for (let v = 0; v < 20; v++) {
    const bank = buildPractice(v);
    assert.equal(bank.length, 12);
    assert.equal(new Set(bank.map((q) => q.id)).size, 12);
    bank.forEach((q) => {
      assert.ok(LESSON_BY_ID[q.lesson]);
      assert.ok(q.options[q.answer]);
      assert.ok(q.explanation.length > 30);
      if (q.candles) assert.equal(invalidCandles(q.candles).length, 0);
    });
    const candle = bank[0].candles.at(-1);
    assert.ok(candle.close > candle.open && candle.close < bank[0].candles[0].close);
  }
});

test('첫 시도 점수는 재시도로 덮어쓰지 않고 오답은 즉시 복습한다', () => {
  const first = recordAttempt(null, { correct: false, reason: '시가와 전일 종가를 혼동했다', confidence: 'sure' }, 1000);
  const retry = recordAttempt(first, { correct: true, reason: '이번에는 시가와 비교했다', confidence: 'unsure' }, 2000);
  assert.equal(first.dueAt, 1000);
  assert.equal(retry.firstCorrect, false);
  assert.equal(retry.correct, 1);
  assert.equal(retry.attempts, 2);
  assert.equal(retry.dueAt, 2000 + 86400000);
  assert.equal(first.reason, '시가와 전일 종가를 혼동했다');
});

test('한국 시장 기본 비교 지수를 거래소에 맞춰 고른다', () => {
  assert.equal(defaultBenchmark('KR', '328130.KQ'), '^KQ11');
  assert.equal(defaultBenchmark('KR', '005930.KS'), '^KS11');
  assert.equal(defaultBenchmark('US', 'AAPL'), '^GSPC');
});
