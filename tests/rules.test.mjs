import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { expandStock } from '../src/lib/data-quality.js';
import { CONDITIONS, EXAMPLES, rulesContext, evalCondition, judgeHolding, setErrors, emptySet } from '../src/lib/rules.js';
import { runLab, summarize, LAB_MIN_SAMPLE } from '../src/lib/rule-lab.js';

const stock = expandStock(JSON.parse(fs.readFileSync(new URL('../data/stocks/005930.KS.json', import.meta.url))));
const SAMPLE = {
  'close-ma': { period: 20, side: 'above' }, 'ma-ma': { short: 20, long: 60, side: 'above' }, 'ma-slope': { period: 20, lookback: 5, dir: 'up' },
  'weekly-ma': { weeks: 30, side: 'above' }, 'weekly-slope': { weeks: 30, lookback: 4, dir: 'up' }, rsi: { cmp: 'gte', value: 50 },
  macd: { kind: 'signal-above' }, breakout: { period: 20 }, breakdown: { period: 20 }, 'from-high': { period: 60, cmp: 'lte', pct: 10 },
  'from-low': { period: 252, pct: 30 }, volume: { ratio: 1.5 }, 'entry-return': { cmp: 'lte', pct: -8 }, 'stop-price': {},
  'atr-trail': { mult: 3 }, 'held-days': { days: 20 },
};

test('기준 점검: 모든 조건은 그날 뒤의 봉을 바꿔도 결과가 같다', () => {
  assert.deepEqual(Object.keys(SAMPLE).sort(), Object.keys(CONDITIONS).sort());
  const cut = 2000, pos = { entryIndex: 1900, entryPrice: stock.candles[1900].open, stop: stock.candles[1900].low * 0.95 };
  const changed = stock.candles.map((c, k) => (k > cut ? { ...c, open: c.open * 3, high: c.high * 3, low: c.low * 0.2, close: c.close * 0.3, volume: c.volume * 9 } : c));
  const a = rulesContext(stock.candles), b = rulesContext(changed);
  for (const [type, params] of Object.entries(SAMPLE)) for (const i of [1990, 1995, cut]) {
    assert.deepEqual(evalCondition(b, i, { type, params }, pos), evalCondition(a, i, { type, params }, pos), `${type} ${i}`);
  }
});

test('주봉 조건은 그날이 속한 주를 빼고 끝난 주만 쓴다', () => {
  const i = 2000, cs = stock.candles, monday = (d) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - (x.getUTCDay() + 6) % 7); return x.toISOString().slice(0, 10); };
  const week = monday(cs[i].date);
  const changed = cs.map((c, k) => (k <= i && monday(c.date) === week ? { ...c, close: c.close * 5 } : c));
  const cond = { type: 'weekly-ma', params: { weeks: 30, side: 'above' } };
  assert.deepEqual(evalCondition(rulesContext(changed), i, cond), evalCondition(rulesContext(cs), i, cond));
});

test('보유 판정은 전부 정리 > 일부 정리 > 보유 > 추가 검토 순서이고, 정리 기준이 걸리면 추가 기준을 보지 않는다', () => {
  const ctx = rulesContext(stock.candles), i = 2500, pos = { entryIndex: 2400, entryPrice: stock.candles[2400].open, stop: 0 };
  const always = { conds: [{ type: 'held-days', params: { days: 1 } }] }, never = { conds: [{ type: 'held-days', params: { days: 2000 } }] };
  const set = (g) => ({ name: 't', groups: { entry: [], add: g.add || [], exitPart: g.exitPart || [], exitAll: g.exitAll || [] } });
  assert.equal(judgeHolding(ctx, i, set({ exitAll: [never, always], exitPart: [always], add: [always] }), pos).state, 'exitAll');
  const part = judgeHolding(ctx, i, set({ exitAll: [never], exitPart: [always], add: [always] }), pos);
  assert.equal(part.state, 'exitPart'); assert.deepEqual(part.decisive, { group: 'exitPart', index: 1 }); assert.equal(part.groups.add, undefined);
  assert.equal(judgeHolding(ctx, i, set({ exitAll: [never], add: [never] }), pos).state, 'hold');
  assert.equal(judgeHolding(ctx, i, set({ exitAll: [never], add: [always] }), pos).state, 'add');
  // 무효 가격을 적지 않으면 그 조건은 계산할 수 없다. 걸린 것으로 치지 않는다.
  assert.equal(judgeHolding(ctx, i, set({ exitAll: [{ conds: [{ type: 'stop-price', params: {} }] }] }), pos).state, 'hold');
});

test('기준 묶음 검사: 범위 밖 값, 진입 기준의 보유 조건, 거꾸로 된 평균선을 잡고, 예시는 통과한다', () => {
  const s = emptySet('검사');
  s.groups.entry.push({ conds: [{ type: 'held-days', params: { days: 5 } }] });
  s.groups.exitAll.push({ conds: [{ type: 'close-ma', params: { period: 1, side: 'below' } }] }, { conds: [{ type: 'ma-ma', params: { short: 60, long: 20, side: 'above' } }] });
  const e = setErrors(s);
  assert.ok(e.some((x) => x.includes('진입 기준에는')) && e.some((x) => x.includes('기간(일)')) && e.some((x) => x.includes('짧은 기간')));
  for (const ex of EXAMPLES) assert.deepEqual(setErrors(ex), [], ex.id);
});

test('규칙 실험실: 종가로 판정하고 다음 날 시가에 사며, 비용을 빼고, 끝까지 정리되지 않은 거래는 따로 센다', () => {
  const day = (k) => new Date(Date.UTC(2020, 0, 1 + k)).toISOString().slice(0, 10);
  const px = [10, 10, 10, 12, 12, 12, 8, 8, 8, 12, 12];
  const cs = px.map((p, k) => ({ date: day(k), open: p + 0.5, high: p + 1, low: p - 1, close: p, volume: 100 }));
  const set = { name: 't', groups: { entry: [{ conds: [{ type: 'breakout', params: { period: 2 } }] }], add: [], exitPart: [], exitAll: [{ conds: [{ type: 'breakdown', params: { period: 2 } }] }] } };
  const lab = runLab([{ ticker: 'T', candles: cs }], set, { fee: 0.1, tax: 0.2, slip: 0, split: day(100) });
  assert.equal(lab.trades.length, 1);
  const t = lab.trades[0];
  assert.equal(t.signalDate, day(3)); assert.equal(t.entryDate, day(4)); assert.equal(t.entryPrice, 12.5);
  assert.equal(t.exitSignalDate, day(6)); assert.equal(t.exitDate, day(7)); assert.equal(t.exitPrice, 8.5);
  assert.ok(Math.abs(t.ret - ((8.5 * (1 - 0.003)) / (12.5 * 1.001) - 1) * 100) < 1e-9);
  assert.equal(lab.open.length, 1);   // 9일째 돌파로 진입했지만 자료 끝까지 정리되지 않았다
  assert.equal(lab.segments.before.n, 1); assert.equal(lab.segments.after.n, 0);
  const few = summarize(Array.from({ length: LAB_MIN_SAMPLE - 1 }, (_, k) => ({ ticker: 'A', ret: k - 5, days: 3 })));
  assert.equal(few.winShare, null); assert.equal(few.ci, null);
  assert.ok(summarize(Array.from({ length: LAB_MIN_SAMPLE }, (_, k) => ({ ticker: 'A', ret: k - 5, days: 3 }))).ci);
});

test('기준 저장: 내용이 바뀔 때만 판 번호가 오르고, 판정 기록은 처음 내용을 두고 행동만 한 번 붙는다, 백업 왕복', async () => {
  const { normalizeRules, saveSet, countAfterView, totalAfterViews, normalizeLog, setAction, compareLog, logEntry } = await import('../src/lib/rule-store.js');
  const { buildBackup, parseBackup, planImport } = await import('../src/lib/backup.js');
  const set = { name: '내 기준', groups: { entry: [], add: [], exitPart: [], exitAll: [{ conds: [{ type: 'close-ma', params: { period: 60, side: 'below' } }] }] } };
  let st = saveSet(normalizeRules(null), 's1', set, 1000);
  assert.equal(st.sets.s1.revision, 1);
  st = saveSet(st, 's1', { ...set, name: '이름만 바꿈' }, 2000);
  assert.equal(st.sets.s1.revision, 1);
  st = countAfterView(st, 's1');
  st = saveSet(st, 's1', { ...set, groups: { ...set.groups, exitAll: [{ conds: [{ type: 'close-ma', params: { period: 50, side: 'below' } }] }] } }, 3000);
  assert.equal(st.sets.s1.revision, 2); assert.equal(st.sets.s1.history.length, 2); assert.equal(totalAfterViews(st.sets.s1), 1);
  const holding = { id: 'h1', ticker: '005930.KS', entryDate: '2026-01-02', entryPrice: 100, createdAt: 1 };
  let log = normalizeLog(null);
  const e = logEntry({ state: 'exitAll', decisive: { group: 'exitAll', index: 1 } }, { holding, set: st.sets.s1, setId: 's1', dataDate: '2026-11-18', close: 90 }, 5000);
  log = { ...log, entries: [e] };
  log = setAction(log, e.id, 'hold', '아직 지켜봄', 6000);
  log = setAction(log, e.id, 'all', '바꿔 적기', 7000);
  assert.equal(log.entries[0].action.kind, 'hold');
  const cmp = compareLog(log, { '005930.KS': { date: '2026-11-25', close: 81 } });
  assert.equal(cmp.answered, 1); assert.equal(cmp.agreed, 0); assert.ok(Math.abs(cmp.rows[0].change + 10) < 1e-9);
  const store = { 'rules:v1': st, 'holdings:v1': { v: 1, items: [holding] }, 'rules-log:v1': log };
  const parsed = parseBackup(JSON.stringify(buildBackup(store, {})));
  assert.ok(parsed.ok, parsed.error);
  assert.deepEqual([parsed.backup.counts.ruleSets, parsed.backup.counts.holdings, parsed.backup.counts.ruleLog], [1, 1, 1]);
  const once = Object.fromEntries(planImport({}, parsed.backup).writes);
  assert.deepEqual(once['rules-log:v1'], log);
  assert.deepEqual(planImport(once, parsed.backup).writes, []);
});
