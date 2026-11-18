/**
 * 학습 일지 — 데이터 뷰어에서 본 화면을 근거와 함께 남긴다. 자동 채점하지 않는다.
 * 한 번 남긴 내용은 고치지 않고, 나중에 생각이 바뀌면 "덧붙임"으로만 더한다.
 * 근거 칸은 종합 관찰지와 같은 네 칸을 쓴다.
 */
import { NOTE_FIELDS, NOTE_MIN } from './capstone.js';

export const JOURNAL_KEY = 'journal:v1';
export const JOURNAL_UNITS = ['day', 'week', 'month'];

export function emptyJournal() { return { v: 1, entries: [] }; }
export function normalizeJournal(raw) {
  return raw && raw.v === 1 && Array.isArray(raw.entries) ? raw : emptyJournal();
}

/**
 * 새 일지 항목. 관찰한 사실은 8자 이상이어야 하고, 나머지 칸은 비워도 된다.
 * input: { ticker, name, end, unit, overlays: [이름], oscillators: [이름], notes: { 칸: 글 } }
 */
export function journalEntry(input, now = Date.now()) {
  if (typeof input.ticker !== 'string' || !input.ticker) throw new Error('종목이 없습니다.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.end || '')) throw new Error('기준일이 없습니다.');
  const notes = {};
  for (const [k, label] of NOTE_FIELDS) {
    const v = String(input.notes?.[k] ?? '').trim();
    if (k === 'observation' && v.length < NOTE_MIN) throw new Error(`‘${label}’ 칸은 ${NOTE_MIN}자 이상 적으세요.`);
    if (v) notes[k] = v.slice(0, 1000);
  }
  return {
    id: `j${now}`, createdAt: now, ticker: input.ticker, name: String(input.name || '').slice(0, 80), end: input.end,
    unit: JOURNAL_UNITS.includes(input.unit) ? input.unit : 'day',
    overlays: (input.overlays || []).filter((x) => typeof x === 'string').slice(0, 12),
    oscillators: (input.oscillators || []).filter((x) => typeof x === 'string').slice(0, 8),
    notes, addenda: [],
  };
}

export function addEntry(journal, entry) {
  return { v: 1, entries: [...journal.entries.filter((e) => e.id !== entry.id), entry].sort((a, b) => a.createdAt - b.createdAt) };
}

/** 덧붙임. 처음 쓴 내용은 그대로 둔다. */
export function addAddendum(journal, id, text, now = Date.now()) {
  const t = String(text || '').trim();
  if (t.length < 2) throw new Error('덧붙일 내용을 적으세요.');
  return { v: 1, entries: journal.entries.map((e) => (e.id === id ? { ...e, addenda: [...e.addenda, { at: now, text: t.slice(0, 1000) }] } : e)) };
}

/** 뷰어를 그 종목·기준일로 여는 주소 */
export const journalHref = (e) => `#/viewer/${encodeURIComponent(e.ticker)}/${e.end}`;
