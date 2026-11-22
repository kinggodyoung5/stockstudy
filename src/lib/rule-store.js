/**
 * 내 기준 점검의 저장 형식. 브라우저 안에만 남는다.
 *   rules:v1      { v, active, sets: { id: { name, groups, revision, createdAt, updatedAt, history: [{ at, revision }], afterViews: { 판: 횟수 } } } }
 *   holdings:v1   { v, items: [{ id, ticker, entryDate, entryPrice, qty, stop, createdAt, note }] }
 *   rules-log:v1  { v, entries: [{ id, at, dataDate, ticker, setId, setName, revision, state, decisive, close, action }] }
 * 판정 기록은 처음 내용을 바꾸지 않는다. 내가 실제로 한 행동(action)만 나중에 한 번 붙일 수 있다.
 */
import { GROUPS } from './rules.js';

export const ACTIONS = { all: '전부 정리했다', part: '일부 정리했다', hold: '그대로 두었다', add: '추가로 샀다' };
/** 판정과 같은 행동 */
export const EXPECTED = { exitAll: 'all', exitPart: 'part', hold: 'hold', add: 'add' };

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
export const normalizeRules = (raw) => (raw?.v === 1 && isObj(raw.sets) ? raw : { v: 1, active: null, sets: {} });
export const normalizeHoldings = (raw) => (raw?.v === 1 && Array.isArray(raw.items) ? raw : { v: 1, items: [] });
export const normalizeLog = (raw) => (raw?.v === 1 && Array.isArray(raw.entries) ? raw : { v: 1, entries: [] });

const clean = (groups) => Object.fromEntries(Object.keys(GROUPS).map((g) => [g, (groups[g] || []).map((c) => ({ ...(c.label ? { label: String(c.label).slice(0, 80) } : {}), conds: c.conds.map((x) => ({ type: x.type, params: { ...x.params } })) }))]));

/** 기준 묶음 저장. 무리 내용이 바뀌었을 때만 판 번호를 올린다. */
export function saveSet(state, id, set, now = Date.now()) {
  const old = state.sets[id], groups = clean(set.groups), name = String(set.name).trim().slice(0, 60);
  if (old && JSON.stringify(old.groups) === JSON.stringify(groups)) {
    return { ...state, active: id, sets: { ...state.sets, [id]: { ...old, name, updatedAt: old.name === name ? old.updatedAt : now } } };
  }
  const revision = old ? old.revision + 1 : 1;
  const next = { name, groups, revision, createdAt: old?.createdAt || now, updatedAt: now,
    history: [...(old?.history || []), { at: now, revision }], afterViews: old?.afterViews || {} };
  return { ...state, active: id, sets: { ...state.sets, [id]: next } };
}

/** 실험실에서 뒤 구간을 열어 본 횟수(지금 판 기준) */
export function countAfterView(state, id) {
  const s = state.sets[id]; if (!s) return state;
  const k = String(s.revision);
  return { ...state, sets: { ...state.sets, [id]: { ...s, afterViews: { ...s.afterViews, [k]: (s.afterViews[k] || 0) + 1 } } } };
}
export const totalAfterViews = (s) => Object.values(s?.afterViews || {}).reduce((a, b) => a + b, 0);

export function holdingError(h) {
  if (!/^[0-9A-Za-z.^_-]{1,20}$/.test(h.ticker || '')) return '종목을 고르세요.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(h.entryDate || '')) return '매수일을 적으세요.';
  if (!(h.entryPrice > 0)) return '매수가를 0보다 큰 숫자로 적으세요.';
  if (h.qty != null && !(h.qty > 0)) return '수량은 0보다 커야 합니다.';
  if (h.stop != null && !(h.stop > 0)) return '무효 가격은 비워 두거나 0보다 큰 숫자로 적으세요.';
  return null;
}

export function logEntry(j, { holding, set, setId, dataDate, close }, now = Date.now()) {
  return { id: 'r' + now, at: now, dataDate, ticker: holding.ticker, holdingId: holding.id, setId, setName: set.name, revision: set.revision,
    state: j.state, decisive: j.decisive, close };
}

/** 실제로 한 행동은 한 번만 붙인다. 이미 있으면 그대로 둔다. */
export function setAction(log, id, kind, note = '', now = Date.now()) {
  if (!ACTIONS[kind]) throw new Error('행동을 고르세요.');
  return { ...log, entries: log.entries.map((e) => (e.id === id && !e.action ? { ...e, action: { at: now, kind, note: String(note).trim().slice(0, 500) } } : e)) };
}

/**
 * 기준대로 했다면과 실제로 한 것. latestClose: { ticker: { date, close } }
 * 반환: { rows: [{ ...entry, expected, agree, change }], answered, agreed }
 */
export function compareLog(log, latestClose = {}) {
  const rows = log.entries.map((e) => {
    const last = latestClose[e.ticker], expected = EXPECTED[e.state];
    const change = last && last.date > e.dataDate ? (last.close / e.close - 1) * 100 : null;
    return { ...e, expected, agree: e.action ? e.action.kind === expected : null, change, lastDate: last?.date || null };
  });
  const answered = rows.filter((r) => r.agree !== null);
  return { rows, answered: answered.length, agreed: answered.filter((r) => r.agree).length };
}
