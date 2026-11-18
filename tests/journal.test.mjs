import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyJournal, normalizeJournal, journalEntry, addEntry, addAddendum, journalHref } from '../src/lib/journal.js';
import { buildBackup, parseBackup, planImport } from '../src/lib/backup.js';
import { stepDate } from '../src/views/viewer.js';

const input = (extra = {}) => ({ ticker: '005930.KS', name: '삼성전자', end: '2024-03-15', unit: 'day', overlays: ['ma20', 'volume'], oscillators: ['rsi'],
  notes: { observation: '종가가 20일선 위, 직전 고점 근처', counter: '거래량은 평균보다 적다' }, ...extra });

test('학습 일지: 관찰한 사실은 8자 이상, 나머지 칸은 비워도 되고, 처음 내용은 덧붙임으로 바뀌지 않는다', () => {
  assert.throws(() => journalEntry(input({ notes: { observation: '짧다' } })), /8자 이상/);
  assert.throws(() => journalEntry(input({ end: '' })), /기준일/);
  const e = journalEntry(input(), 1000);
  assert.deepEqual(Object.keys(e.notes), ['observation', 'counter']);
  assert.equal(e.id, 'j1000');
  let j = addEntry(emptyJournal(), e);
  j = addEntry(j, e);
  assert.equal(j.entries.length, 1, '같은 항목을 두 번 더해도 하나');
  assert.throws(() => addAddendum(j, e.id, ' '), /덧붙일/);
  j = addAddendum(j, e.id, '다음 날 종가가 고점을 넘었다', 2000);
  assert.deepEqual(j.entries[0].notes, e.notes);
  assert.equal(j.entries[0].addenda.length, 1);
  assert.equal(journalHref(e), '#/viewer/005930.KS/2024-03-15');
  assert.deepEqual(normalizeJournal({ v: 2 }), emptyJournal());
  assert.equal(journalEntry(input({ unit: '분봉' }), 1).unit, 'day');
});

test('학습 일지 백업: 왕복, 두 번 가져와도 늘지 않음, 덧붙임은 합치고, 처음 내용이 다르면 충돌로 보관', () => {
  const e = journalEntry(input(), 1000);
  const store = { 'journal:v1': addAddendum(addEntry(emptyJournal(), e), e.id, '덧붙임 하나', 2000) };
  const parsed = parseBackup(JSON.stringify(buildBackup(store, {})));
  assert.ok(parsed.ok, parsed.error);
  assert.equal(parsed.backup.counts.journal, 1);
  const once = Object.fromEntries(planImport({}, parsed.backup).writes);
  assert.deepEqual(once['journal:v1'], store['journal:v1']);
  assert.deepEqual(planImport(once, parsed.backup).writes, []);
  const other = structuredClone(store);
  other['journal:v1'] = addAddendum(other['journal:v1'], e.id, '다른 기기에서 덧붙임', 3000);
  const merged = Object.fromEntries(planImport(store, parseBackup(JSON.stringify(buildBackup(other, {}))).backup).writes);
  assert.equal(merged['journal:v1'].entries[0].addenda.length, 2);
  const changed = structuredClone(store); changed['journal:v1'].entries[0].notes.observation = '다른 기기에서 다르게 쓴 관찰';
  const c = Object.fromEntries(planImport(store, parseBackup(JSON.stringify(buildBackup(changed, {}))).backup).writes);
  assert.equal(c['journal:v1'], undefined, '처음 내용은 바꾸지 않는다');
  assert.equal(c['backup-conflicts:v1'].length, 1);
  const bad = structuredClone(parsed.backup); bad.data['journal:v1'].entries[0].ticker = '<script>';
  assert.equal(parseBackup(JSON.stringify(bad)).ok, false);
});

test('봉 넘기기: 기준일을 일봉 단위로 옮기고, 자료 끝에서 멈춘다', () => {
  const cs = ['2024-01-02', '2024-01-03', '2024-01-05', '2024-01-08'].map((date) => ({ date }));
  assert.equal(stepDate(cs, null, -1), '2024-01-05', '기준일이 없으면 마지막 날에서 시작');
  assert.equal(stepDate(cs, '2024-01-03', 1), '2024-01-05', '휴장일을 건너뛴다');
  assert.equal(stepDate(cs, '2024-01-04', 1), '2024-01-05', '거래일이 아닌 기준일은 그 앞 거래일에서 센다');
  assert.equal(stepDate(cs, '2024-01-05', 5), '2024-01-08');
  assert.equal(stepDate(cs, '2024-01-02', -3), '2024-01-02');
});
