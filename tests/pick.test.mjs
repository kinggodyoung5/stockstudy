import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { expandStock } from '../src/lib/data-quality.js';
import { openCourseCase } from '../src/lib/chart-course.js';
import { PICK, pickRefs, pickTask, gradePick, pickRecord, pickSummary, pickId } from '../src/lib/pick.js';

const read = (f) => JSON.parse(fs.readFileSync(new URL('../' + f, import.meta.url)));
const course = read('data/chart-course.json');
const cache = new Map();
const stockOf = (t) => cache.get(t) || cache.set(t, expandStock(read(`data/stocks/${t}.json`))).get(t);
const historyOf = (ref) => { const s = stockOf(ref.ticker); return s.candles.slice(0, s.candles.findIndex((c) => c.date === ref.date) + 1); };

test('직접 짚기 사례: 추세·가격대(세 번 이상) 입문 사례에서 고르고, 모두 문제를 만들 수 있다', () => {
  const refs = pickRefs(course.cases);
  assert.equal(refs.length, course.cases.filter((r) => r.type === 'trend').length + course.cases.filter((r) => r.type === 'sr-level' && ['2', '3'].includes(r.bucket)).length);
  for (const task of ['low', 'high', 'zone']) assert.ok(refs.filter((r) => r.task === task).length >= 8, task);
  assert.deepEqual(pickRefs(course.cases), refs);
  for (const ref of refs) assert.ok(pickTask(historyOf(ref), ref.task), pickId(ref.task, ref));
});

test('저점·고점 짚기의 정답은 입문 추세 문제가 표시하는 고1·고2·저1·저2와 같다', () => {
  for (const ref of pickRefs(course.cases).filter((r) => r.task !== 'zone')) {
    const { question } = openCourseCase(stockOf(ref.ticker), course.cases.find((c) => c.type === 'trend' && c.ticker === ref.ticker && c.date === ref.date));
    const marks = question.markers.filter((m) => m.text.startsWith(ref.task === 'low' ? '저' : '고')).map((m) => m.date);
    assert.deepEqual(pickTask(historyOf(ref), ref.task).answers, marks);
  }
});

test('저점·고점 채점: 앞뒤 1봉은 맞음, 확인 전 봉·더 앞의 극점·다른 봉을 구분한다', () => {
  const ref = pickRefs(course.cases).find((r) => r.task === 'low'), t = pickTask(historyOf(ref), 'low');
  const k = (d) => t.view.findIndex((c) => c.date === d), at = (i) => ({ date: t.view[i].date, price: t.view[i].low });
  assert.equal(gradePick(t, t.answers.map((d) => at(k(d)))).correct, true);
  assert.equal(gradePick(t, [at(k(t.answers[0]) + 1), at(k(t.answers[1]) - 1)]).correct, true);
  assert.equal(gradePick(t, [at(k(t.answers[0]))]).correct, false);   // 하나만 누르면 맞음이 아니다
  const same = gradePick(t, [at(k(t.answers[0])), at(k(t.answers[0]))]);
  assert.equal(same.correct, false); assert.deepEqual(same.missed, [t.answers[1]]);
  const last = gradePick(t, [at(k(t.answers[0])), at(t.view.length - 1)]);
  assert.equal(last.items[1].verdict, k(t.answers[1]) >= t.view.length - 2 ? 'match' : 'unconfirmed');
  assert.ok(t.confirmedThrough < t.view.at(-1).date);
  if (t.others.length) assert.equal(gradePick(t, [at(k(t.others.at(-1))), at(k(t.answers[1]))]).items[0].verdict, 'older');
});

test('가격대 채점: 세 번 이상 반응한 가격대의 ±1.5% 안이면 맞고, 밖이면 가장 가까운 가격대를 알려준다', () => {
  const ref = pickRefs(course.cases).find((r) => r.task === 'zone'), t = pickTask(historyOf(ref), 'zone');
  assert.ok(t.levels.every((l) => l.touches.length >= PICK.minTouches));
  const L = t.levels[0].price, d = t.view.at(-1).date;
  assert.equal(gradePick(t, [{ date: d, price: L * 1.014 }]).correct, true);
  const far = gradePick(t, [{ date: d, price: Math.max(...t.view.map((c) => c.high)) * 3 }]);
  assert.equal(far.correct, false); assert.equal(far.items[0].verdict, 'other'); assert.ok(far.items[0].distancePct > PICK.zonePct);
});

test('직접 짚기 기록: 처음 제출은 다시 해도 바뀌지 않고, 다시 한 횟수와 마지막 결과만 늘어난다', () => {
  const first = pickRecord(null, [{ date: '2020-01-02', price: 100.123456 }], { correct: false }, 1000);
  assert.deepEqual(first.first, { at: 1000, picks: [{ date: '2020-01-02', price: 100.1235 }], correct: false });
  const again = pickRecord(first, [{ date: '2020-01-03', price: 99 }], { correct: true }, 2000);
  assert.deepEqual(again.first, first.first);
  assert.equal(again.tries, 2); assert.deepEqual(again.last, { at: 2000, correct: true });
  assert.deepEqual(pickSummary({ 'low|A|2020-01-02': again, 'zone|B|2020-01-02': first }).low, { n: 1, ok: 0 });
});

test('직접 짚기 백업: 왕복, 두 번 가져와도 늘지 않음, 처음 제출이 다르면 먼저 낸 쪽을 두고 충돌로 보관', async () => {
  const { buildBackup, parseBackup, planImport } = await import('../src/lib/backup.js');
  const id = 'low|005930.KS|2020-03-02';
  const rec = pickRecord(null, [{ date: '2020-02-10', price: 50000 }, { date: '2020-02-24', price: 51000 }], { correct: true }, 1000);
  const store = { 'pick:v1': { v: 1, items: { [id]: rec } } };
  const parsed = parseBackup(JSON.stringify(buildBackup(store, {})));
  assert.ok(parsed.ok, parsed.error);
  assert.equal(parsed.backup.counts.pick, 1);
  const once = Object.fromEntries(planImport({}, parsed.backup).writes);
  assert.deepEqual(once['pick:v1'], store['pick:v1']);
  assert.deepEqual(planImport(once, parsed.backup).writes, []);
  const later = { 'pick:v1': { v: 1, items: { [id]: pickRecord(null, [{ date: '2020-02-11', price: 1 }], { correct: false }, 500) } } };
  const merged = Object.fromEntries(planImport(store, parseBackup(JSON.stringify(buildBackup(later, {}))).backup).writes);
  assert.equal(merged['pick:v1'].items[id].first.at, 500);
  assert.equal(merged['backup-conflicts:v1'].length, 1);
  const bad = structuredClone(parsed.backup); bad.data['pick:v1'].items['low|<x>|2020-01-01'] = rec;
  assert.equal(parseBackup(JSON.stringify(bad)).ok, false);
});
