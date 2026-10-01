/**
 * 실제 사례 복습 — 어려웠던 개념을 같은 개념의 다른 실제 사례로 다시 읽는다.
 *
 * 복습 대상(출처)은 저장된 기록에서 그때그때 계산한다. 출처 기록은 건드리지 않는다.
 *   입문 과정 기록: chart-course:{교재 버전}:{원자료 지문} 키마다 있다. 예전 교재 버전도 포함한다.
 *   새 구간 평가 기록: assessment:v1 의 첫 시도.
 * 복습 이유: 오답, 낮은 확신(반반·모르겠다), 평가에서 도움 사용, 자기 점검에서 표시하지 못한 항목.
 * 예전 판정 버전의 기록은 저장된 정답 여부를 그대로 쓴다. 새 기준으로 다시 채점하지 않는다.
 *
 * 복습 시도만 review:v1 에 따로 쌓는다. 일정은 저장하지 않고 시도 목록에서 매번 다시 계산한다.
 * 그래서 백업을 합칠 때 시도만 합치면 일정도 같은 결과가 된다.
 *
 * 공개 일정(고정 규칙이며 기억 연구로 최적화한 간격이 아니다)
 *   처음 기록 1일 뒤 첫 복습 → 맞히면 1일, 3일, 7일 뒤로 간격을 늘린다.
 *   7일 간격 복습까지 연속으로 맞히면 일정을 끝낸다. 틀리면 곧바로 다시 목록에 올린다.
 *   간격 계산은 기초 읽기 연습의 recordAttempt() 를 그대로 쓴다.
 */
import { TASKS, courseRecord } from './chart-course.js';
import { recordAttempt } from '../content/practice.js';
import { uniform } from './assessment.js';

export const REVIEW_KEY = 'review:v1';
export const DAY = 86400000;
export const DONE_STREAK = 4;
export const REVIEW_RULE = '처음 기록 1일 뒤 첫 복습. 복습에서 맞히면 1일, 3일, 7일 뒤로 간격을 늘리고, 7일 간격 복습까지 연속으로 맞히면 일정을 끝냅니다. 틀리면 곧바로 다시 목록에 올립니다. 단순한 고정 일정이며 기억에 가장 좋은 간격을 계산한 것이 아닙니다.';
export const REASONS = { wrong: '오답', unsure: '확신이 낮았음', help: '도움을 받고 풀었음', self: '자기 점검에서 표시하지 못한 항목' };
export const COURSE_PREFIX = 'chart-course:';
export const ASSESSMENT_STORAGE = 'assessment:v1';

const keyOf = (r) => `${r.type}|${r.ticker}|${r.date}`;
const parseKey = (key) => { const [type, ticker, date] = String(key).split('|'); return { type, ticker, date }; };

export function reasonsOf(record, { help = false } = {}) {
  if (!record?.submittedAt) return [];
  const why = [];
  if (record.correct === false) why.push('wrong');
  if (record.confidence === 'half' || record.confidence === 'unsure') why.push('unsure');
  if (help && record.help && Object.values(record.help).some((v) => v === true)) why.push('help');
  if (record.self?.checks && Object.values(record.self.checks).some((v) => v === false)) why.push('self');
  return why;
}

/**
 * 저장된 기록에서 복습 출처를 모은다.
 * store: { [저장 키]: 값 } — chart-course:* 와 assessment:v1 만 본다.
 * 반환: [{ id, kind, storageKey, version, ref, record, reasons, at }]
 */
export function reviewSources(store) {
  const out = [];
  for (const [storageKey, records] of Object.entries(store)) {
    if (!storageKey.startsWith(COURSE_PREFIX) || !records || typeof records !== 'object') continue;
    const version = storageKey.split(':')[1];
    for (const [key, record] of Object.entries(records)) {
      const reasons = reasonsOf(record), ref = parseKey(key);
      if (!reasons.length || !TASKS[ref.type]) continue;
      out.push({ id: `course|${storageKey}|${key}`, kind: 'course', storageKey, version, ref, record, reasons, at: record.submittedAt });
    }
  }
  const items = store[ASSESSMENT_STORAGE]?.items;
  if (items && typeof items === 'object') {
    for (const [key, entry] of Object.entries(items)) {
      const record = entry?.first, reasons = reasonsOf(record, { help: true }), ref = parseKey(key);
      if (!reasons.length || !TASKS[ref.type]) continue;
      out.push({ id: `check|${key}`, kind: 'check', storageKey: ASSESSMENT_STORAGE, version: record.version || '', ref, record, reasons, at: record.submittedAt });
    }
  }
  return out.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

export function emptyReview() { return { v: 1, entries: {} }; }
export function normalizeReview(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== 1 || !raw.entries || typeof raw.entries !== 'object') return emptyReview();
  return { v: 1, entries: raw.entries };
}

/** 출처의 첫 기록 시각과 복습 시도로 일정을 계산한다. */
export function schedule(source, attempts = []) {
  let state = null;
  for (const a of [...attempts].sort((x, y) => x.submittedAt - y.submittedAt)) {
    state = recordAttempt(state, { correct: a.correct === true, reason: '', confidence: a.confidence || '' }, a.submittedAt);
  }
  const streak = state?.streak || 0;
  return { dueAt: state ? state.dueAt : source.at + DAY, streak, done: streak >= DONE_STREAK, count: attempts.length, lastAt: state?.lastAt || null };
}

/** 출처마다 복습 상태를 붙여, 끝나지 않은 것은 예정 시각 순으로 돌려준다. */
export function reviewEntries(sources, review, now = Date.now()) {
  return sources.map((source) => {
    const attempts = review.entries[source.id]?.attempts || [];
    const plan = schedule(source, attempts);
    return { source, attempts, plan, due: !plan.done && plan.dueAt <= now };
  }).sort((a, b) => a.plan.done - b.plan.done || a.plan.dueAt - b.plan.dueAt || a.source.id.localeCompare(b.source.id));
}

/**
 * 복습할 사례를 고른다. 같은 개념(주제)의 다른 실제 사례를 먼저 고른다.
 *   1순위: 이 복습에서 아직 안 쓴 사례 중 입문 과정에서도 아직 풀지 않은 사례, 같은 상태(bucket)를 먼저
 *   2순위: 이 복습에서 아직 안 쓴 사례
 *   3순위: 이미 쓴 사례 중 가장 오래전에 쓴 것
 * 같은 주제의 다른 사례가 하나도 없을 때만 원래 사례를 다시 보여주고 mode 'same' 으로 표시한다.
 * courseCases 는 현재 입문 교재 사례(연습용)다. 평가 문항은 복습에 쓰지 않는다.
 */
export function pickReviewCase(source, attempts, courseCases, triedKeys = new Set(), salt = '') {
  const sourceKey = keyOf(source.ref);
  const bucket = source.ref.bucket || courseCases.find((r) => keyOf(r) === sourceKey)?.bucket;
  const lastUse = new Map(attempts.map((a) => [keyOf(a.ref), a.submittedAt]));
  const others = courseCases.filter((r) => r.type === source.ref.type && keyOf(r) !== sourceKey);
  if (others.length) {
    const rank = (r) => {
      const k = keyOf(r);
      if (lastUse.has(k)) return [3, lastUse.get(k)];
      return [triedKeys.has(k) ? 2 : 1, r.bucket === bucket ? 0 : 1];
    };
    const best = others.map((r) => ({ r, k: rank(r), u: uniform(salt + source.id + keyOf(r)) }))
      .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.u - b.u)[0];
    return { ref: best.r, mode: 'other' };
  }
  const same = courseCases.find((r) => keyOf(r) === sourceKey);
  return same ? { ref: same, mode: 'same' } : null;
}

/**
 * 복습 시도 기록. 입문 과정과 같은 자동 확인을 쓴다. 직접 계산 입력은 선택이다.
 * 출처의 최초 기록은 바꾸지 않는다.
 */
export function reviewAttempt(q, ref, mode, { choice, confidence, numeric, reflection = '' }, now = Date.now()) {
  const blank = String(numeric ?? '').trim() === '';
  const base = courseRecord(null, choice, blank ? { ...q, numeric: null } : q, reflection, now, { numeric, confidence });
  const { self, v, ...rest } = base;
  return { ...rest, ref: { type: ref.type, ticker: ref.ticker, date: ref.date, bucket: ref.bucket }, mode: mode === 'same' ? 'same' : 'other' };
}

export function addReviewAttempt(review, sourceId, attempt) {
  const entry = review.entries[sourceId] || { attempts: [] };
  return { ...review, entries: { ...review.entries, [sourceId]: { attempts: [...entry.attempts, attempt] } } };
}

export const attemptKey = (a) => `${a.submittedAt}|${a.ref?.type}|${a.ref?.ticker}|${a.ref?.date}|${a.choice}`;
