/**
 * 학습 기록 백업 — JSON 내보내기와 가져오기. 로그인·서버·외부 전송은 없다.
 *
 * 백업에 넣는 저장 키 (이 앱이 쓰는 학습 기록만)
 *   chart-course:{교재 버전}:{원자료 지문}  입문 과정 기록 (예전 교재 버전 포함)
 *   assessment:v1                          새 구간 평가 (진행 중 세션은 빼고 기록만)
 *   real-study:v1                          실제 비교 연습의 최초 근거와 복기
 *   review:v1                              복습 시도
 *   practice:v1                            구성 예제 기초 연습
 *   backup-conflicts:v1                    가져오기에서 충돌해 대신 보관한 기록
 *
 * 가져오기 원칙
 *   - 파일 크기·JSON·형식 이름·형식 버전·키·자료형·글자 수를 모두 검사한다. 하나라도 어긋나면 전체를 거부하고
 *     기존 기록은 건드리지 않는다. 이 앱보다 새 형식 버전의 백업은 해석하지 않는다.
 *   - 최초 답(제출 시각·선택·근거·자동 확인)은 사후 기록으로 덮어쓰지 않는다.
 *     같은 문항에 최초 답이 둘이면 먼저 제출한 쪽을 남기고, 다른 쪽은 backup-conflicts 에 통째로 보관한다.
 *   - 사후 기록(자기 점검·복기)은 더 늦게 저장한 쪽을 쓰고, 밀려난 쪽도 backup-conflicts 에 보관한다.
 *   - 재시도·복습 시도는 합집합으로 합친다. 같은 시도는 한 번만 남는다.
 *   - 같은 백업을 두 번 가져와도 기록 수가 늘지 않는다.
 *   - 글은 데이터로만 다룬다. 화면에는 textContent 로만 넣는다.
 */
import { SELF_CHECKS, CONFIDENCE } from './course-feedback.js';
import { PROMPTS } from './real-study.js';
import { attemptKey } from './review.js';

export const BACKUP_FORMAT = 'stockstudy-backup';
export const BACKUP_VERSION = 1;
export const APP_VERSION = '2026-10-01';
export const MAX_BYTES = 5 * 1024 * 1024;
export const CONFLICT_KEY = 'backup-conflicts:v1';

const COURSE_KEY = /^chart-course:[0-9A-Za-z._-]{1,40}:[0-9a-f]{8,128}$/;
const FIXED_KEYS = ['assessment:v1', 'real-study:v1', 'review:v1', 'practice:v1', CONFLICT_KEY];
export const isBackupKey = (key) => COURSE_KEY.test(key) || FIXED_KEYS.includes(key);

/* ───────────── 검사 도구 ───────────── */

class Invalid extends Error {}
const fail = (path, why) => { throw new Invalid(`${path}: ${why}`); };
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
function obj(v, path, max = 5000) {
  if (!isObj(v)) fail(path, '객체가 아닙니다');
  const keys = Object.keys(v);
  if (keys.length > max) fail(path, '항목이 너무 많습니다');
  for (const k of keys) if (BAD_KEYS.has(k)) fail(path, '허용하지 않는 키');
  return v;
}
function only(v, path, allowed) {
  for (const k of Object.keys(v)) if (!allowed.includes(k)) fail(`${path}.${k}`, '알 수 없는 항목');
}
const str = (v, path, max) => (typeof v === 'string' && v.length <= max ? v : fail(path, `${max}자 이하 글자가 아닙니다`));
const optStr = (v, path, max) => (v == null ? v : str(v, path, max));
const num = (v, path) => (typeof v === 'number' && Number.isFinite(v) ? v : fail(path, '숫자가 아닙니다'));
const time = (v, path) => (num(v, path) >= 0 && v < 1e13 ? v : fail(path, '시각 범위가 아닙니다'));
const int = (v, path, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : fail(path, `${lo}~${hi} 정수가 아닙니다`));
const bool = (v, path) => (typeof v === 'boolean' ? v : fail(path, '참/거짓 값이 아닙니다'));
function arr(v, path, max) {
  if (!Array.isArray(v)) fail(path, '목록이 아닙니다');
  if (v.length > max) fail(path, '목록이 너무 깁니다');
  return v;
}
const CASE_KEY = /^[a-z-]{2,20}\|[0-9A-Za-z.^_-]{1,20}\|\d{4}-\d{2}-\d{2}$/;
const caseKey = (k, path) => (CASE_KEY.test(k) ? k : fail(path, '사례 식별자 형식이 아닙니다'));

function checkNumericResult(v, path) {
  if (v == null) return;
  obj(v, path); only(v, path, ['input', 'value', 'tolerance', 'ok', 'boundary']);
  num(v.input, path + '.input'); num(v.value, path + '.value'); num(v.tolerance, path + '.tolerance'); bool(v.ok, path + '.ok');
  if (v.boundary != null) num(v.boundary, path + '.boundary');
}
function checkAuto(v, path) {
  if (v == null) return;
  obj(v, path); only(v, path, ['wrong', 'numeric', 'claimed', 'truth']);
  if (v.wrong != null) arr(v.wrong, path + '.wrong', 20).forEach((x, i) => str(x, `${path}.wrong[${i}]`, 40));
  optStr(v.claimed, path + '.claimed', 40); optStr(v.truth, path + '.truth', 40);
  checkNumericResult(v.numeric, path + '.numeric');
}
function checkSelf(v, path) {
  if (v == null) return;
  obj(v, path); only(v, path, ['at', 'checks', 'note']);
  time(v.at, path + '.at'); str(v.note, path + '.note', 1000);
  obj(v.checks, path + '.checks', 20);
  for (const [k, x] of Object.entries(v.checks)) { if (!SELF_CHECKS[k]) fail(`${path}.checks.${k}`, '알 수 없는 점검 항목'); bool(x, `${path}.checks.${k}`); }
}
const BASE_FIELDS = ['v', 'submittedAt', 'choice', 'choiceText', 'correct', 'confidence', 'reflection', 'auto', 'self'];
function checkAnswer(v, path, extra = []) {
  obj(v, path); only(v, path, [...BASE_FIELDS, ...extra]);
  if (v.v != null) int(v.v, path + '.v', 1, 2);
  time(v.submittedAt, path + '.submittedAt'); int(v.choice, path + '.choice', 0, 9); bool(v.correct, path + '.correct');
  if (v.confidence != null && !CONFIDENCE[v.confidence]) fail(path + '.confidence', '알 수 없는 확신 값');
  optStr(v.reflection, path + '.reflection', 1500); optStr(v.choiceText, path + '.choiceText', 300);
  checkAuto(v.auto, path + '.auto'); checkSelf(v.self, path + '.self');
}
function checkAssessmentAnswer(v, path) {
  checkAnswer(v, path, ['kind', 'help', 'reads', 'session', 'version']);
  if (v.kind != null && !['first', 'retry'].includes(v.kind)) fail(path + '.kind', '알 수 없는 시도 종류');
  if (v.help != null) { obj(v.help, path + '.help', 5); only(v.help, path + '.help', ['hint', 'values']); Object.entries(v.help).forEach(([k, x]) => bool(x, `${path}.help.${k}`)); }
  if (v.reads != null) arr(v.reads, path + '.reads', 10).forEach((r, i) => { obj(r, `${path}.reads[${i}]`); only(r, `${path}.reads[${i}]`, ['label', 'ok']); str(r.label, `${path}.reads[${i}].label`, 80); bool(r.ok, `${path}.reads[${i}].ok`); });
  if (v.session != null) time(v.session, path + '.session');
  optStr(v.version, path + '.version', 30);
}

const VALIDATE = {
  course(value, path) {
    obj(value, path);
    for (const [k, r] of Object.entries(value)) checkAnswer(r, `${path}.${caseKey(k, path)}`);
  },
  'assessment:v1'(value, path) {
    obj(value, path); only(value, path, ['v', 'items', 'shown']);
    int(value.v, path + '.v', 1, 1);
    obj(value.items, path + '.items');
    for (const [k, e] of Object.entries(value.items)) {
      const p = `${path}.items.${caseKey(k, path + '.items')}`;
      obj(e, p); only(e, p, ['first', 'retries']);
      checkAssessmentAnswer(e.first, p + '.first');
      arr(e.retries, p + '.retries', 50).forEach((r, i) => checkAssessmentAnswer(r, `${p}.retries[${i}]`));
    }
    obj(value.shown, path + '.shown');
    for (const [k, t] of Object.entries(value.shown)) time(t, `${path}.shown.${caseKey(k, path + '.shown')}`);
  },
  'real-study:v1'(value, path) {
    obj(value, path, 2000);
    for (const [k, r] of Object.entries(value)) {
      const p = `${path}.${str(k, path, 300)}`;
      if (r === null) continue;     // 예전 앱이 남긴 빈 칸. 그대로 둔다.
      obj(r, p); only(r, p, ['submittedAt', 'drafts', 'reflection', 'reflectionAt']);
      time(r.submittedAt, p + '.submittedAt');
      arr(r.drafts, p + '.drafts', 2).forEach((d, i) => {
        obj(d, `${p}.drafts[${i}]`); only(d, `${p}.drafts[${i}]`, PROMPTS.map(([f]) => f));
        Object.entries(d).forEach(([f, x]) => str(x, `${p}.drafts[${i}].${f}`, 1000));
      });
      optStr(r.reflection, p + '.reflection', 2000);
      if (r.reflectionAt != null) time(r.reflectionAt, p + '.reflectionAt');
    }
  },
  'review:v1'(value, path) {
    obj(value, path); only(value, path, ['v', 'entries']); int(value.v, path + '.v', 1, 1);
    obj(value.entries, path + '.entries');
    for (const [id, e] of Object.entries(value.entries)) {
      const p = `${path}.entries.${str(id, path + '.entries', 200)}`;
      if (!/^(course\|chart-course:[^|]{1,200}|check)\|/.test(id)) fail(p, '복습 출처 형식이 아닙니다');
      obj(e, p); only(e, p, ['attempts']);
      arr(e.attempts, p + '.attempts', 500).forEach((a, i) => {
        const q = `${p}.attempts[${i}]`;
        checkAnswer(a, q, ['ref', 'mode']);
        obj(a.ref, q + '.ref'); only(a.ref, q + '.ref', ['type', 'ticker', 'date', 'bucket']);
        caseKey(`${a.ref.type}|${a.ref.ticker}|${a.ref.date}`, q + '.ref'); optStr(a.ref.bucket, q + '.ref.bucket', 40);
        if (!['other', 'same'].includes(a.mode)) fail(q + '.mode', '알 수 없는 복습 방식');
      });
    }
  },
  'practice:v1'(value, path) {
    obj(value, path, 100);
    for (const [k, r] of Object.entries(value)) {
      const p = `${path}.${k}`;
      if (!/^[a-z-]{2,20}$/.test(k)) fail(p, '개념 식별자 형식이 아닙니다');
      obj(r, p); only(r, p, ['attempts', 'correct', 'lastCorrect', 'reason', 'confidence', 'firstCorrect', 'streak', 'lastAt', 'dueAt']);
      int(r.attempts, p + '.attempts', 0, 1e6); int(r.correct, p + '.correct', 0, 1e6); int(r.streak, p + '.streak', 0, 1e6);
      bool(r.lastCorrect, p + '.lastCorrect'); bool(r.firstCorrect, p + '.firstCorrect');
      str(r.reason, p + '.reason', 1000); optStr(r.confidence, p + '.confidence', 20);
      time(r.lastAt, p + '.lastAt'); time(r.dueAt, p + '.dueAt');
    }
  },
  [CONFLICT_KEY](value, path) {
    arr(value, path, 5000).forEach((c, i) => {
      const p = `${path}[${i}]`;
      obj(c, p); only(c, p, ['at', 'key', 'item', 'field', 'kept', 'other']);
      time(c.at, p + '.at'); str(c.key, p + '.key', 300); str(c.item, p + '.item', 300); str(c.field, p + '.field', 40);
      if (!['local', 'incoming'].includes(c.kept)) fail(p + '.kept', '알 수 없는 값');
      if (JSON.stringify(c.other ?? null).length > 20000) fail(p + '.other', '너무 큽니다');
    });
  },
};
export function validateValue(key, value) {
  const check = COURSE_KEY.test(key) ? VALIDATE.course : VALIDATE[key];
  if (!check) fail(key, '백업에 넣지 않는 저장 키');
  check(value, key);
}

/* ───────────── 내보내기 ───────────── */

/** store: { 저장 키: 값 }. 백업 대상 키만 넣고, 평가의 진행 중 세션은 뺀다. */
export function buildBackup(store, versions, now = new Date()) {
  const data = {}, unverified = {};
  for (const [key, value] of Object.entries(store).sort(([a], [b]) => a.localeCompare(b))) {
    if (!isBackupKey(key) || value == null) continue;
    const clean = key === 'assessment:v1' ? { v: value.v, items: value.items || {}, shown: value.shown || {} } : value;
    // 지금 형식 검사를 통과하지 못한 저장값도 버리지 않는다. 파일에는 남기되 가져오기는 하지 않는다.
    try { validateValue(key, clean); data[key] = clean; } catch (_) { unverified[key] = value; }
  }
  return { format: BACKUP_FORMAT, formatVersion: BACKUP_VERSION, app: APP_VERSION,
    exportedAt: now.toISOString(), versions, counts: countRecords(data), data,
    ...(Object.keys(unverified).length ? { unverified } : {}) };
}

export function countRecords(data) {
  const c = { course: 0, courseVersions: 0, assessment: 0, assessmentRetries: 0, realStudy: 0, review: 0, practice: 0, conflicts: 0 };
  for (const [key, value] of Object.entries(data)) {
    if (COURSE_KEY.test(key)) { c.course += Object.keys(value || {}).length; c.courseVersions++; }
    else if (key === 'assessment:v1') for (const e of Object.values(value?.items || {})) { c.assessment++; c.assessmentRetries += e.retries?.length || 0; }
    else if (key === 'real-study:v1') c.realStudy += Object.values(value || {}).filter((r) => r?.submittedAt).length;
    else if (key === 'review:v1') for (const e of Object.values(value?.entries || {})) c.review += e.attempts?.length || 0;
    else if (key === 'practice:v1') c.practice += Object.keys(value || {}).length;
    else if (key === CONFLICT_KEY) c.conflicts += value?.length || 0;
  }
  return c;
}

/* ───────────── 가져오기: 읽기와 검사 ───────────── */

/** 문자열을 검사해 { ok, backup } 또는 { ok: false, error } 를 돌려준다. 기존 기록은 보지 않는다. */
export function parseBackup(text, byteLength = new Blob([text]).size) {
  try {
    if (byteLength > MAX_BYTES) fail('파일', `${Math.round(MAX_BYTES / 1024 / 1024)}MB보다 큽니다`);
    let raw;
    try { raw = JSON.parse(text); } catch (_) { fail('파일', 'JSON 형식이 아니거나 손상됐습니다'); }
    obj(raw, '백업');
    if (raw.format !== BACKUP_FORMAT) fail('백업', '이 앱의 학습 기록 백업이 아닙니다');
    if (!Number.isInteger(raw.formatVersion) || raw.formatVersion < 1) fail('백업', '형식 버전이 올바르지 않습니다');
    if (raw.formatVersion > BACKUP_VERSION) fail('백업', `더 새로운 형식(${raw.formatVersion})입니다. 이 앱은 ${BACKUP_VERSION}까지만 해석합니다. 앱을 갱신한 뒤 가져오세요`);
    only(raw, '백업', ['format', 'formatVersion', 'app', 'exportedAt', 'versions', 'counts', 'data', 'unverified']);
    if (raw.unverified != null) obj(raw.unverified, '백업.unverified', 200);   // 읽기만 하고 가져오지 않는다
    str(raw.app, '백업.app', 40); str(raw.exportedAt, '백업.exportedAt', 40);
    if (!Number.isFinite(Date.parse(raw.exportedAt))) fail('백업.exportedAt', '날짜가 아닙니다');
    obj(raw.versions, '백업.versions', 20);
    for (const [k, v] of Object.entries(raw.versions)) str(v, `백업.versions.${k}`, 200);
    obj(raw.data, '백업.data', 200);
    for (const [key, value] of Object.entries(raw.data)) validateValue(key, value);
    return { ok: true, backup: raw };
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, error: error.message };
    return { ok: false, error: '검사 중 알 수 없는 오류: ' + String(error?.message || error) };
  }
}

/* ───────────── 가져오기: 합치기 ───────────── */

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const FIRST_FIELDS = ['submittedAt', 'choice', 'choiceText', 'correct', 'confidence', 'reflection', 'auto', 'kind', 'help', 'reads', 'version'];
const firstPart = (r) => JSON.stringify(FIRST_FIELDS.map((f) => r?.[f] ?? null));

/**
 * 답 기록 하나를 합친다. 최초 답이 같으면 사후 기록(self)만 늦은 쪽으로, 다르면 먼저 제출한 쪽을 남긴다.
 * 반환: { value, status: 'same'|'merged'|'conflict', lost: [{ field, kept, other }] }
 */
function mergeAnswer(local, incoming) {
  if (same(local, incoming)) return { value: local, status: 'same', lost: [] };
  if (firstPart(local) !== firstPart(incoming)) {
    const keepLocal = local.submittedAt <= incoming.submittedAt;
    return { value: keepLocal ? local : incoming, status: 'conflict', lost: [{ field: 'first', kept: keepLocal ? 'local' : 'incoming', other: keepLocal ? incoming : local }] };
  }
  const a = local.self, b = incoming.self;
  if (same(a, b)) return { value: local, status: 'same', lost: [] };
  if (!a) return { value: { ...local, self: b }, status: 'merged', lost: [] };
  if (!b) return { value: local, status: 'same', lost: [] };
  const takeIncoming = b.at > a.at;
  return { value: takeIncoming ? { ...local, self: b } : local, status: 'merged',
    lost: [{ field: 'self', kept: takeIncoming ? 'incoming' : 'local', other: takeIncoming ? a : b }] };
}

function mergeCourse(local = {}, incoming, report, log, key) {
  const out = { ...local };
  for (const [k, r] of Object.entries(incoming)) {
    if (!out[k]) { out[k] = r; report.added++; continue; }
    const m = mergeAnswer(out[k], r);
    out[k] = m.value; report[m.status]++;
    m.lost.forEach((l) => log.push({ key, item: k, ...l }));
  }
  return out;
}

function mergeAssessment(local, incoming, report, log) {
  const base = local && local.v === 1 ? local : { v: 1, items: {}, shown: {}, session: null };
  const items = { ...base.items }, shown = { ...base.shown };
  for (const [k, e] of Object.entries(incoming.items)) {
    if (!items[k]) { items[k] = e; report.added++; continue; }
    const m = mergeAnswer(items[k].first, e.first);
    const seen = new Set((items[k].retries || []).map((r) => `${r.submittedAt}|${r.choice}`));
    const extra = e.retries.filter((r) => !seen.has(`${r.submittedAt}|${r.choice}`));
    // 버려진 최초 답은 재시도가 아니라 충돌 보관함으로 보낸다.
    const retries = [...(items[k].retries || []), ...extra].sort((a, b) => a.submittedAt - b.submittedAt);
    items[k] = { first: m.value, retries };
    report[extra.length && m.status === 'same' ? 'merged' : m.status]++;
    m.lost.forEach((l) => log.push({ key: 'assessment:v1', item: k, ...l }));
  }
  for (const [k, t] of Object.entries(incoming.shown)) shown[k] = shown[k] == null ? t : Math.min(shown[k], t);
  return { v: 1, items, shown, session: base.session || null };
}

function mergeRealStudy(local = {}, incoming, report, log) {
  const out = { ...local };
  for (const [k, r] of Object.entries(incoming)) {
    if (r === null) continue;
    const mine = out[k];
    if (!mine) { out[k] = r; report.added++; continue; }
    if (same(mine, r)) { report.same++; continue; }
    if (mine.submittedAt !== r.submittedAt || !same(mine.drafts, r.drafts)) {
      const keepLocal = mine.submittedAt <= r.submittedAt;
      out[k] = keepLocal ? mine : r; report.conflict++;
      log.push({ key: 'real-study:v1', item: k, field: 'first', kept: keepLocal ? 'local' : 'incoming', other: keepLocal ? r : mine });
      continue;
    }
    // 최초 근거는 같고 복기만 다르다. 비어 있으면 채우고, 둘 다 있으면 늦게 쓴 쪽을 쓴다.
    const a = mine.reflection || '', b = r.reflection || '';
    if (!b || a === b) { report.same++; continue; }
    if (!a) { out[k] = { ...mine, reflection: b, reflectionAt: r.reflectionAt }; report.merged++; continue; }
    const takeIncoming = (r.reflectionAt || 0) > (mine.reflectionAt || 0);
    out[k] = takeIncoming ? { ...mine, reflection: b, reflectionAt: r.reflectionAt } : mine;
    report.merged++;
    log.push({ key: 'real-study:v1', item: k, field: 'reflection', kept: takeIncoming ? 'incoming' : 'local', other: takeIncoming ? { reflection: a, reflectionAt: mine.reflectionAt ?? null } : { reflection: b, reflectionAt: r.reflectionAt ?? null } });
  }
  return out;
}

function mergeReview(local, incoming, report) {
  const base = local && local.v === 1 && isObj(local.entries) ? local : { v: 1, entries: {} };
  const entries = { ...base.entries };
  for (const [id, e] of Object.entries(incoming.entries)) {
    const mine = entries[id]?.attempts || [], seen = new Set(mine.map(attemptKey));
    const extra = e.attempts.filter((a) => !seen.has(attemptKey(a)));
    if (!entries[id]) report.added++;
    else report[extra.length ? 'merged' : 'same']++;
    entries[id] = { attempts: [...mine, ...extra].sort((a, b) => a.submittedAt - b.submittedAt) };
  }
  return { v: 1, entries };
}

function mergePractice(local = {}, incoming, report, log) {
  // 기초 연습은 누적 횟수만 남는 형식이라 더하면 두 번 셀 수 있다. 마지막 시도가 늦은 쪽을 쓴다.
  const out = { ...local };
  for (const [k, r] of Object.entries(incoming)) {
    if (!out[k]) { out[k] = r; report.added++; continue; }
    if (same(out[k], r)) { report.same++; continue; }
    const takeIncoming = r.lastAt > out[k].lastAt;
    log.push({ key: 'practice:v1', item: k, field: 'summary', kept: takeIncoming ? 'incoming' : 'local', other: takeIncoming ? out[k] : r });
    if (takeIncoming) out[k] = r;
    report.merged++;
  }
  return out;
}

/**
 * 지금 기록(local)에 백업을 합친 결과를 계산한다. 저장은 하지 않는다.
 * local: { 저장 키: 값 }. 반환: { writes: [[키, 값]], report }
 */
export function planImport(local, backup, now = Date.now()) {
  const report = { added: 0, same: 0, merged: 0, conflict: 0, keptAside: 0 };
  const log = [], writes = [];
  for (const [key, value] of Object.entries(backup.data)) {
    if (key === CONFLICT_KEY) continue;
    let next;
    if (COURSE_KEY.test(key)) next = mergeCourse(local[key], value, report, log, key);
    else if (key === 'assessment:v1') next = mergeAssessment(local[key], value, report, log);
    else if (key === 'real-study:v1') next = mergeRealStudy(local[key], value, report, log);
    else if (key === 'review:v1') next = mergeReview(local[key], value, report);
    else if (key === 'practice:v1') next = mergePractice(local[key], value, report, log);
    if (next !== undefined && !same(next, local[key])) writes.push([key, next]);
  }
  // 충돌 보관함: 지금 것 + 백업에 있던 것 + 이번에 밀려난 것. 같은 내용은 한 번만 둔다.
  const existing = Array.isArray(local[CONFLICT_KEY]) ? local[CONFLICT_KEY] : [];
  const sig = (c) => JSON.stringify([c.key, c.item, c.field, c.other]);
  const seen = new Set(existing.map(sig)), conflicts = [...existing];
  for (const c of [...(backup.data[CONFLICT_KEY] || []), ...log.map((l) => ({ at: now, ...l }))]) {
    if (seen.has(sig(c))) continue;
    seen.add(sig(c)); conflicts.push(c); report.keptAside++;
  }
  if (conflicts.length !== existing.length) writes.push([CONFLICT_KEY, conflicts]);
  return { writes, report };
}
