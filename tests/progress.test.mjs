import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMAINS, DOMAIN_OF, emptyAssessment, normalizeAssessment, addSession, sessionCompare, confidenceTable } from '../src/lib/assessment.js';
import { weakReads } from '../src/lib/review.js';
import { buildBackup, parseBackup, planImport } from '../src/lib/backup.js';

const DAY = 86400000;
const item = (type, d) => ({ type, ticker: 'AAA', date: `2024-01-${String(d).padStart(2, '0')}`, bucket: '0', edge: 0 });
const key = (r) => `${r.type}|${r.ticker}|${r.date}`;
const rec = (session, correct, extra = {}) => ({ v: 2, submittedAt: session + 1000, choice: 0, correct, confidence: null, reflection: '',
  auto: { wrong: correct ? [] : ['x'], numeric: null }, self: null, kind: 'first', help: { hint: false, values: false }, reads: [], session, version: 't', ...extra });

test('점검 세션: 형식 버전 1을 유지하고, sessions 칸이 없는 예전 기록도 그대로 읽는다', () => {
  const old = { v: 1, items: {}, shown: {}, session: null };
  assert.deepEqual(normalizeAssessment(old).sessions, []);
  let s = addSession(normalizeAssessment(old), { startedAt: 200, ids: ['a|B|2024-01-01'], label: 'post' });
  s = addSession(s, { startedAt: 100, ids: ['a|B|2024-01-02'], label: 'pre' });
  s = addSession(s, { startedAt: 100, ids: ['a|B|2024-01-02'], label: 'pre' });
  assert.deepEqual(s.sessions.map((x) => [x.startedAt, x.label]), [[100, 'pre'], [200, 'post']]);
  assert.equal(addSession(emptyAssessment(), { startedAt: 1, ids: [], label: '이상한 값' }).sessions[0].label, 'post');
});

test('처음 점검과 최근 점검: 첫 시도만, 도움 없이 맞힌 수를 영역마다 센다. 7일 넘게 지난 점검은 간격을 둔 점검이다', () => {
  const t0 = 1_700_000_000_000, t1 = t0 + 2 * DAY, t2 = t0 + 10 * DAY;
  const a = item('candle', 1), b = item('rsi', 2), c = item('candle', 3), d = item('rsi', 4);
  let state = { ...emptyAssessment(), items: {
    [key(a)]: { first: rec(t0, false), retries: [rec(t0, true, { kind: 'retry', submittedAt: t0 + 5000 })] },
    [key(b)]: { first: rec(t0, true, { help: { hint: true, values: false } }), retries: [] },
    [key(c)]: { first: rec(t1, true), retries: [] },
    [key(d)]: { first: rec(t2, true), retries: [] },
  } };
  state = addSession(state, { startedAt: t0, ids: [key(a), key(b)], label: 'pre' });
  const cmp = sessionCompare(state, [a, b, c, d]);
  assert.equal(cmp.first.label, 'pre');
  assert.deepEqual(cmp.recent.map((m) => [m.startedAt, m.spaced]), [[t1, false], [t2, true]]);
  const price = DOMAIN_OF.candle, mom = DOMAIN_OF.rsi;
  assert.deepEqual(cmp.firstCounts[price], { n: 1, noHelp: 1, noHelpCorrect: 0 });   // 재시도의 정답은 세지 않는다
  assert.deepEqual(cmp.firstCounts[mom], { n: 1, noHelp: 0, noHelpCorrect: 0 });     // 도움 받은 첫 시도
  assert.deepEqual(cmp.recentCounts[price], { n: 1, noHelp: 1, noHelpCorrect: 1 });
  assert.deepEqual(cmp.recentCounts[mom], { n: 1, noHelp: 1, noHelpCorrect: 1 });
  assert.equal(Object.keys(cmp.firstCounts).length, DOMAINS.length);
  assert.equal(sessionCompare(emptyAssessment(), []), null);
  const one = sessionCompare({ ...emptyAssessment(), items: { [key(a)]: { first: rec(t0, true), retries: [] } } }, [a]);
  assert.equal(one.recentCounts, null);
});

test('확신과 결과: 확신별로 맞은 수를 따로 세고, 확실하다고 했는데 틀린 문항을 모은다', () => {
  const items = {
    'candle|A|2024-01-01': { first: rec(1, false, { confidence: 'sure' }), retries: [] },
    'candle|A|2024-01-02': { first: rec(2, true, { confidence: 'sure' }), retries: [] },
    'rsi|A|2024-01-03': { first: rec(3, false, { confidence: 'unsure' }), retries: [] },
    'rsi|A|2024-01-04': { first: rec(4, true), retries: [] },
  };
  const t = confidenceTable({ ...emptyAssessment(), items });
  assert.deepEqual([t.sure, t.unsure, t.half, t.none], [{ n: 2, correct: 1 }, { n: 1, correct: 0 }, { n: 0, correct: 0 }, { n: 1, correct: 1 }]);
  assert.deepEqual(t.sureWrong.map((x) => x.type), ['candle']);
});

test('자주 틀리는 관찰: 주제가 달라도 같은 관찰 이름으로 모으고, 그 관찰이 들어 있는 다른 주제로 잇는다', () => {
  const readsByType = { 'ma-slope': { slope: '20일선의 5거래일 변화', loc: '종가와 20일선' }, integrated: { slope: '20일선의 5거래일 변화', loc: '종가와 20일선', macd: 'MACD선과 시그널선' } };
  const course = {
    'ma-slope|A|2024-01-01': { submittedAt: 1, correct: false, auto: { wrong: ['slope'] } },
    'ma-slope|A|2024-01-02': { submittedAt: 2, correct: false, auto: { wrong: ['slope'] } },
    'integrated|A|2024-01-03': { submittedAt: 3, correct: true, auto: { wrong: [] } },
    'old|A|2024-01-04': { submittedAt: 4, correct: false, auto: { wrong: ['slope'] } },           // 지금 교재에 없는 주제
    'ma-slope|A|2024-01-05': { submittedAt: 5, correct: false, reflection: '' },                 // 예전 형식(auto 없음)
  };
  const assessment = { v: 1, items: { 'integrated|B|2024-02-01': { first: { submittedAt: 9, reads: [
    { label: '20일선의 5거래일 변화', ok: false }, { label: 'MACD선과 시그널선', ok: true }] }, retries: [] } }, shown: {} };
  const store = { 'chart-course:2026-11-17.2:abcd1234': course, 'assessment:v1': assessment };
  const weak = weakReads(store, readsByType);
  assert.deepEqual(weak.map((w) => [w.label, w.n, w.wrong]), [['20일선의 5거래일 변화', 4, 3]]);
  assert.deepEqual(weak[0].types, ['integrated', 'ma-slope']);
  assert.deepEqual(store['chart-course:2026-11-17.2:abcd1234'], course, '원래 기록은 바뀌지 않는다');
  assert.deepEqual(weakReads({}, readsByType), []);
});

test('백업: 점검 세션 목록을 내보내고 가져오며, 두 번 가져와도 늘지 않는다', () => {
  const state = addSession({ ...emptyAssessment(), items: { 'candle|A|2024-01-01': { first: rec(100, true), retries: [] } } },
    { startedAt: 100, ids: ['candle|A|2024-01-01'], label: 'pre' });
  const parsed = parseBackup(JSON.stringify(buildBackup({ 'assessment:v1': state }, {})));
  assert.ok(parsed.ok, parsed.error);
  assert.deepEqual(parsed.backup.data['assessment:v1'].sessions, state.sessions);
  const once = Object.fromEntries(planImport({}, parsed.backup).writes);
  assert.deepEqual(once['assessment:v1'].sessions, state.sessions);
  assert.deepEqual(planImport(once, parsed.backup).writes, []);
  const bad = structuredClone(parsed.backup); bad.data['assessment:v1'].sessions[0].label = '중간';
  assert.equal(parseBackup(JSON.stringify(bad)).ok, false);
});
