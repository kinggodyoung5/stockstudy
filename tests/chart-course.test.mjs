import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { COURSE_VERSION, COURSE_STEPS, TASKS, courseContext, makeCourseQuestion, openCourseCase, courseRecord } from '../src/lib/chart-course.js';
import { crossCondition, volumeCondition } from '../src/lib/signal-conditions.js';
import { expandStock } from '../src/lib/data-quality.js';
import { evaluateSignals, QUIZ_RULES } from '../src/lib/quiz-signals.js';
import { detectStock, ALL_PATTERNS } from '../src/lib/engine.js';
import { detectStock as detectIndicators } from '../src/lib/patterns.js';
import { detectCandlePatterns, candleEvidence } from '../src/lib/candlestick.js';
import { RULES_VERSION } from '../src/lib/rules-version.js';
import { withEvidenceUnit } from '../src/lib/evidence-units.js';
import { formatEvidence } from '../src/lib/ui.js';
import { LESSON_BY_ID, LESSONS } from '../src/content/lessons.js';
import { FIGURES } from '../src/content/figures.js';
import { LESSON_SETTINGS } from '../src/content/settings.js';

const read = (file) => JSON.parse(fs.readFileSync(new URL('../' + file, import.meta.url)));
const course = read('data/chart-course.json'), index = read('data/patterns/_index.json');
const cache = new Map();
const stockOf = (ticker) => {
  if (!cache.has(ticker)) cache.set(ticker, expandStock(read(`data/stocks/${ticker}.json`)));
  return cache.get(ticker);
};

test('실제 차트 8단계·26주제·832사례: 86종목, 104상태, 레슨·자료 버전 연결', () => {
  assert.equal(course.version, COURSE_VERSION);
  assert.equal(course.provenance.rulesVersion, RULES_VERSION);
  assert.equal(course.provenance.sourceDigest, index.provenance.sourceDigest);
  assert.equal(COURSE_STEPS.length, 8); assert.equal(Object.keys(TASKS).length, 26);
  assert.equal(course.cases.length, 832);
  assert.equal(new Set(course.cases.map((r) => r.ticker)).size, 86);
  assert.equal(new Set(course.cases.map((r) => `${r.type}|${r.bucket}`)).size, 104);
  assert.deepEqual(new Set(COURSE_STEPS.flatMap((s) => s.ids)), new Set(Object.keys(TASKS)));
  const dates = course.cases.map((r) => r.date);
  assert.ok(Math.min(...dates.map((d) => +d.slice(0, 4))) <= 2016);
  assert.ok(Math.max(...dates.map((d) => +d.slice(0, 4))) >= 2025);
  for (const [, lesson] of Object.values(TASKS)) assert.ok(LESSON_BY_ID[lesson]);
  for (const r of course.cases) {
    assert.ok(index.eligibleTickers.includes(r.ticker));
    assert.deepEqual(Object.keys(r).sort(), ['bucket', 'date', 'ticker', 'type']);
  }
});

test('모든 실전 문제: 원자료·정답·근거·표시 이력이 일치하고 미래 봉이 없다', () => {
  for (const ref of course.cases) {
    const s = stockOf(ref.ticker), { question: q, view, history } = openCourseCase(s, ref);
    assert.equal(view.at(-1).date, ref.date); assert.equal(history.at(-1).date, ref.date);
    assert.ok(q.options[q.answer]); assert.ok(q.explanation.length > 40); assert.ok(q.hint.length > 20);
    assert.ok(q.facts.length > 0); assert.equal(new Set(q.options).size, q.options.length);
    assert.ok(q.markers.every((m) => view.some((c) => c.date === m.date)));
    // 제출 뒤에만 보일 표시와 선의 점도 화면 구간 안에 있고, 관찰 마감일을 넘지 않는다.
    assert.ok((q.revealMarkers || []).every((m) => view.some((c) => c.date === m.date)), ref.type);
    for (const line of q.lines) for (const p of line.points || [{ date: line.from }]) {
      assert.ok(p.date <= ref.date, ref.type);
      assert.ok(history.some((c) => c.date === p.date), ref.type);
    }
    assert.ok(!/NaN|Infinity|undefined/.test(JSON.stringify(q)));
    if (q.weekly) {
      assert.equal(q.weekly.at(-1).date, q.focusDate); assert.ok(q.focusDate < ref.date);
      const daily = history.filter((c) => c.date > q.weekly.at(-2).date && c.date <= q.focusDate);
      assert.equal(q.weekly.at(-1).open, daily[0].open);
      assert.equal(q.weekly.at(-1).close, daily.at(-1).close);
    }
  }
});

test('각 상태에서 미래 가격·거래량을 크게 바꿔도 질문·해설·정답이 그대로다', () => {
  const seen = new Set();
  for (const ref of course.cases) {
    const key = ref.type + ref.bucket; if (seen.has(key)) continue; seen.add(key);
    const s = stockOf(ref.ticker), i = s.candles.findIndex((c) => c.date === ref.date);
    const changed = s.candles.map((c, j) => j <= i ? c : { ...c, open: c.open * 4, high: c.high * 4, low: c.low * 4, close: c.close * 4, volume: c.volume * 3 });
    assert.deepEqual(makeCourseQuestion(courseContext(changed), i, ref.type), openCourseCase(s, ref).question, key);
  }
});

test('충족·불충족·대기와 경계·맥락 반례를 실제 자료에서 모두 제공한다', () => {
  const buckets = (type) => new Set(course.cases.filter((r) => r.type === type).map((r) => r.bucket));
  assert.deepEqual(buckets('cross-status'), new Set(['1:pass', '1:fail', '1:pending', '-1:pass', '-1:fail', '-1:pending']));
  assert.deepEqual(buckets('volume-rule'), new Set(['pass', 'near', 'price-fail', 'repeat']));
  assert.deepEqual(buckets('engulf'), new Set(['pass', 'size-fail', 'trend-fail', 'both-fail']));
  assert.deepEqual(buckets('limits'), new Set(['fact', 'interp', 'invalidation', 'claim']));
  assert.deepEqual(buckets('wick'), new Set(['0', '1', '2', '3']));
  assert.deepEqual(buckets('atr'), new Set(['0', '1', '2', '3']));
  assert.deepEqual(buckets('integrated'), new Set(['aligned', 'mixed']));
  for (const type of ['trendline', 'divergence']) {
    assert.deepEqual(buckets(type), new Set(['pass', 'fail', 'pending'].flatMap((s) => (type === 'trendline' ? ['up', 'down'] : ['bull', 'bear']).map((d) => `${d}:${s}`))), type);
  }
  assert.deepEqual(buckets('retest'), new Set(['hold', 'retest', 'fail']));
  assert.deepEqual(buckets('mtf'), new Set(['uu', 'ud', 'du', 'dd', 'mixed']));
  assert.deepEqual(buckets('candle-context'), new Set(['down', 'up', 'none']));
  for (const type of Object.keys(TASKS)) assert.ok(buckets(type).size >= 2, type);
});

test('모든 주제에서 모든 선택지가 교재의 어느 사례에서는 정답이다 (찍어서 맞힐 수 있는 2지선다 금지)', () => {
  for (const type of Object.keys(TASKS)) {
    const qs = course.cases.filter((r) => r.type === type).map((r) => openCourseCase(stockOf(r.ticker), r).question);
    // 선택지 문장이 사례마다 바뀌는 주제(종합 읽기)는 정답 문장이 사례마다 달라야 한다. 화면에서는 위치도 섞는다.
    if (new Set(qs.map((q) => JSON.stringify(q.options))).size > 1) {
      assert.ok(new Set(qs.map((q) => q.options[q.answer])).size > 1, type);
      continue;
    }
    const answers = new Set(qs.map((q) => q.answer));
    for (let k = 0; k < qs[0].options.length; k++) assert.ok(answers.has(k), `${type} 선택지 ${k}`);
  }
});

test('문장 종류 문제는 같은 날이면 같은 문장이고, 네 종류의 정답이 모두 나온다', () => {
  const refs = course.cases.filter((r) => r.type === 'limits');
  assert.deepEqual(new Set(refs.map((r) => openCourseCase(stockOf(r.ticker), r).question.answer)), new Set([0, 1, 2, 3]));
  for (const r of refs.slice(0, 4)) {
    const a = openCourseCase(stockOf(r.ticker), r).question, b = openCourseCase(stockOf(r.ticker), r).question;
    assert.equal(a.prompt, b.prompt); assert.match(a.prompt, /^“.+”는 어떤 종류의 문장인가요\?$/);
  }
});

test('실제 식별 교재의 정답은 레슨 엔진과 일치한다 (미래를 잘라 검사)', () => {
  for (const ref of course.cases.filter((r) => ['cross-status', 'volume-rule', 'engulf'].includes(r.type))) {
    const s = stockOf(ref.ticker), { question: q, history } = openCourseCase(s, ref), prefix = { ...s, candles: history };
    if (ref.type === 'engulf') {
      const hits = detectCandlePatterns(prefix)['bullish-engulfing'];
      assert.equal(hits.some((h) => h.date === ref.date), q.answer === 0);
      assert.equal(!!candleEvidence('bullish-engulfing', history, history.length - 1), q.answer === 0);
    } else if (ref.type === 'volume-rule') {
      assert.equal(detectIndicators(prefix)['volume-spike'].some((h) => h.date === ref.date), q.answer === 0);
    } else {
      const id = ref.bucket.startsWith('1:') ? 'golden-cross' : 'dead-cross';
      const hit = detectIndicators(prefix)[id].find((h) => h.date === q.markers[0].date);
      assert.equal(!hit ? 'fail' : hit.confirmDate ? 'pass' : 'pending', ref.bucket.split(':')[1]);
    }
  }
});

test('교차 확인일 경계와 거래량 2배·등락 2%·10거래일 경계를 반올림 없이 검사', () => {
  const a = Array(30).fill(9), b = Array(30).fill(10); a.fill(11, 22);
  assert.equal(crossCondition(a, b, 22, 26).status, 'pending');
  assert.equal(crossCondition(a, b, 22, 27).status, 'pass');
  a[24] = 10; assert.equal(crossCondition(a, b, 22, 26).status, 'fail');
  const cs = Array.from({ length: 30 }, () => ({ close: 100, volume: 100 }));
  cs[25] = { close: 102, volume: 200 };
  assert.equal(volumeCondition(cs, 25, 14).status, 'pass');
  assert.equal(volumeCondition(cs, 25, 15).status, 'fail');
  cs[25].volume = 199.999; assert.equal(volumeCondition(cs, 25).status, 'fail');
  cs[25].volume = 200; cs[25].close = 101.999; assert.equal(volumeCondition(cs, 25).status, 'fail');
});

test('보조 퀴즈는 동일 엔진의 최근 10거래일 확인 완료 조건만 세며 미래에 불변', () => {
  for (const id of QUIZ_RULES) assert.ok(ALL_PATTERNS[id], id);
  const refs = ['pass', 'pending', 'fail'].map((status) => course.cases.find((r) => r.type === 'cross-status' && r.bucket === '1:' + status));
  for (const ref of refs) {
    const s = stockOf(ref.ticker), i = s.candles.findIndex((c) => c.date === ref.date), candles = s.candles.slice(0, i + 1);
    const signals = evaluateSignals(s, i), raw = detectStock({ ...s, candles });
    for (const signal of signals) {
      const dates = raw[signal.id].map((h) => h.confirmLag ? h.confirmDate : h.date).filter((d) => d && d >= candles.at(-10).date);
      assert.deepEqual(signal.dates, dates); assert.equal(signal.present, dates.length > 0);
      assert.deepEqual(signal.rules, ALL_PATTERNS[signal.id].rules);
      assert.equal('bias' in signal, false);
    }
    assert.deepEqual(signals, evaluateSignals({ ...s, candles }, i));
  }
});

test('제출 전 근거·유효 선택을 검사하고 최초 답은 재제출로 덮어쓰지 않는다', () => {
  const q = openCourseCase(stockOf(course.cases[0].ticker), course.cases[0]).question;
  assert.throws(() => courseRecord(null, null, q, ''));
  assert.throws(() => courseRecord(null, 0, { ...q, reflection: '근거' }, ''));
  const record = courseRecord(null, 0, q, '', 1000);
  assert.equal(courseRecord(record, 1, q, '바꾼 근거', 2000), record);
  assert.throws(() => openCourseCase({ ...stockOf(course.cases[0].ticker), ticker: 'BAD' }, course.cases[0]));
});

test('수치 근거 전부 명시 단위, 미등록 단위를 가격으로 추측하지 않는다', () => {
  for (const id of Object.keys(ALL_PATTERNS)) for (const h of read(`data/patterns/${id}.json`).hits) {
    for (const e of h.evidence) if (typeof e.value === 'number') assert.ok(e.unit, `${id}:${e.label}`);
  }
  assert.throws(() => withEvidenceUnit({ label: '새 지표', value: 1 }));
  assert.equal(formatEvidence({ label: '새 지표', value: 1 }, 'USD'), '1 (단위 미확인)');
});

test('모든 레슨과 설정의 도해 참조가 살아 있고 이전 단정 문구는 제거됐다', () => {
  for (const lesson of LESSONS) for (const section of lesson.body) if (section.fig) assert.ok(FIGURES[section.fig], section.fig);
  for (const settings of Object.values(LESSON_SETTINGS)) if (settings?.fig) assert.ok(FIGURES[settings.fig]);
  for (const fig of Object.values(FIGURES)) assert.ok(fig.svg().includes('<svg'));
  assert.ok(!JSON.stringify(LESSON_SETTINGS).includes('더 확실한 것만 남습니다'));
  assert.ok(!JSON.stringify(LESSONS).includes('승률이 69%까지'));
});
