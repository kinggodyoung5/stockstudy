import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { expandStock } from '../src/lib/data-quality.js';
import { outcomeAt } from '../src/lib/outcome.js';
import { STUDY_PATTERNS, PROMPTS, comparisonPairs, studyWindow, studyKey, submitStudy, keepStudy, reflectStudy } from '../src/lib/real-study.js';

const read = (file) => JSON.parse(fs.readFileSync(new URL('../' + file, import.meta.url)));
const hit = (ticker, changePct, days = 20) => ({ ticker, date: '2020-01-01', confirmDate: '2020-01-06',
  outcome: { fromDate: '2020-01-06', changePct, days } });
const draft = () => Object.fromEntries(PROMPTS.map(([key]) => [key, '확인일까지 관찰한 근거를 기록합니다.']));

test('비교 교재만 반대 결과로 짝짓고 보합·미완료·격리·중복은 제외한다', () => {
  const a = hit('A', 1), b = hit('B', -1);
  const meta = { bias: 'up', hits: [a, b, a, hit('C', 0), hit('D', 1, 19), hit('BAD', 1)] };
  const before = JSON.stringify(meta);
  const pairs = comparisonPairs(meta, ['A', 'B', 'C', 'D']);
  assert.equal(pairs.length, 1);
  assert.deepEqual(new Set(pairs[0].map((h) => h.ticker)), new Set(['A', 'B']));
  assert.equal(JSON.stringify(meta), before);
  assert.deepEqual(pairs, comparisonPairs({ ...meta, hits: [...meta.hits].reverse() }, ['A', 'B', 'C', 'D']));
  assert.equal(comparisonPairs({ ...meta, bias: 'none' }, ['A', 'B']).length, 0);
  assert.equal(comparisonPairs({ bias: 'down', hits: [a] }, ['A']).length, 0);
});

test('하락 신호도 반대 방향 쌍이며 사례 재사용을 피한다', () => {
  const pairs = comparisonPairs({ bias: 'down', hits: [hit('A', -2), hit('B', 2), hit('C', -3), hit('D', 3)] }, ['A', 'B', 'C', 'D']);
  assert.equal(pairs.length, 2);
  assert.equal(new Set(pairs.flat().map((h) => h.ticker)).size, 4);
  for (const pair of pairs) assert.ok(pair[0].outcome.changePct * pair[1].outcome.changePct < 0);
});

test('공개 전 차트·계산 이력은 신호일 아닌 확인일에서 끝난다', () => {
  const candles = Array.from({ length: 80 }, (_, i) => ({ date: new Date(Date.UTC(2020, 0, i + 1)).toISOString().slice(0, 10), open: 100 + i, close: 101 + i, high: 102 + i, low: 99 + i, volume: 100 }));
  const stock = { ticker: 'A', candles };
  const h = { ticker: 'A', date: candles[30].date, confirmDate: candles[35].date, outcome: outcomeAt(candles, 35) };
  const hidden = studyWindow(stock, h);
  assert.equal(hidden.view.at(-1).date, candles[35].date);
  assert.equal(hidden.history.at(-1).date, candles[35].date);
  assert.equal(studyWindow(stock, h, true).view.at(-1).date, candles[55].date);
  assert.equal(hidden.view.length + 20, studyWindow(stock, h, true).view.length);
  assert.throws(() => studyWindow({ ...stock, ticker: 'OTHER' }, h));
  assert.throws(() => studyWindow({ ...stock, dataQuality: { sourceConcerns: [{ date: candles[0].date }] } }, h));
  assert.throws(() => studyWindow(stock, { ...h, outcome: { ...h.outcome, changePct: 999 } }));
});

test('두 사례의 기록이 모두 필요하며 최초 근거는 입력 변경·재제출로 덮어쓰지 않는다', () => {
  const ds = [draft(), draft()];
  assert.throws(() => submitStudy(null, [draft()]));
  assert.throws(() => submitStudy(null, [draft(), {}]));
  const record = submitStudy(null, ds, 123);
  ds[0].observation = '変更';
  assert.notEqual(record.drafts[0].observation, ds[0].observation);
  assert.equal(submitStudy(record, [draft(), draft()], 456), record);
});

test('자료 버전과 원자료 해시별로 기록을 분리하고, 30쌍을 넘거나 형식이 달라도 지우지 않는다', () => {
  const meta = { pattern: 'golden-cross', provenance: { sourceDigest: 'a', rulesVersion: 'v3' } };
  const pair = [hit('A', 1), hit('B', -1)];
  assert.equal(studyKey(meta, pair), studyKey(meta, [...pair].reverse()));
  assert.notEqual(studyKey(meta, pair), studyKey({ ...meta, provenance: { ...meta.provenance, sourceDigest: 'b' } }, pair));
  // 예전 기준으로 짧았던 기록, 손상된 칸도 그대로 남긴다.
  const old = { submittedAt: 0.5, drafts: [{ observation: '짧음' }, {}], reflection: '' };
  let records = { corrupt: null, old };
  for (let i = 1; i <= 35; i++) records = keepStudy(records, 'key' + i, submitStudy(null, [draft(), draft()], i));
  assert.equal(Object.keys(records).length, 37); assert.ok(records.key1); assert.ok(records.key35);
  assert.equal(records.old, old); assert.ok('corrupt' in records);
  // 복기는 최초 근거를 바꾸지 않는다. 다른 최초 기록으로 덮어쓰려 해도 최초 근거는 그대로다.
  const first = records.key1, reflected = reflectStudy(first, '  결과와 별개로 관찰은 맞았다  ', 99);
  assert.deepEqual(reflected.drafts, first.drafts); assert.equal(reflected.reflectionAt, 99);
  records = keepStudy(records, 'key1', { ...submitStudy(null, [draft(), draft()], 500), reflection: '다른 복기', reflectionAt: 501 });
  assert.equal(records.key1.submittedAt, first.submittedAt);
  assert.equal(records.key1.reflection, '다른 복기');
  assert.throws(() => reflectStudy(first, '짧다'));
});

test('실제 4개 규칙의 모든 비교 쌍: 반례 포함, 공개 시점·20봉·원자료 정합성 일치', () => {
  const index = read('data/patterns/_index.json'), cache = new Map();
  for (const p of STUDY_PATTERNS) {
    const meta = read(`data/patterns/${p.id}.json`), pairs = comparisonPairs(meta, index.eligibleTickers);
    assert.ok(pairs.length > 0, p.id);
    const used = new Set();
    for (const pair of pairs) {
      assert.ok(pair[0].outcome.changePct * pair[1].outcome.changePct < 0);
      for (const h of pair) {
        const id = h.ticker + h.date; assert.ok(!used.has(id)); used.add(id);
        if (!cache.has(h.ticker)) cache.set(h.ticker, expandStock(read(`data/stocks/${h.ticker}.json`)));
        const s = cache.get(h.ticker), hidden = studyWindow(s, h), revealed = studyWindow(s, h, true);
        assert.equal(hidden.history.at(-1).date, h.confirmDate || h.date);
        assert.equal(revealed.history.length - hidden.history.length, 20);
        assert.equal(revealed.view.at(-1).date, h.outcome.toDate);
      }
    }
  }
});
