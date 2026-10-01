/**
 * 새 구간에서 다시 읽는 평가 — 연습과 같은 관찰 계산, 다른 사례 선별과 기록.
 *
 * 문제는 입문 과정과 같은 makeCourseQuestion() 으로 만든다. 판정 계산기를 따로 두지 않는다.
 * 여기서 정하는 것은 세 가지뿐이다.
 *   1. 어떤 날짜를 평가 사례로 고르는가 (sampleItems)
 *   2. 학생에게 보여준 구간이 연습 자료와 겹치는가 (shownRange, overlapBars)
 *   3. 평가 기록과 성적표 (assessmentRecord, scorecard)
 *
 * 선별 원칙
 *   - 이후 등락·수익률은 쓰지 않는다. 날짜 i 의 출제 여부는 i 까지의 봉과 고정된 상수로만 정해진다.
 *     그래서 i 뒤의 봉을 바꾸거나 잘라도 i 의 문제·정답·출제 여부는 그대로다.
 *   - 상태(bucket)와 경계 여부(margin)마다 표집 비율을 따로 둬서 정상·경계·혼재 사례가 함께 들어간다.
 *     표집 비율은 아래 상수로 고정한다. 자료에서 다시 계산하지 않는다.
 *   - 연습 자료(입문 과정, 실제 비교)에서 보여준 봉과 한 봉도 겹치지 않는 구간만 고른다.
 *     지표 계산에 쓰는 과거 이력은 화면에 나오지 않으므로 겹침으로 세지 않는다.
 */
import { COURSE_STEPS, TASKS, makeCourseQuestion, courseRecord, openCourseCase } from './chart-course.js';
import { STUDY_PATTERNS, comparisonPairs } from './real-study.js';
import { diagnose, CONFIDENCE } from './course-feedback.js';

export const ASSESSMENT_VERSION = '2026-10-01.1';
/** 영역 = 입문 과정의 여섯 단계. 같은 주제 분류를 쓴다. */
export const DOMAINS = COURSE_STEPS.map((s, i) => ({ id: 'd' + (i + 1), title: s.title, types: s.ids }));
export const DOMAIN_OF = Object.fromEntries(DOMAINS.flatMap((d) => d.types.map((t) => [t, d.id])));

/**
 * 경계 사례 기준. q.margin(문턱까지의 거리)이 이 값보다 작으면 경계로 본다.
 * 단위: 가격 대비 %, volume 은 배수, rsi 는 점수, atr 은 %p.
 * 2026-10-01 자료에서 주제별 하위 약 10% 지점을 반올림해 고정했다.
 * 상태 이름 자체가 경계를 뜻하는 주제(교차 대기, 거래량 근접, 장악형 조건 일부 불충족)는 bucket 으로 구분한다.
 */
export const EDGE_LIMIT = {
  candle: 0.15, wick: 0.15, timeframe: 0.15, trend: 0.25, level: 0.5,
  'ma-position': 0.4, 'ma-slope': 0.2, 'ma-settings': 0.3,
  volume: 0.05, atr: 0.07, bands: 0.5, rsi: 3, macd: 0.06, integrated: 0.06,
};
export const edgeOf = (q) => (EDGE_LIMIT[q.type] != null && q.margin != null && q.margin < EDGE_LIMIT[q.type] ? 1 : 0);

/**
 * 표집 비율. 키는 `주제|상태|경계`. 없는 키는 0(출제하지 않음).
 * tools/build-assessment.mjs --census 로 본 후보 수에 맞춰, 주제마다 겹침 검사 전 40개 안팎이
 * 상태별로 고르게 뽑히도록 정해 고정했다. 경계 사례는 주제의 약 1/3 을 목표로 한다.
 * 이 값을 바꾸면 ASSESSMENT_VERSION 을 올리고 data/assessment.json 을 다시 만든다.
 */
export const RATES = {
  'atr|0|0': 0.00014, 'atr|0|1': 0.00063, 'atr|1|0': 0.00013, 'atr|1|1': 0.00064,
  'bands|0|0': 0.00088, 'bands|0|1': 0.001, 'bands|1|0': 0.00005, 'bands|1|1': 0.00039, 'bands|2|0': 0.0011, 'bands|2|1': 0.0012,
  'candle|0|0': 0.000083, 'candle|0|1': 0.00061, 'candle|1|0': 0.00067, 'candle|1|1': 0.00099, 'candle|2|0': 0.00056, 'candle|2|1': 0.00084, 'candle|3|0': 0.000079, 'candle|3|1': 0.00066,
  // 교차는 입문 과정·실제 비교 연습이 교차 날짜를 많이 써서 노출 범위에 걸리는 비율이 높다. 다른 주제의 3배로 둔다.
  'cross-status|-1:fail|0': 0.0087, 'cross-status|-1:pass|0': 0.014, 'cross-status|-1:pending|0': 0.0025, 'cross-status|1:fail|0': 0.0072, 'cross-status|1:pass|0': 0.014, 'cross-status|1:pending|0': 0.0026,
  'engulf|pass|0': 0.011, 'engulf|size-fail|0': 0.0058, 'engulf|trend-fail|0': 0.0052,
  'integrated|aligned|0': 0.00011, 'integrated|aligned|1': 0.00077, 'integrated|mixed|0': 0.00019, 'integrated|mixed|1': 0.0005,
  'level|0|0': 0.00093, 'level|0|1': 0.0013, 'level|1|0': 0.0019, 'level|1|1': 0.00056, 'level|2|0': 0.000048, 'level|2|1': 0.00043,
  'limits|above|0': 0.00027, 'limits|below|0': 0.00029,
  'ma-position|0|0': 0.00008, 'ma-position|0|1': 0.0006, 'ma-position|1|0': 0.00032, 'ma-position|1|1': 0.00071, 'ma-position|2|0': 0.00033, 'ma-position|2|1': 0.00065, 'ma-position|3|0': 0.000091, 'ma-position|3|1': 0.00064,
  'ma-settings|0|0': 0.0001, 'ma-settings|0|1': 0.0006, 'ma-settings|1|0': 0.00019, 'ma-settings|1|1': 0.00064, 'ma-settings|2|0': 0.00018, 'ma-settings|2|1': 0.00065, 'ma-settings|3|0': 0.00011, 'ma-settings|3|1': 0.00064,
  'ma-slope|0|0': 0.000083, 'ma-slope|0|1': 0.00054, 'ma-slope|1|0': 0.00031, 'ma-slope|1|1': 0.00061, 'ma-slope|2|0': 0.00032, 'ma-slope|2|1': 0.00062, 'ma-slope|3|0': 0.000091, 'ma-slope|3|1': 0.00061,
  'macd|0|0': 0.00011, 'macd|0|1': 0.00063, 'macd|1|0': 0.00017, 'macd|1|1': 0.00066, 'macd|2|0': 0.00017, 'macd|2|1': 0.00071, 'macd|3|0': 0.00011, 'macd|3|1': 0.00071,
  'rsi|0|0': 0.0012, 'rsi|0|1': 0.0008, 'rsi|1|0': 0.000048, 'rsi|1|1': 0.00032, 'rsi|2|0': 0.002, 'rsi|2|1': 0.0011,
  'timeframe|0|0': 0.00011, 'timeframe|0|1': 0.00089, 'timeframe|1|0': 0.0002, 'timeframe|1|1': 0.0011, 'timeframe|2|0': 0.00018, 'timeframe|2|1': 0.00093, 'timeframe|3|0': 0.00011, 'timeframe|3|1': 0.001,
  'trend|0|0': 0.00014, 'trend|0|1': 0.001, 'trend|1|0': 0.00015, 'trend|1|1': 0.0012, 'trend|2|0': 0.00012, 'trend|2|1': 0.00035,
  'volume-rule|near|0': 0.0014, 'volume-rule|pass|0': 0.002, 'volume-rule|price-fail|0': 0.0036, 'volume-rule|repeat|0': 0.0023,
  'volume|0|0': 0.00007, 'volume|0|1': 0.00045, 'volume|1|0': 0.00015, 'volume|1|1': 0.00046, 'volume|2|0': 0.00075, 'volume|2|1': 0.0052,
  'wick|0|0': 0.00014, 'wick|0|1': 0.00063, 'wick|1|0': 0.00015, 'wick|1|1': 0.0006,
};

/** 결정적 균등값 [0,1). 날짜·종목·주제만 넣으므로 다른 날의 봉과 무관하다. */
export function uniform(text) {
  let h1 = 0xdeadbeef ^ 0x51ed27, h2 = 0x41c6ce57 ^ 0x51ed27;
  for (let k = 0; k < text.length; k++) {
    const ch = text.charCodeAt(k);
    h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)) / 2 ** 53;
}
const SALT = 'stockstudy-assessment';
export const drawOf = (type, ticker, date) => uniform(`${SALT}|${type}|${ticker}|${date}`);
const maxRate = (rates, type) => Math.max(0, ...Object.entries(rates).filter(([k]) => k.startsWith(type + '|')).map(([, v]) => v));

/**
 * 학생에게 보여주는 봉의 범위 [시작, 끝] (캔들 인덱스, 양끝 포함).
 * 입문 화면은 history.slice(-viewBars) 를 그리고, 주봉 문제는 주봉 20개를 따로 그린다.
 * 지표 계산에만 쓰는 앞쪽 이력은 포함하지 않는다.
 */
export function shownRange(q, candles, i) {
  let start = Math.max(0, i - q.viewBars + 1);
  if (q.weekly?.length) {
    // 주봉의 날짜는 그 주 마지막 거래일이다. 그 주의 첫 거래일까지 거슬러 올라가 묶인 봉을 모두 센다.
    let first = candles.findIndex((c) => c.date >= q.weekly[0].date);
    if (first >= 0) {
      const week = mondayOf(candles[first].date);
      while (first > 0 && mondayOf(candles[first - 1].date) === week) first--;
      start = Math.min(start, first);
    }
  }
  return [start, i];
}

function mondayOf(date) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
  return d.toISOString().slice(0, 10);
}

/** 두 범위가 함께 가진 봉 수 */
export const overlapBars = (a, b) => Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]) + 1);

/** 실제 비교 연습 화면이 결과 공개 뒤 보여주는 범위. real-study.js studyWindow() 와 같다. */
export function studyRange(candles, hit, revealBars = 20) {
  const i = candles.findIndex((c) => c.date === (hit.confirmDate || hit.date));
  if (i < 0) return null;
  return [Math.max(0, i - 99), Math.min(candles.length - 1, i + revealBars)];
}

/**
 * 연습 화면이 보여주는 범위를 종목별로 모은다.
 * stocks: Map(ticker → 원자료), courseCases: 입문 교재 사례, studyMetas: { 패턴 id → 패턴 자료 }.
 */
export function practiceExposure(stocks, courseCases, studyMetas, eligibleTickers) {
  const exposure = new Map([...stocks.keys()].map((t) => [t, []]));
  let course = 0, study = 0;
  for (const ref of courseCases) {
    const stock = stocks.get(ref.ticker), { question } = openCourseCase(stock, ref);
    exposure.get(ref.ticker).push(shownRange(question, stock.candles, stock.candles.findIndex((c) => c.date === ref.date)));
    course++;
  }
  for (const p of STUDY_PATTERNS) {
    for (const pair of comparisonPairs(studyMetas[p.id], eligibleTickers)) for (const hit of pair) {
      const range = studyRange(stocks.get(hit.ticker).candles, hit);
      if (!range) throw new Error('실제 비교 사례 날짜 없음: ' + hit.ticker);
      exposure.get(hit.ticker).push(range); study++;
    }
  }
  for (const ranges of exposure.values()) ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return { exposure, course, study };
}

/**
 * 한 종목에서 평가 사례를 고른다.
 * ctx: courseContext(전체 봉). exposure: 연습 자료가 보여준 범위 목록.
 * 날짜 순서대로 보며, 앞에서 이미 고른 평가 사례와 겹치면 건너뛴다.
 * 그래서 어떤 날의 출제 여부는 그날까지의 봉, 고정 상수, 연습 노출 범위에만 달려 있다.
 * 반환: { items, skipped: { exposure, self } }
 */
export function sampleItems(ctx, ticker, exposure = [], rates = RATES) {
  const cs = ctx.candles, items = [], skipped = { exposure: 0, self: 0 };
  const types = Object.keys(TASKS), limit = Object.fromEntries(types.map((t) => [t, maxRate(rates, t)]));
  for (let i = 120; i < cs.length; i++) {
    for (const type of types) {
      const u = drawOf(type, ticker, cs[i].date);
      if (!(u < limit[type])) continue;                       // 계산을 줄이는 사전 거르기. 결과는 같다.
      const q = makeCourseQuestion(ctx, i, type);
      if (!q) continue;
      const edge = edgeOf(q);
      if (!(u < (rates[`${type}|${q.bucket}|${edge}`] || 0))) continue;
      const range = shownRange(q, cs, i);
      if (exposure.some((r) => overlapBars(r, range) > 0)) { skipped.exposure++; continue; }
      if (items.some((x) => overlapBars(x.range, range) > 0)) { skipped.self++; continue; }
      items.push({ type, ticker, date: cs[i].date, bucket: q.bucket, edge, range });
    }
  }
  return { items, skipped };
}

export const itemId = (r) => `${r.type}|${r.ticker}|${r.date}`;

/* ───────────────────────── 기록 ───────────────────────── */

export const HELP = {
  hint: '읽는 방법 보기',
  values: '차트의 비교 값 보기',
};

/**
 * 평가 한 번의 제출 기록. 입문 기록(courseRecord)과 같은 자동 확인을 쓰고 아래를 더한다.
 *   kind: 'first'(그 문항을 처음 제출) | 'retry'(해설을 본 뒤 같은 문항을 다시 제출)
 *   help: 제출 전에 연 도움. 열었는지만 남긴다.
 *   choiceText: 고른 문장. 나중에 문항 정의가 바뀌어도 무엇을 골랐는지 보이게 한다.
 * 평가에서는 직접 계산 입력을 선택으로 둔다. 비교 값을 열지 않으면 계산할 숫자가 없기 때문이다.
 */
export function assessmentRecord(q, { choice, reflection = '', confidence, numeric, help = {}, kind = 'first', session = null }, now = Date.now()) {
  const blank = String(numeric ?? '').trim() === '';
  const base = courseRecord(null, choice, blank ? { ...q, numeric: null } : q, reflection, now, { numeric, confidence });
  return { ...base, kind: kind === 'retry' ? 'retry' : 'first',
    help: Object.fromEntries(Object.keys(HELP).map((k) => [k, help[k] === true])),
    choiceText: q.options[choice], reads: readResults(q, choice), session, version: ASSESSMENT_VERSION };
}

/**
 * 선택이 주장한 관찰마다 맞게 읽었는지. 성적표의 관찰별 집계에 쓴다.
 * 조건형 문제는 ‘조건 종합 판정’ 하나로 센다(실제 상태별로 나눠서).
 */
export function readResults(q, choice) {
  const d = diagnose(q, choice);
  if (d.kind === 'conditions') return [{ label: `조건 종합 판정 (${STATE_LABEL[d.truth] || d.truth} 사례)`, ok: d.correct }];
  return [...d.right.map((r) => ({ label: r.label, ok: true })), ...d.wrong.map((r) => ({ label: r.label, ok: false }))];
}
const STATE_LABEL = { pass: '충족', fail: '불충족', pending: '확인 대기' };
export const usedHelp = (r) => !!r?.help && Object.values(r.help).some(Boolean);

/**
 * 평가 저장 형식 v1
 *   { v: 1, items: { [itemId]: { first, retries: [] } }, shown: { [itemId]: 처음 화면에 낸 시각 }, session }
 * 최초 제출(first)은 한 번 정해지면 바꾸지 않는다. 재시도는 retries 에 덧붙인다.
 */
export function emptyAssessment() { return { v: 1, items: {}, shown: {}, session: null }; }
export function normalizeAssessment(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== 1) return emptyAssessment();
  return { v: 1, items: raw.items && typeof raw.items === 'object' ? raw.items : {},
    shown: raw.shown && typeof raw.shown === 'object' ? raw.shown : {}, session: raw.session || null };
}
export function addAttempt(state, id, record) {
  const prev = state.items[id];
  const entry = prev?.first ? { first: prev.first, retries: [...(prev.retries || []), { ...record, kind: 'retry' }] }
    : { first: { ...record, kind: 'first' }, retries: [] };
  return { ...state, items: { ...state.items, [id]: entry } };
}

/**
 * 짧은 세션: 영역마다 한 문항. 이 기능의 기록에서 한 번도 화면에 낸 적 없는 문항만 고른다.
 * 영역 안에서는 아직 덜 푼 주제를 먼저 고른다. 남은 새 문항이 없는 영역은 missing 에 넣고 채우지 않는다.
 */
export function pickSession(items, state, salt = '') {
  const seen = (r) => state.shown[itemId(r)] || state.items[itemId(r)];
  const tried = (type) => items.filter((r) => r.type === type && state.items[itemId(r)]?.first).length;
  const picked = [], missing = [];
  for (const d of DOMAINS) {
    const types = [...d.types].sort((a, b) => tried(a) - tried(b) || uniform(salt + a) - uniform(salt + b));
    let found = null;
    for (const type of types) {
      found = items.filter((r) => r.type === type && !seen(r))
        .sort((a, b) => uniform(salt + itemId(a)) - uniform(salt + itemId(b)))[0];
      if (found) break;
    }
    if (found) picked.push(itemId(found)); else missing.push(d.id);
  }
  return { ids: picked, missing };
}

/**
 * 영역별 성적표. 퍼센트나 합격선을 만들지 않고 횟수만 센다.
 *   first: 첫 시도 수 / 맞음, 도움 없이 / 도움 받고 를 나눈다.
 *   retry: 재시도 수 / 맞음 (같은 차트를 이미 본 뒤라 기억이 섞인다)
 *   numeric: 직접 계산을 적은 횟수 / 허용 범위 안
 *   reads: 관찰 이름별로 맞게 읽은 횟수 / 그 관찰이 걸린 첫 시도 수 (첫 시도 기록의 reads 로 센다)
 *   self: 자기 점검을 저장한 횟수 (점수 아님)
 */
export function scorecard(state, items) {
  const typeOf = Object.fromEntries(items.map((r) => [itemId(r), r.type]));
  const rows = Object.fromEntries(DOMAINS.map((d) => [d.id, {
    domain: d, first: 0, firstCorrect: 0, noHelp: 0, noHelpCorrect: 0, withHelp: 0, withHelpCorrect: 0,
    retry: 0, retryCorrect: 0, numeric: 0, numericOk: 0, self: 0, unsure: 0, reads: {} }]));
  for (const [id, entry] of Object.entries(state.items)) {
    const type = typeOf[id] || id.split('|')[0], row = rows[DOMAIN_OF[type]];
    if (!row || !entry?.first) continue;
    const f = entry.first;
    row.first++; row.firstCorrect += f.correct ? 1 : 0;
    if (usedHelp(f)) { row.withHelp++; row.withHelpCorrect += f.correct ? 1 : 0; }
    else { row.noHelp++; row.noHelpCorrect += f.correct ? 1 : 0; }
    if (f.confidence && f.confidence !== 'sure') row.unsure++;
    for (const r of [f, ...(entry.retries || [])]) {
      if (r.auto?.numeric) { row.numeric++; row.numericOk += r.auto.numeric.ok ? 1 : 0; }
      if (r.self) row.self++;
    }
    for (const r of entry.retries || []) { row.retry++; row.retryCorrect += r.correct ? 1 : 0; }
    for (const r of Array.isArray(f.reads) ? f.reads : []) {
      const cell = row.reads[r.label] ||= { right: 0, n: 0 };
      cell.n++; if (r.ok) cell.right++;
    }
  }
  return DOMAINS.map((d) => rows[d.id]);
}

/** 성적표에서 복습할 주제를 고른다. 오답·낮은 확신·도움 사용·자기 점검에서 표시하지 못한 항목. */
export function weakTopics(state) {
  const out = new Map();
  for (const [id, entry] of Object.entries(state.items)) {
    const f = entry?.first; if (!f) continue;
    const type = id.split('|')[0], why = [];
    if (!f.correct) why.push('wrong');
    if (f.confidence && f.confidence !== 'sure') why.push('unsure');
    if (usedHelp(f)) why.push('help');
    if (f.self && Object.values(f.self.checks || {}).some((v) => v === false)) why.push('self');
    if (why.length) out.set(type, [...new Set([...(out.get(type) || []), ...why])]);
  }
  return out;
}

export { CONFIDENCE, diagnose };
