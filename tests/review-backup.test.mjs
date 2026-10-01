import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openCourseCase, courseRecord } from '../src/lib/chart-course.js';
import { reviewSelf } from '../src/lib/course-feedback.js';
import { expandStock } from '../src/lib/data-quality.js';
import { assessmentRecord, addAttempt, emptyAssessment, itemId } from '../src/lib/assessment.js';
import { submitStudy, reflectStudy } from '../src/lib/real-study.js';
import { recordAttempt } from '../src/content/practice.js';
import {
  DAY, DONE_STREAK, reviewSources, schedule, reviewEntries, pickReviewCase, reviewAttempt, addReviewAttempt, emptyReview, normalizeReview,
} from '../src/lib/review.js';
import { BACKUP_VERSION, CONFLICT_KEY, MAX_BYTES, buildBackup, parseBackup, planImport } from '../src/lib/backup.js';

const read = (file) => JSON.parse(fs.readFileSync(new URL('../' + file, import.meta.url)));
const course = read('data/chart-course.json'), assessment = read('data/assessment.json');
const cache = new Map();
const stockOf = (t) => cache.get(t) || cache.set(t, expandStock(read(`data/stocks/${t}.json`))).get(t);
const questionOf = (ref) => openCourseCase(stockOf(ref.ticker), ref).question;
const keyOf = (r) => `${r.type}|${r.ticker}|${r.date}`;
const COURSE_KEY = `chart-course:${course.version}:${course.provenance.sourceDigest}`;
const OLD_KEY = `chart-course:2026-01-01.0:${'ab'.repeat(32)}`;

/** 여러 종류의 기록이 든 저장소를 만든다. */
function sampleStore() {
  const refs = ['candle', 'volume', 'integrated', 'rsi'].map((t) => course.cases.find((r) => r.type === t));
  const records = {};
  refs.forEach((ref, k) => {
    const q = questionOf(ref), wrong = (q.answer + 1) % q.options.length;
    const extra = q.numeric ? { numeric: q.numeric.value.toFixed(2) } : {};
    let r = courseRecord(null, k % 2 ? q.answer : wrong, q, q.reflection ? '종가 1,000이 20일선 위, 반대는 MACD' : '', 1000 + k, { ...extra, confidence: k === 3 ? 'unsure' : 'sure' });
    if (q.selfChecks) r = reviewSelf(r, q.selfChecks, { number: true, separate: false }, '다시 보니 기울기를 빼먹었다', 5000);
    records[keyOf(ref)] = r;
  });
  // 예전 형식(v1)·예전 교재 버전 기록: 자동 확인과 문장이 없다.
  const old = { [keyOf(refs[0])]: { submittedAt: 500, choice: 2, correct: false, reflection: '' } };
  const aref = assessment.items.find((r) => r.type === 'macd'), aq = questionOf(aref);
  let a = addAttempt(emptyAssessment(), itemId(aref), assessmentRecord(aq, { choice: aq.answer, help: { hint: true } }, 2000));
  a = addAttempt(a, itemId(aref), assessmentRecord(aq, { choice: aq.answer, kind: 'retry' }, 3000));
  a = { ...a, shown: { [itemId(aref)]: 1990 }, session: { startedAt: 1, ids: [itemId(aref)], missing: [], help: {}, retry: null } };
  const draft = () => ({ observation: '관찰한 사실 여덟 자 이상', interpretation: '해석과 조건을 적었다', counter: '반대 증거도 적어 둔다', invalidation: '종가가 선 아래면 수정' });
  const study = { 'v1:2026-09-27.v4:abcd1234:golden-cross:A@2020-01-02:B@2021-03-04': reflectStudy(submitStudy(null, [draft(), draft()], 4000), '결과와 관찰을 나눠 보았다', 4100) };
  const practice = { candle: recordAttempt(null, { correct: true, reason: '시가와 종가 비교', confidence: 'sure' }, 6000) };
  return { [COURSE_KEY]: records, [OLD_KEY]: old, 'assessment:v1': a, 'real-study:v1': study, 'practice:v1': practice, 'review:v1': emptyReview(), quiz: { unrelated: true } };
}
const versions = { course: course.version, rules: course.provenance.rulesVersion, sourceDigest: course.provenance.sourceDigest, assessment: assessment.version };
const apply = (store, writes) => { const out = structuredClone(store); for (const [k, v] of writes) out[k] = structuredClone(v); return out; };
const roundTrip = (store) => parseBackup(JSON.stringify(buildBackup(store, versions)));

test('복습 출처: 오답·낮은 확신·자기 점검·도움 사용을 모으고, 예전 교재 기록은 저장된 정답 여부 그대로 쓴다', () => {
  const store = sampleStore(), sources = reviewSources(store);
  const why = Object.fromEntries(sources.map((s) => [s.id, s.reasons]));
  assert.ok(sources.some((s) => s.kind === 'course' && s.reasons.includes('wrong')));
  assert.ok(sources.some((s) => s.reasons.includes('unsure')));
  assert.ok(sources.some((s) => s.reasons.includes('self')));
  assert.ok(sources.some((s) => s.kind === 'check' && s.reasons.includes('help')));
  const old = sources.find((s) => s.storageKey === OLD_KEY);
  assert.deepEqual(old.reasons, ['wrong']); assert.equal(old.record, store[OLD_KEY][Object.keys(store[OLD_KEY])[0]]);
  // 맞았고 확신했고 도움 없이 푼 기록은 출처가 아니다.
  const right = Object.entries(store[COURSE_KEY]).find(([, r]) => r.correct && r.confidence === 'sure');
  if (right) assert.ok(!why[`course|${COURSE_KEY}|${right[0]}`]);
  // 출처를 계산해도 원래 기록은 그대로다.
  assert.deepEqual(store, sampleStore());
});

test('복습 일정: 1일 뒤 시작, 맞히면 1·3·7일, 7일 간격까지 연속으로 맞히면 끝, 틀리면 곧바로 다시', () => {
  const T = 1_000_000, source = { id: 's', at: T };
  assert.equal(schedule(source).dueAt, T + DAY);
  const att = (k, correct) => ({ submittedAt: T + k * DAY, correct });
  assert.equal(schedule(source, [att(1, true)]).dueAt, T + 2 * DAY);
  assert.equal(schedule(source, [att(1, true), att(2, true)]).dueAt, T + 5 * DAY);
  assert.equal(schedule(source, [att(1, true), att(2, true), att(5, true)]).dueAt, T + 12 * DAY);
  assert.equal(schedule(source, [att(1, true), att(2, true), att(5, true), att(12, true)]).done, true);
  assert.equal(DONE_STREAK, 4);
  const miss = schedule(source, [att(1, true), att(2, false)]);
  assert.equal(miss.dueAt, T + 2 * DAY); assert.equal(miss.streak, 0); assert.equal(miss.done, false);
  // 시도 순서가 섞여 들어와도 같은 일정이다(백업 합치기).
  assert.deepEqual(schedule(source, [att(2, true), att(1, true)]), schedule(source, [att(1, true), att(2, true)]));
  const entries = reviewEntries([{ id: 'a', at: T, ref: {} }, { id: 'b', at: T + 10 * DAY, ref: {} }], emptyReview(), T + 2 * DAY);
  assert.deepEqual(entries.map((e) => [e.source.id, e.due]), [['a', true], ['b', false]]);
});

test('복습 사례: 같은 주제의 다른 실제 사례를 먼저, 다 쓰기 전엔 반복하지 않고, 없을 때만 원래 사례로 표시한다', () => {
  const src = course.cases.find((r) => r.type === 'rsi');
  const source = { id: 'course|x|' + keyOf(src), ref: { type: src.type, ticker: src.ticker, date: src.date } };
  const pool = course.cases.filter((r) => r.type === 'rsi');
  const used = [];
  for (let k = 0; k < pool.length - 1; k++) {
    const pick = pickReviewCase(source, used, course.cases, new Set(), 's');
    assert.equal(pick.mode, 'other'); assert.equal(pick.ref.type, 'rsi'); assert.notEqual(keyOf(pick.ref), keyOf(src));
    assert.ok(!used.some((a) => keyOf(a.ref) === keyOf(pick.ref)), '아직 안 쓴 사례가 있으면 반복하지 않음');
    if (k === 0) assert.equal(pick.ref.bucket, src.bucket, '같은 상태 먼저');
    used.push({ ref: pick.ref, submittedAt: k });
  }
  // 다 쓰면 가장 오래전에 쓴 다른 사례로 돌아간다.
  assert.equal(keyOf(pickReviewCase(source, used, course.cases).ref), keyOf(used[0].ref));
  // 입문 과정에서 이미 푼 사례는 뒤로 미룬다.
  const tried = new Set(pool.filter((r) => keyOf(r) !== keyOf(src)).slice(0, -1).map(keyOf));
  assert.ok(!tried.has(keyOf(pickReviewCase(source, [], course.cases, tried).ref)));
  // 같은 주제의 다른 사례가 없을 때만 원래 사례
  assert.deepEqual(pickReviewCase(source, [], [src]), { ref: src, mode: 'same' });
  assert.equal(pickReviewCase(source, [], []), null);
  // 평가 문항이 출처여도 복습 사례는 입문 교재에서만 고른다.
  const aref = assessment.items[0];
  const pick = pickReviewCase({ id: 'check|' + itemId(aref), ref: { type: aref.type, ticker: aref.ticker, date: aref.date, bucket: aref.bucket } }, [], course.cases);
  assert.ok(course.cases.some((r) => keyOf(r) === keyOf(pick.ref)));
  assert.ok(!assessment.items.some((r) => itemId(r) === keyOf(pick.ref)));
});

test('복습 시도는 따로 쌓이고, 복습 뒤에도 처음 답과 근거가 그대로 보인다', () => {
  const store = sampleStore(), source = reviewSources(store).find((s) => s.kind === 'course' && s.reasons.includes('wrong') && s.storageKey === COURSE_KEY);
  const before = structuredClone(source.record);
  const pick = pickReviewCase(source, [], course.cases);
  const q = questionOf(pick.ref);
  const attempt = reviewAttempt(q, pick.ref, pick.mode, { choice: q.answer, confidence: 'half', reflection: q.reflection ? '종가와 20일선, MACD 막대' : '' }, 9000);
  assert.equal(attempt.correct, true); assert.equal(attempt.mode, 'other'); assert.equal(attempt.ref.ticker, pick.ref.ticker);
  assert.ok(!('self' in attempt));
  let review = addReviewAttempt(emptyReview(), source.id, attempt);
  review = addReviewAttempt(review, source.id, { ...attempt, submittedAt: 9500, correct: false });
  assert.equal(review.entries[source.id].attempts.length, 2);
  const after = reviewSources({ ...store, 'review:v1': review }).find((s) => s.id === source.id);
  assert.deepEqual(after.record, before);
  assert.deepEqual(normalizeReview({ v: 3 }), emptyReview());
});

test('백업 왕복: 내보낸 뒤 빈 브라우저로 가져오면 내용이 그대로이고, 다른 앱 저장값과 진행 중 세션은 넣지 않는다', () => {
  const store = sampleStore(), parsed = roundTrip(store);
  assert.ok(parsed.ok, parsed.error);
  const b = parsed.backup;
  assert.equal(b.formatVersion, BACKUP_VERSION);
  assert.deepEqual(b.versions, versions);
  assert.ok(!('quiz' in b.data));
  assert.ok(!('session' in b.data['assessment:v1']));
  for (const k of [COURSE_KEY, OLD_KEY, 'assessment:v1', 'real-study:v1', 'practice:v1']) assert.ok(k in b.data, k);
  const { writes, report } = planImport({}, b);
  const restored = apply({}, writes);
  for (const k of [COURSE_KEY, OLD_KEY, 'real-study:v1', 'practice:v1', 'review:v1']) assert.deepEqual(restored[k], store[k], k);
  const { session, ...rest } = store['assessment:v1'];
  assert.deepEqual({ ...restored['assessment:v1'], session: undefined }, { ...rest, session: undefined });
  assert.ok(report.added > 0); assert.equal(report.conflict, 0);
  // 지금 브라우저 기록 위로 같은 백업을 가져오면 아무것도 바뀌지 않는다.
  assert.deepEqual(planImport(store, b).writes, []);
});

test('같은 백업을 두 번 가져와도 기록 수가 늘지 않는다 (충돌이 있어도)', () => {
  const store = sampleStore(), b = roundTrip(store).backup;
  // 다른 기기에서 같은 문항에 다른 최초 답을 낸 기록 + 새 기록 + 늦게 쓴 자기 점검
  const other = structuredClone(store);
  const [k1, k2] = Object.keys(other[COURSE_KEY]);
  other[COURSE_KEY][k1] = { ...other[COURSE_KEY][k1], submittedAt: 1, choice: (other[COURSE_KEY][k1].choice + 1) % 3, choiceText: '다른 답' };
  const ik = Object.keys(other['assessment:v1'].items)[0];
  other['assessment:v1'].items[ik].retries.push({ ...other['assessment:v1'].items[ik].retries[0], submittedAt: 3500, correct: false });
  const incoming = roundTrip(other).backup;
  const first = planImport(store, incoming), once = apply(store, first.writes);
  const second = planImport(once, incoming), twice = apply(once, second.writes);
  assert.deepEqual(second.writes, []);
  assert.deepEqual(twice, once);
  assert.equal(once[CONFLICT_KEY].length, 1);
  assert.equal(once['assessment:v1'].items[ik].retries.length, 2);
  // 먼저 제출한 쪽(가져온 쪽, 시각 1)이 최초 답으로 남고, 원래 답은 보관함에 있다.
  assert.equal(once[COURSE_KEY][k1].submittedAt, 1);
  assert.equal(once[CONFLICT_KEY][0].other.submittedAt, store[COURSE_KEY][k1].submittedAt);
  assert.deepEqual(once[COURSE_KEY][k2], store[COURSE_KEY][k2]);
  // 원래 백업도 다시 가져와 보지만 보관함이 커지지 않는다.
  assert.deepEqual(planImport(apply(once, planImport(once, b).writes), b).writes, []);
});

test('충돌 병합: 최초 답은 사후 기록으로 덮어쓰지 않고, 사후 기록은 늦게 저장한 쪽을 쓰되 밀려난 것도 남긴다', () => {
  const store = sampleStore();
  const [key, rec] = Object.entries(store[COURSE_KEY]).find(([, r]) => r.self);
  const later = structuredClone(store);
  later[COURSE_KEY][key] = { ...rec, self: { ...rec.self, at: 9999, note: '나중에 고친 생각' } };
  // 같은 최초 답 + 더 늦은 자기 점검 → 합치기
  const plan = planImport(store, roundTrip(later).backup), next = apply(store, plan.writes);
  assert.equal(next[COURSE_KEY][key].self.note, '나중에 고친 생각');
  for (const f of ['submittedAt', 'choice', 'correct', 'reflection', 'auto', 'confidence']) assert.deepEqual(next[COURSE_KEY][key][f], rec[f], f);
  assert.equal(next[CONFLICT_KEY][0].field, 'self'); assert.equal(next[CONFLICT_KEY][0].other.note, rec.self.note);
  // 반대 방향: 오래된 자기 점검이 들어오면 지금 것을 유지한다.
  const back = apply(next, planImport(next, roundTrip(store).backup).writes);
  assert.equal(back[COURSE_KEY][key].self.note, '나중에 고친 생각');
  // 실제 비교 연습: 최초 근거가 다르면 먼저 제출한 쪽, 복기는 늦은 쪽.
  const sk = Object.keys(store['real-study:v1'])[0], srec = store['real-study:v1'][sk];
  const edited = structuredClone(store);
  edited['real-study:v1'][sk] = { ...srec, submittedAt: srec.submittedAt + 10, drafts: [{ ...srec.drafts[0], observation: '나중에 바꾼 관찰 문장' }, srec.drafts[1]] };
  const s2 = apply(store, planImport(store, roundTrip(edited).backup).writes);
  assert.deepEqual(s2['real-study:v1'][sk], srec);
  assert.equal(s2[CONFLICT_KEY].at(-1).other.drafts[0].observation, '나중에 바꾼 관찰 문장');
});

test('손상·다른 형식·미래 버전·위험한 값은 거부하고 기존 기록 계획을 만들지 않는다', () => {
  const good = buildBackup(sampleStore(), versions);
  const bad = (mutate) => { const b = structuredClone(good); mutate(b); return parseBackup(JSON.stringify(b)); };
  assert.equal(parseBackup('{"format":').ok, false);
  assert.equal(parseBackup('[]').ok, false);
  assert.match(parseBackup('{}').error, /백업이 아닙니다/);
  assert.match(bad((b) => { b.formatVersion = BACKUP_VERSION + 1; }).error, /더 새로운 형식/);
  assert.equal(bad((b) => { b.formatVersion = 0; }).ok, false);
  assert.equal(bad((b) => { b.extra = 1; }).ok, false);
  assert.equal(bad((b) => { b.data['settings:theme'] = {}; }).ok, false);
  assert.equal(bad((b) => { Object.values(b.data[COURSE_KEY])[0].choice = '0'; }).ok, false);
  assert.equal(bad((b) => { Object.values(b.data[COURSE_KEY])[0].reflection = 'x'.repeat(1501); }).ok, false);
  assert.equal(bad((b) => { Object.values(b.data[COURSE_KEY])[0].submittedAt = -1; }).ok, false);
  assert.equal(bad((b) => { Object.values(b.data[COURSE_KEY])[0].confidence = '확실'; }).ok, false);
  assert.equal(bad((b) => { b.data[COURSE_KEY]['../../x'] = Object.values(b.data[COURSE_KEY])[0]; }).ok, false);
  assert.equal(bad((b) => { b.data['real-study:v1'].k = { submittedAt: 1, drafts: [{ observation: 5 }] }; }).ok, false);
  assert.equal(bad((b) => { b.data['review:v1'].entries['evil|x'] = { attempts: [] }; }).ok, false);
  // __proto__ 같은 키로 객체 원형을 바꾸려는 파일
  const proto = JSON.stringify(good).replace('"data":{', '"data":{"__proto__":{"polluted":true},');
  assert.equal(parseBackup(proto).ok, false);
  assert.equal({}.polluted, undefined);
  // 글 안의 HTML 은 검사를 통과해도 글로만 남는다(화면은 textContent 로만 그린다).
  const html = bad((b) => { Object.values(b.data[COURSE_KEY])[0].reflection = '<img src=x onerror=alert(1)>'; });
  assert.equal(html.ok, true);
  assert.equal(parseBackup('x'.repeat(10), MAX_BYTES + 1).ok, false);
});

test('저장 실패: 여러 키 중 하나라도 못 쓰면 모두 되돌려 기존 기록이 그대로다', async () => {
  // 크기 한도가 있는 저장소. 실제 브라우저처럼 공간이 모자라면 QuotaExceededError 를 낸다.
  const data = new Map([['stockstudy:a', '"old-a"']]);
  let budget = 30;
  const used = () => [...data].reduce((n, [k, v]) => n + k.length + v.length, 0);
  globalThis.localStorage = {
    get length() { return data.size; }, key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { const old = data.get(k); data.set(k, String(v)); if (used() > budget) { if (old == null) data.delete(k); else data.set(k, old); const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; } },
    removeItem: (k) => { data.delete(k); },
  };
  try {
    const storage = await import('../src/lib/storage.js');
    const result = storage.saveMany([['a', 'new-a!'], ['b', 'new-b']]);
    assert.deepEqual(result, { ok: false, quota: true });
    assert.equal(data.get('stockstudy:a'), '"old-a"');
    assert.equal(data.has('stockstudy:b'), false);
    budget = 1000;
    assert.deepEqual(storage.saveMany([['a', 'new-a'], ['b', 'new-b']]), { ok: true });
    assert.deepEqual(storage.keys(), ['a', 'b']);
  } finally { delete globalThis.localStorage; }
});

test('기존 저장 형식 이전: v1 입문 기록·30쌍 넘는 실제 비교 기록·예전 버전 키를 지우지 않고 그대로 내보낸다', () => {
  const store = sampleStore();
  const draft = () => ({ observation: '관찰한 사실 여덟 자 이상', interpretation: '해석과 조건을 적었다', counter: '반대 증거도 적어 둔다', invalidation: '종가가 선 아래면 수정' });
  for (let i = 0; i < 40; i++) store['real-study:v1'][`v1:old.v${i}:abcd1234:dead-cross:A@2020-01-02:B@2021-03-0${i % 9 + 1}`] = submitStudy(null, [draft(), draft()], i + 1);
  store['real-study:v1'].legacyNull = null;
  const b = roundTrip(store).backup;
  assert.equal(Object.keys(b.data['real-study:v1']).length, 42);
  assert.deepEqual(b.data[OLD_KEY], store[OLD_KEY]);
  const restored = apply({}, planImport({}, b).writes);
  assert.equal(Object.values(restored['real-study:v1']).filter((r) => r?.submittedAt).length, 41);
  // 지금 형식 검사를 통과하지 못하는 저장값도 파일에서 사라지지 않는다(가져오지는 않는다).
  const broken = { ...store, 'practice:v1': { candle: { attempts: 'many' } } };
  const exported = buildBackup(broken, versions);
  assert.deepEqual(exported.unverified['practice:v1'], broken['practice:v1']);
  assert.ok(!('practice:v1' in exported.data));
  const reparsed = parseBackup(JSON.stringify(exported));
  assert.ok(reparsed.ok);
  assert.ok(!planImport({}, reparsed.backup).writes.some(([k]) => k === 'practice:v1'));
});
