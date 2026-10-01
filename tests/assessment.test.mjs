import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { COURSE_VERSION, TASKS, courseContext, makeCourseQuestion, openCourseCase } from '../src/lib/chart-course.js';
import { STUDY_PATTERNS } from '../src/lib/real-study.js';
import { expandStock } from '../src/lib/data-quality.js';
import { RULES_VERSION } from '../src/lib/rules-version.js';
import {
  ASSESSMENT_VERSION, DOMAINS, DOMAIN_OF, RATES, edgeOf, shownRange, overlapBars, practiceExposure, sampleItems,
  itemId, assessmentRecord, usedHelp, emptyAssessment, normalizeAssessment, addAttempt, pickSession, scorecard, weakTopics,
} from '../src/lib/assessment.js';

const read = (file) => JSON.parse(fs.readFileSync(new URL('../' + file, import.meta.url)));
const data = read('data/assessment.json'), course = read('data/chart-course.json'), index = read('data/patterns/_index.json');
const cache = new Map();
const stockOf = (t) => cache.get(t) || cache.set(t, expandStock(read(`data/stocks/${t}.json`))).get(t);
const allStocks = () => new Map(index.eligibleTickers.map((t) => [t, stockOf(t)]));
let exposureCache = null;
const exposureOf = () => exposureCache ||= practiceExposure(allStocks(), course.cases,
  Object.fromEntries(STUDY_PATTERNS.map((p) => [p.id, read(`data/patterns/${p.id}.json`)])), index.eligibleTickers);
const questionOf = (ref) => openCourseCase(stockOf(ref.ticker), ref).question;

test('평가 자료: 버전 연결, 18주제·6영역, 상태와 경계 사례가 섞여 있고 결과 수치는 없다', () => {
  assert.equal(data.version, ASSESSMENT_VERSION);
  assert.equal(data.courseVersion, COURSE_VERSION);
  assert.equal(data.provenance.rulesVersion, RULES_VERSION);
  assert.equal(data.provenance.sourceDigest, index.provenance.sourceDigest);
  assert.deepEqual(new Set(data.items.map((r) => r.type)), new Set(Object.keys(TASKS)));
  for (const d of DOMAINS) assert.ok(data.items.filter((r) => DOMAIN_OF[r.type] === d.id).length >= 20, d.title);
  assert.ok(data.items.some((r) => r.edge === 1));
  for (const type of Object.keys(TASKS)) assert.ok(new Set(data.items.filter((r) => r.type === type).map((r) => r.bucket)).size >= 2, type);
  // 경계·혼재 상태를 이름으로 가진 주제에도 그 상태가 들어 있다.
  for (const bucket of ['near', 'price-fail']) assert.ok(data.items.some((r) => r.type === 'volume-rule' && r.bucket === bucket), bucket);
  assert.ok(data.items.some((r) => r.type === 'integrated' && r.bucket === 'mixed'));
  assert.ok(data.items.some((r) => r.type === 'cross-status' && r.bucket.endsWith(':pending')));
  for (const r of data.items) {
    assert.deepEqual(Object.keys(r).sort(), ['bars', 'bucket', 'date', 'edge', 'lessonOverlap', 'shown', 'ticker', 'type']);
  }
  assert.equal(new Set(data.items.map(itemId)).size, data.items.length);
});

test('평가 구간은 입문 480사례·실제 비교 연습의 화면 구간과 한 봉도 겹치지 않고, 서로도 겹치지 않는다', () => {
  const { exposure, course: c, study } = exposureOf();
  assert.equal(c, course.cases.length);
  assert.equal(study, data.exposure.studyCases);
  const byTicker = new Map();
  for (const r of data.items) {
    const stock = stockOf(r.ticker), i = stock.candles.findIndex((x) => x.date === r.date);
    const q = questionOf(r);
    assert.equal(q.bucket, r.bucket);
    assert.equal(edgeOf(q), r.edge);
    const range = shownRange(q, stock.candles, i);
    assert.deepEqual([stock.candles[range[0]].date, stock.candles[range[1]].date], r.shown);
    for (const e of exposure.get(r.ticker)) assert.equal(overlapBars(e, range), 0, `${itemId(r)} 연습 노출과 겹침`);
    for (const other of byTicker.get(r.ticker) || []) assert.equal(overlapBars(other, range), 0, `${itemId(r)} 평가끼리 겹침`);
    byTicker.set(r.ticker, [...(byTicker.get(r.ticker) || []), range]);
  }
});

test('날짜만 조금 바꾼 입문 사례는 크게 겹치는 재출제로 식별되어 평가에 들어가지 않는다', () => {
  const { exposure } = exposureOf();
  let checked = 0;
  for (const ref of course.cases.filter((r) => ['ma-position', 'rsi', 'macd', 'level'].includes(r.type)).slice(0, 12)) {
    const stock = stockOf(ref.ticker), cs = stock.candles, i = cs.findIndex((c) => c.date === ref.date) + 3;
    const ctx = courseContext(cs.slice(0, i + 1)), q = makeCourseQuestion(ctx, i, ref.type);
    if (!q) continue;
    const range = shownRange(q, cs, i);
    const worst = Math.max(...exposure.get(ref.ticker).map((e) => overlapBars(e, range)));
    assert.ok(worst / (range[1] - range[0] + 1) > 0.9, `${ref.type} ${ref.date}: 3봉 뒤 구간은 대부분 같은 봉`);
    // 그 날짜를 반드시 뽑는 표집 비율을 줘도 노출 겹침으로 빠진다.
    const rates = { [`${ref.type}|${q.bucket}|${edgeOf(q)}`]: 1 };
    const { items, skipped } = sampleItems(ctx, ref.ticker, exposure.get(ref.ticker), rates);
    assert.ok(!items.some((x) => x.date === cs[i].date), ref.date);
    assert.ok(skipped.exposure > 0);
    checked++;
  }
  assert.ok(checked >= 8);
});

test('미래 봉을 바꾸거나 잘라도 그 이전 날짜의 정답·출제 여부는 그대로다', () => {
  const { exposure } = exposureOf();
  const tickers = [...new Set(data.items.map((r) => r.ticker))].slice(0, 6);
  for (const ticker of tickers) {
    const cs = stockOf(ticker).candles, cut = Math.floor(cs.length * 0.6);
    const original = sampleItems(courseContext(cs), ticker, exposure.get(ticker)).items.filter((r) => r.date <= cs[cut].date);
    // 뒤쪽 봉을 뒤틀어 가격·거래량을 바꾼다.
    const warped = cs.map((c, k) => k <= cut ? c : { ...c, open: c.open * 1.7, high: c.high * 1.9, low: c.low * 0.5, close: c.close * (k % 2 ? 0.6 : 1.8), volume: c.volume * 9 + 1 });
    const changed = sampleItems(courseContext(warped), ticker, exposure.get(ticker)).items.filter((r) => r.date <= cs[cut].date);
    const truncated = sampleItems(courseContext(cs.slice(0, cut + 1)), ticker, exposure.get(ticker)).items;
    assert.deepEqual(changed, original, ticker + ' 뒤틀기');
    assert.deepEqual(truncated, original, ticker + ' 자르기');
    // 저장된 평가 사례도 그날까지의 봉만으로 같은 정답이 나온다.
    for (const r of data.items.filter((x) => x.ticker === ticker && x.date <= cs[cut].date)) {
      const i = cs.findIndex((c) => c.date === r.date);
      const a = makeCourseQuestion(courseContext(cs.slice(0, i + 1)), i, r.type), b = makeCourseQuestion(courseContext(warped), i, r.type);
      assert.equal(a.answer, b.answer); assert.equal(a.bucket, b.bucket); assert.equal(a.explanation, b.explanation);
    }
  }
});

test('표집 비율은 상수이며 결과 값(등락·수익률)을 참조하지 않는다', () => {
  const src = fs.readFileSync(new URL('../src/lib/assessment.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /outcome|changePct|winRate/);
  assert.ok(Object.values(RATES).every((v) => v > 0 && v <= 1));
  assert.deepEqual(data.rates, RATES);
});

const fakeQ = () => questionOf(data.items.find((r) => r.type === 'ma-position'));

test('도움 사용은 문항마다 기록되고, 도움 없이 / 받고 / 재시도를 따로 센다', () => {
  const q = fakeQ(), wrong = (q.answer + 1) % q.options.length;
  const id = itemId(data.items.find((r) => r.type === 'ma-position'));
  const plain = assessmentRecord(q, { choice: q.answer, confidence: 'sure' }, 1000);
  const helped = assessmentRecord(q, { choice: wrong, help: { hint: true, values: false, extra: true } }, 2000);
  assert.equal(usedHelp(plain), false);
  assert.equal(usedHelp(helped), true);
  assert.deepEqual(helped.help, { hint: true, values: false });
  assert.equal(helped.choiceText, q.options[wrong]);
  assert.ok(helped.reads.some((r) => r.ok === false));
  let state = addAttempt(emptyAssessment(), id, helped);
  state = addAttempt(state, id, plain);        // 해설 뒤 다시 풀어도 첫 시도는 그대로
  assert.equal(state.items[id].first.submittedAt, 2000);
  assert.equal(state.items[id].first.correct, false);
  assert.equal(state.items[id].retries.length, 1);
  assert.equal(state.items[id].retries[0].kind, 'retry');
  const row = scorecard(state, data.items).find((r) => r.domain.id === DOMAIN_OF['ma-position']);
  assert.equal(row.first, 1); assert.equal(row.withHelp, 1); assert.equal(row.noHelp, 0);
  assert.equal(row.retry, 1); assert.equal(row.retryCorrect, 1); assert.equal(row.firstCorrect, 0);
  assert.ok(Object.values(row.reads).every((c) => c.n >= 1));
  assert.deepEqual(weakTopics(state).get('ma-position').sort(), ['help', 'wrong']);
});

test('평가 수치 입력은 선택이며, 적으면 입문 과정과 같은 기준으로 확인한다', () => {
  const ref = data.items.find((r) => r.type === 'volume'), q = questionOf(ref);
  const blank = assessmentRecord(q, { choice: q.answer, numeric: '' }, 1);
  assert.equal(blank.auto.numeric, null);
  const typed = assessmentRecord(q, { choice: q.answer, numeric: q.numeric.value.toFixed(2) }, 1);
  assert.equal(typed.auto.numeric.ok, true);
  assert.throws(() => assessmentRecord(q, { choice: q.answer, numeric: 'abc' }, 1), /숫자로/);
});

test('세션은 영역마다 기록상 처음 보는 문항만 고르고, 남은 것이 없으면 몰래 채우지 않는다', () => {
  let state = emptyAssessment();
  const s1 = pickSession(data.items, state, 'a');
  assert.equal(s1.ids.length, DOMAINS.length);
  assert.deepEqual(new Set(s1.ids.map((id) => DOMAIN_OF[id.split('|')[0]])), new Set(DOMAINS.map((d) => d.id)));
  state = { ...state, shown: Object.fromEntries(s1.ids.map((id) => [id, 1])) };
  const s2 = pickSession(data.items, state, 'a');
  assert.equal(s2.ids.filter((id) => s1.ids.includes(id)).length, 0);
  // 한 영역의 문항을 모두 본 것으로 표시하면 그 영역은 빠지고 missing 에 남는다.
  const d1 = DOMAINS[0];
  state = { ...state, shown: { ...state.shown, ...Object.fromEntries(data.items.filter((r) => DOMAIN_OF[r.type] === d1.id).map((r) => [itemId(r), 1])) } };
  const s3 = pickSession(data.items, state, 'b');
  assert.deepEqual(s3.missing, [d1.id]);
  assert.equal(s3.ids.length, DOMAINS.length - 1);
  // 저장본이 깨졌거나 모르는 형식이면 빈 기록으로 읽되 원본을 바꾸지 않는다.
  const broken = { v: 9, items: 'x' };
  assert.deepEqual(normalizeAssessment(broken), emptyAssessment());
  assert.deepEqual(broken, { v: 9, items: 'x' });
});

test('주봉 문제의 화면 구간은 주봉 20개에 묶인 일봉을 첫 주의 첫 거래일부터 모두 센다', () => {
  for (const r of data.items.filter((x) => x.type === 'timeframe').slice(0, 5)) {
    const cs = stockOf(r.ticker).candles, i = cs.findIndex((c) => c.date === r.date), q = questionOf(r);
    const [start] = shownRange(q, cs, i);
    const monday = (d) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - (t.getUTCDay() + 6) % 7); return t.toISOString().slice(0, 10); };
    assert.equal(monday(cs[start].date), monday(q.weekly[0].date), r.date);
    assert.notEqual(monday(cs[start - 1].date), monday(q.weekly[0].date), r.date);
    assert.ok(start <= i - q.viewBars + 1);
  }
});
