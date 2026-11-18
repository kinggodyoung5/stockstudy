import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openCourseCase, courseContext, makeCourseQuestion } from '../src/lib/chart-course.js';
import { expandStock } from '../src/lib/data-quality.js';
import { pivots, sma, closes, resample } from '../src/lib/indicators.js';
import { rsi } from '../src/lib/oscillators.js';
import { divergenceCondition } from '../src/lib/signal-conditions.js';
import { detectOscillatorPatterns } from '../src/lib/patterns-oscillator.js';
import { candleEvidence } from '../src/lib/candlestick.js';
import { lineAt, trendlineCase } from '../src/lib/course-topics/trendline.js';
import { zoneTouches } from '../src/lib/course-topics/sr-level.js';
import { stateOf } from '../src/lib/course-topics/mtf.js';
import { priorHigh, retestBase } from '../src/lib/course-topics/breakout.js';
import { divergencePair } from '../src/lib/course-topics/divergence.js';

const read = (file) => JSON.parse(fs.readFileSync(new URL('../' + file, import.meta.url)));
const course = read('data/chart-course.json');
const cache = new Map();
const stockOf = (t) => cache.get(t) || cache.set(t, expandStock(read(`data/stocks/${t}.json`))).get(t);
const casesOf = (type) => course.cases.filter((r) => r.type === type);
const open = (ref) => {
  const s = stockOf(ref.ticker), i = s.candles.findIndex((c) => c.date === ref.date);
  return { s, i, cs: s.candles.slice(0, i + 1), q: openCourseCase(s, ref).question };
};

test('추세선: 선 값은 두 점을 지나는 직선이고, 세 조건이 차트 값과 일치한다', () => {
  assert.equal(lineAt(10, 100, 20, 110, 30), 120);
  for (const ref of casesOf('trendline')) {
    const { cs, i, q } = open(ref), up = ref.bucket.startsWith('up');
    const t = trendlineCase(cs, i, up ? 'up' : 'down');
    assert.ok(t, ref.date);
    assert.equal(q.markers[0].date, cs[t.k1].date); assert.equal(q.markers[1].date, cs[t.k2].date);
    // 두 점은 좌우 3봉 기준 극점이며 오른쪽 3봉이 오늘 안에 있다.
    assert.ok(t.k2 + 3 <= i);
    const status = ref.bucket.split(':')[1];
    const anyBreak = cs.slice(t.k2 + 1).some((c, d) => (up ? c.close < t.at(t.k2 + 1 + d) : c.close > t.at(t.k2 + 1 + d)));
    if (status === 'pass') { assert.ok(t.touch >= 0); assert.equal(anyBreak, false); }
    if (status === 'pending') { assert.equal(t.touch, -1); assert.equal(anyBreak, false); }
    if (status === 'fail') assert.ok(anyBreak || !t.between);
  }
});

test('가격대: 반응 횟수는 가격대 ±1.5% 안의 확인된 극점 수이고, 극점 날짜는 제출 뒤에만 표시한다', () => {
  for (const ref of casesOf('sr-level')) {
    const { cs, i, q } = open(ref), level = q.lines[0].value;
    const touches = zoneTouches(cs, i - 119, i, level);
    assert.equal(touches.length >= 3, ref.bucket === '2' || ref.bucket === '3', ref.date);
    assert.equal(q.revealMarkers.length, touches.length);
    assert.equal(q.markers.length, 0);
    assert.ok(!JSON.stringify(q.facts).includes(cs[touches[0]].date), '비교 값에 극점 날짜를 넣지 않는다');
    assert.ok(Math.abs(cs[i].close - level) / level * 100 > 1.5);
  }
});

test('주봉과 일봉: 진행 중일 수 있는 마지막 주를 빼고, 주봉 평균은 완료된 주봉으로만 계산한다', () => {
  for (const ref of casesOf('mtf')) {
    const { cs, i, q } = open(ref);
    const weeks = resample(cs, 'week').slice(0, -1), w = sma(closes(weeks), 20), k = weeks.length - 1;
    assert.equal(q.focusDate, weeks.at(-1).date); assert.ok(q.focusDate < ref.date);
    assert.deepEqual(q.weeklyHistory, weeks);
    const weekly = stateOf(weeks[k].close, w[k], w[k - 4]);
    const m20 = sma(closes(cs), 20), daily = stateOf(cs[i].close, m20[i], m20[i - 5]);
    const expected = weekly === 'mixed' || daily === 'mixed' ? 'mixed' : weekly[0] + daily[0];
    assert.equal(ref.bucket, expected, ref.date);
  }
});

test('돌파 뒤 되돌림: 돌파일은 3~15봉 전이고, 그 앞 5봉에는 다른 돌파가 없다', () => {
  for (const ref of casesOf('retest')) {
    const { cs, i, q } = open(ref), b = retestBase(cs, i);
    assert.ok(b >= i - 15 && b <= i - 3);
    assert.equal(q.markers[0].date, cs[b].date);
    assert.equal(q.lines[0].value, priorHigh(cs, b));
    const after = cs.slice(b + 1), L = priorHigh(cs, b);
    const state = after.some((c) => c.close < L) ? 'fail' : after.some((c) => c.low < L * 1.01) ? 'retest' : 'hold';
    assert.equal(ref.bucket, state);
  }
});

test('다이버전스: 탐지기와 같은 조건 함수로 판정하고, 충족 사례는 탐지기도 같은 두 극점을 본다', () => {
  for (const ref of casesOf('divergence')) {
    const { s, cs, i, q } = open(ref), bullish = ref.bucket.startsWith('bull');
    const pair = divergencePair(cs, i, bullish), series = rsi(closes(cs));
    const cond = divergenceCondition('rsi', cs, series, pair.i1, pair.i2, bullish);
    const status = ref.bucket.split(':')[1];
    assert.equal(cond.gapOk, true);
    if (status === 'pass') { assert.ok(cond.pass); assert.ok(pair.confirmed); }
    if (status === 'pending') { assert.ok(cond.priceOk && cond.indOk && cond.magnitude.passes); assert.equal(pair.confirmed, false); }
    if (status === 'fail') assert.equal(cond.priceOk && cond.indOk && cond.magnitude.passes, false);
    if (status === 'pass') {
      // 확인일(둘째 극점 + 5봉)까지 자른 자료로 탐지기를 돌리면 같은 날짜가 잡히거나, 30봉 안의 앞 신호 때문에 빠진다.
      const prefix = { ...s, candles: cs };
      const hits = detectOscillatorPatterns(prefix)[bullish ? 'rsi-bullish-divergence' : 'rsi-bearish-divergence'];
      const found = hits.some((h) => h.date === cs[pair.i2].date);
      const suppressed = hits.some((h) => h.index < pair.i2 && pair.i2 - h.index < 30);
      assert.ok(found || suppressed, ref.date);
    }
  }
});

test('같은 모양, 다른 자리: 정답이 캔들 탐지기의 망치형·교수형 판정과 같다', () => {
  for (const ref of casesOf('candle-context')) {
    const { cs, i } = open(ref);
    assert.equal(!!candleEvidence('hammer', cs, i), ref.bucket === 'down');
    assert.equal(!!candleEvidence('hanging-man', cs, i), ref.bucket === 'up');
  }
});

test('새 유형 일곱 개: 오늘 뒤의 봉을 크게 바꿔도 문제·정답·제출 뒤 표시가 같다', () => {
  for (const type of ['trendline', 'sr-level', 'retest', 'mtf', 'breakout-volume', 'divergence', 'candle-context']) {
    for (const ref of casesOf(type).slice(0, 3)) {
      const s = stockOf(ref.ticker), i = s.candles.findIndex((c) => c.date === ref.date);
      const warped = s.candles.map((c, j) => (j <= i ? c : { ...c, open: c.open * 2, high: c.high * 3, low: c.low * 0.4, close: c.close * 0.5, volume: c.volume * 9 + 1 }));
      assert.deepEqual(makeCourseQuestion(courseContext(warped), i, type), makeCourseQuestion(courseContext(s.candles.slice(0, i + 1)), i, type), type);
    }
  }
});
