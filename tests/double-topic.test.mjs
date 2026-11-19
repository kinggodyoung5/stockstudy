import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { expandStock } from '../src/lib/data-quality.js';
import { courseContext, makeCourseQuestion } from '../src/lib/chart-course.js';
import { detectShapePatterns } from '../src/lib/patterns-shape.js';
import { diagnose } from '../src/lib/course-feedback.js';
import { DOUBLE, doubleCase } from '../src/lib/course-topics/double.js';

const load = (t) => expandStock(JSON.parse(fs.readFileSync(new URL(`../data/stocks/${t}.json`, import.meta.url))));
const TICKERS = ['005930.KS', '000660.KS', 'AAPL', '035720.KS', '051910.KS'];

test('이중 천장·바닥: "모든 조건 충족"은 탐지기가 같은 날 이중 천장·바닥을 검출한 날뿐이다', () => {
  let passes = 0;
  for (const t of TICKERS) {
    const s = load(t), ctx = courseContext(s.candles), det = detectShapePatterns(s);
    const hits = { top: new Set(det['double-top'].map((h) => h.date)), bottom: new Set(det['double-bottom'].map((h) => h.date)) };
    for (let i = 120; i < s.candles.length; i++) {
      const q = makeCourseQuestion(ctx, i, 'double');
      if (!q) continue;
      const [kind, status] = q.bucket.split(':');
      // 조건표의 종합 판정과 정답이 같다.
      assert.equal(diagnose(q, q.answer).truth, status);
      if (status !== 'pass') continue;
      passes++;
      assert.ok(hits[kind].has(s.candles[i].date), `${t} ${s.candles[i].date} ${kind}`);
    }
  }
  assert.ok(passes > 0);
});

test('이중 천장·바닥: 오늘 뒤의 봉을 바꿔도 후보와 조건이 그대로이고, 이탈이 이미 지난 날은 내지 않는다', () => {
  const s = load('005930.KS');
  let checked = 0;
  for (let i = 400; i < s.candles.length - 40 && checked < 30; i++) {
    const d = doubleCase(s.candles, i, true);
    if (!d) continue;
    checked++;
    const changed = s.candles.map((c, k) => (k > i ? { ...c, close: c.close * 3, low: c.low * 0.1, high: c.high * 3 } : c));
    assert.deepEqual(doubleCase(changed, i, true), d);
    assert.ok(i >= d.p2 + DOUBLE.pivotWidth && i <= d.p2 + DOUBLE.breakWithin);
    for (let k = d.p2 + DOUBLE.pivotWidth; k < i; k++) assert.ok(s.candles[k].close >= d.neckline);
  }
  assert.ok(checked > 0);
});
