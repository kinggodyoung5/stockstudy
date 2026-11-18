import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { planError, planMetrics, sizeFor, planNotices, planOutcome, simulateExpectancy } from '../src/lib/plan.js';
import { CAPSTONE_PARTS, CAPSTONE_SOURCES, NOTE_FIELDS, capstoneRefs, capstoneId, openCapstone, revealWindow, capstoneRecord,
  capstoneOutcome, capstoneReview, capstoneSummary } from '../src/lib/capstone.js';
import { courseContext, makeCourseQuestion } from '../src/lib/chart-course.js';
import { expandStock } from '../src/lib/data-quality.js';
import { weakReads } from '../src/lib/review.js';
import { buildBackup, parseBackup, planImport } from '../src/lib/backup.js';

const read = (file) => JSON.parse(fs.readFileSync(new URL('../' + file, import.meta.url)));
const course = read('data/chart-course.json');
const cache = new Map();
const stockOf = (t) => cache.get(t) || cache.set(t, expandStock(read(`data/stocks/${t}.json`))).get(t);
const bar = (date, open, high, low, close) => ({ date, open, high, low, close, volume: 1000 });

test('계획 계산: 거리·손익비·수량을 계산하고, 좋고 나쁨은 판정하지 않는다', () => {
  assert.equal(planError({ close: 100, invalid: 100 }), '매수 계획에서 무효 가격은 현재가보다 낮아야 합니다.');
  assert.match(planError({ close: 100, invalid: 95, target: 90 }), /지켜볼 가격/);
  assert.equal(planError({ close: 100, invalid: 95, target: null }), null);
  const m = planMetrics({ close: 50000, atr: 1250, invalid: 47500, target: 58000 });
  assert.equal(m.riskPct, 5); assert.equal(m.riskAtr, 2); assert.equal(m.ratio, 3.2); assert.equal(m.rewardPct, 16);
  assert.deepEqual(sizeFor({ account: 10_000_000, riskPercent: 1, close: 50000, invalid: 47500 }), { budget: 100000, shares: 40, amount: 2_000_000, loss: 100000 });
  assert.equal(sizeFor({ account: 1000, riskPercent: 1, close: 100, invalid: 97 }).shares, 3);   // 10 ÷ 3 = 3.33 → 내림
  assert.deepEqual(planNotices({ riskAtr: 2, ratio: 3 }), []);
  assert.equal(planNotices({ riskAtr: 0.5, ratio: 0.8 }).length, 2);
  assert.equal(planMetrics({ close: 100, atr: 2, invalid: 95 }).ratio, null);
});

test('계획 결과: 먼저 닿은 쪽, 같은 봉에서 둘 다 닿으면 알 수 없음, 갭으로 건너뛴 날, 자료가 모자라면 끝까지 못 봄', () => {
  const base = [bar('2024-01-01', 100, 101, 99, 100)];
  const plan = { invalid: 95, target: 110 };
  const up = [...base, bar('2024-01-02', 100, 104, 99, 103), bar('2024-01-03', 103, 111, 102, 109)];
  assert.deepEqual(planOutcome(up, 0, plan, 2), { first: 'target', bar: 2, date: '2024-01-03', gapThrough: false, endClose: 109, endR: 1.8 });
  const both = [...base, bar('2024-01-02', 100, 112, 94, 101)];
  assert.equal(planOutcome(both, 0, plan, 1).first, 'same-bar');
  const gap = [...base, bar('2024-01-02', 92, 93, 90, 91)];
  const g = planOutcome(gap, 0, plan, 1);
  assert.equal(g.first, 'invalid'); assert.equal(g.gapThrough, true); assert.equal(g.endR, -1.8);
  const flat = [...base, bar('2024-01-02', 100, 101, 99, 100)];
  assert.equal(planOutcome(flat, 0, plan, 1).first, 'none');
  assert.equal(planOutcome(flat, 0, plan, 5).first, 'incomplete');
  assert.equal(planOutcome(flat, 0, { invalid: 95, target: null }, 1).first, 'none');
});

test('기대값 실험: 같은 씨앗이면 같은 결과이고, 기대값 식과 일치한다', () => {
  const a = simulateExpectancy({ winRate: 0.4, reward: 2, riskPercent: 1, trades: 100, runs: 50, seed: 7 });
  const b = simulateExpectancy({ winRate: 0.4, reward: 2, riskPercent: 1, trades: 100, runs: 50, seed: 7 });
  assert.deepEqual(a, b);
  assert.ok(Math.abs(a.expectancyR - 0.2) < 1e-12);
  assert.equal(a.curves.length, 20); assert.equal(a.curves[0].length, 101); assert.equal(a.curves[0][0], 100);
  assert.ok(a.p10 <= a.median && a.median <= a.p90);
  const lose = simulateExpectancy({ winRate: 0.7, reward: 0.3, riskPercent: 2, trades: 200, runs: 200, seed: 3 });
  assert.ok(Math.abs(lose.expectancyR - (-0.09)) < 1e-12);
  assert.ok(lose.median < 100, '기대값이 0보다 작으면 가운데 값이 시작보다 작다');
});

const sample = () => {
  for (const ref of capstoneRefs(course.cases)) {
    const s = stockOf(ref.ticker), open = openCapstone(s, ref);
    if (open) return { ref, s, open };
  }
  throw new Error('no capstone case');
};
const answers = (open, right) => Object.fromEntries(open.parts.map((q) => [q.type, right ? q.answer : (q.answer + 1) % q.options.length]));
const notes = () => Object.fromEntries(NOTE_FIELDS.map(([k]) => [k, '종가가 20일선 위, 반대 근거는 MACD']));

test('관찰지: 사례는 교재의 세 주제에서 고르고, 관찰 문항은 입문 과정과 같은 계산이며 마감일 뒤의 봉을 쓰지 않는다', () => {
  const refs = capstoneRefs(course.cases);
  assert.equal(new Set(refs.map(capstoneId)).size, refs.length);
  assert.ok(refs.every((r) => course.cases.some((c) => CAPSTONE_SOURCES.includes(c.type) && c.ticker === r.ticker && c.date === r.date)));
  const { ref, s, open } = sample();
  assert.ok(open.parts.length >= 4);
  assert.equal(open.history.at(-1).date, ref.date); assert.equal(open.view.at(-1).date, ref.date);
  for (const q of open.parts) {
    assert.ok(CAPSTONE_PARTS.includes(q.type));
    assert.deepEqual(q, makeCourseQuestion(courseContext(s.candles.slice(0, open.i + 1)), open.i, q.type));
  }
  const warped = { ...s, candles: s.candles.map((c, j) => (j <= open.i ? c : { ...c, close: c.close * 3, high: c.high * 3 })) };
  assert.deepEqual(openCapstone(warped, ref).parts, open.parts);
  const win = revealWindow(s, open.i);
  assert.ok(win.end - open.i <= 20 && win.history.length === win.end + 1);
});

test('관찰지 기록: 빠진 답·짧은 근거·잘못된 계획은 받지 않고, 처음 기록은 자기 점검으로 바뀌지 않는다', () => {
  const { s, open } = sample();
  assert.throws(() => capstoneRecord(open, { choices: {}, notes: notes(), plan: { mode: 'pass' } }), /답을 고르세요/);
  assert.throws(() => capstoneRecord(open, { choices: answers(open, true), notes: { ...notes(), counter: '짧음' }, plan: { mode: 'pass' } }), /8자 이상/);
  assert.throws(() => capstoneRecord(open, { choices: answers(open, true), notes: notes(), plan: null }), /관망/);
  assert.throws(() => capstoneRecord(open, { choices: answers(open, true), notes: notes(), plan: { mode: 'plan', invalid: open.close * 1.1 } }), /현재가보다 낮아야/);
  const rec = capstoneRecord(open, { choices: answers(open, false), notes: notes(), plan: { mode: 'plan', invalid: open.close * 0.95, target: '' }, confidence: 'sure' }, 1000);
  assert.ok(Object.values(rec.parts).every((p) => !p.correct));
  assert.ok(Object.values(rec.parts).some((p) => p.wrong.length > 0));
  assert.equal(rec.plan.target, null);
  assert.ok(Math.abs(rec.plan.metrics.riskPct - 5) < 1e-9);
  const reviewed = capstoneReview(rec, { number: true, invented: true }, ' 다시 보니 ', 2000);
  for (const k of ['submittedAt', 'parts', 'notes', 'plan', 'confidence']) assert.deepEqual(reviewed[k], rec[k], k);
  assert.equal(reviewed.self.checks.number, true); assert.equal('invented' in reviewed.self.checks, false);
  const outcome = capstoneOutcome(s, open.i, rec);
  assert.ok(['invalid', 'target', 'same-bar', 'none', 'incomplete'].includes(outcome.first));
  const pass = capstoneRecord(open, { choices: answers(open, true), notes: notes(), plan: { mode: 'pass' } }, 3000);
  assert.equal(capstoneOutcome(s, open.i, pass), null);
  const sum = capstoneSummary({ a: rec, b: pass });
  assert.deepEqual([sum.n, sum.plans, sum.passes], [2, 1, 1]);
  assert.equal(sum.partsOk, Object.keys(pass.parts).length);
});

test('관찰지 기록은 백업 왕복·중복·손상 검사를 거치고, 자주 틀리는 관찰에도 들어간다', () => {
  const { ref, open } = sample();
  const rec = capstoneRecord(open, { choices: answers(open, false), notes: notes(), plan: { mode: 'plan', invalid: open.close * 0.95, target: open.close * 1.1 } }, 1000);
  const store = { 'plan:v1': { v: 1, items: { [capstoneId(ref)]: rec } } };
  const parsed = parseBackup(JSON.stringify(buildBackup(store, {})));
  assert.ok(parsed.ok, parsed.error);
  assert.equal(parsed.backup.counts.capstone, 1);
  const once = Object.fromEntries(planImport({}, parsed.backup).writes);
  assert.deepEqual(once['plan:v1'], store['plan:v1']);
  assert.deepEqual(planImport(once, parsed.backup).writes, []);
  const bad = structuredClone(parsed.backup); bad.data['plan:v1'].items[capstoneId(ref)].plan.mode = '매수';
  assert.equal(parseBackup(JSON.stringify(bad)).ok, false);
  const later = structuredClone(store); later['plan:v1'].items[capstoneId(ref)] = { ...rec, submittedAt: 5, notes: { ...rec.notes, observation: '다른 기기에서 쓴 관찰' } };
  const merged = Object.fromEntries(planImport(store, parseBackup(JSON.stringify(buildBackup(later, {}))).backup).writes);
  assert.equal(merged['plan:v1'].items[capstoneId(ref)].submittedAt, 5, '먼저 제출한 쪽을 남긴다');
  assert.equal(merged['backup-conflicts:v1'].length, 1);
  const weak = weakReads({ ...store, 'plan:v1': { v: 1, items: { a: rec, b: { ...rec } } } }, course.readsByType);
  assert.ok(weak.length > 0);
});
