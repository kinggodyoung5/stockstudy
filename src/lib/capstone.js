/**
 * 종합 관찰지 — 한 장의 차트를 처음부터 끝까지 읽고 계획까지 적는 연습 (#/practice/plan).
 *
 * 관찰 부분은 입문 과정과 같은 makeCourseQuestion() 으로 같은 날짜의 여러 주제 문제를 만든다.
 * 계산기를 따로 두지 않는다. 근거 네 칸은 자동 채점하지 않고 자기 점검으로만 본다.
 * 계획은 plan.js 로 거리·비율·수량만 계산하고, 좋고 나쁨을 판정하지 않는다.
 * 제출 전에는 관찰 마감일까지의 봉만 쓴다. 이후 20봉은 제출한 뒤에 공개한다.
 */
import { courseContext, makeCourseQuestion } from './chart-course.js';
import { diagnose, SELF_CHECKS } from './course-feedback.js';
import { inspectStock } from './data-quality.js';
import { planError, planMetrics, planOutcome } from './plan.js';
import { uniform } from './hash.js';

export const CAPSTONE_VERSION = 1;
export const CAPSTONE_KEY = 'plan:v1';
/** 묻는 순서: 큰 구조 → 시간 단위 → 평균 → 거래량 → 모멘텀 */
export const CAPSTONE_PARTS = ['trend', 'mtf', 'ma-position', 'volume', 'rsi', 'macd'];
export const CAPSTONE_MIN_PARTS = 4;
/** 사례를 가져오는 입문 교재 주제. 돌파·되돌림처럼 계획을 세울 만한 자리와, 방향이 엇갈리는 자리를 함께 쓴다. */
export const CAPSTONE_SOURCES = ['mtf', 'retest', 'breakout-volume'];
export const NOTE_FIELDS = [
  ['observation', '관찰한 사실', '날짜, 가격대, 고점·저점, 평균선 위치처럼 차트에서 확인한 것'],
  ['interpretation', '해석과 조건', '그 사실을 어떻게 읽었고, 어떤 조건에서 그 해석이 맞는지'],
  ['counter', '반대 근거 또는 모르는 점', '내 해석과 맞지 않는 관찰, 이 차트만으로 알 수 없는 것'],
  ['invalidation', '해석을 바꿀 조건', '어떤 종가나 가격대가 나오면 생각을 바꿀지'],
];
export const CAPSTONE_SELF = ['number', 'separate', 'counter', 'invalidation', 'noforecast'];
export const NOTE_MIN = 8;

/** 사례 목록. 입문 교재에서 고르고 종목·날짜가 겹치면 하나만 둔다. 순서는 결정적으로 섞는다. */
export function capstoneRefs(courseCases) {
  const seen = new Set(), out = [];
  for (const r of courseCases) {
    if (!CAPSTONE_SOURCES.includes(r.type)) continue;
    const key = `${r.ticker}|${r.date}`;
    if (seen.has(key)) continue;
    seen.add(key); out.push({ ticker: r.ticker, date: r.date });
  }
  return out.sort((a, b) => uniform(`capstone|${a.ticker}|${a.date}`) - uniform(`capstone|${b.ticker}|${b.date}`));
}
export const capstoneId = (ref) => `capstone|${ref.ticker}|${ref.date}`;

/** 관찰 마감일까지의 자료로 문제를 만든다. 관찰 문항이 4개보다 적으면 null. */
export function openCapstone(stock, ref) {
  if (stock.ticker !== ref.ticker || !inspectStock(stock).eligible) throw new Error('학습용 원자료 검사 실패');
  const i = stock.candles.findIndex((c) => c.date === ref.date);
  if (i < 160) return null;
  const history = stock.candles.slice(0, i + 1), ctx = courseContext(history);
  const parts = CAPSTONE_PARTS.map((type) => makeCourseQuestion(ctx, i, type)).filter(Boolean);
  if (parts.length < CAPSTONE_MIN_PARTS) return null;
  return { i, history, view: history.slice(-120), parts, close: history[i].close, atr: ctx.atr[i] };
}

/** 제출 뒤 공개할 범위. 마감일 뒤 20봉까지(자료가 모자라면 있는 만큼). */
export function revealWindow(stock, i, days = 20) {
  const end = Math.min(stock.candles.length - 1, i + days);
  return { history: stock.candles.slice(0, end + 1), view: stock.candles.slice(Math.max(0, i - 99), end + 1), end };
}

const textOk = (v) => typeof v === 'string' && v.trim().length >= NOTE_MIN;

/**
 * 처음 제출한 관찰지. 한 번 만든 기록은 바꾸지 않는다.
 * input: { choices: { 주제: 선택 }, notes: { 칸: 글 }, plan: { mode: 'plan'|'pass', invalid, target }, confidence }
 */
export function capstoneRecord(open, input, now = Date.now()) {
  const parts = {};
  for (const q of open.parts) {
    const choice = input.choices?.[q.type];
    if (!Number.isInteger(choice) || !q.options[choice]) throw new Error(`‘${q.title}’의 답을 고르세요.`);
    const d = diagnose(q, choice);
    parts[q.type] = { choice, choiceText: q.options[choice], correct: d.correct,
      wrong: d.kind === 'reads' ? d.wrong.map((r) => r.id) : [] };
  }
  const notes = {};
  for (const [k, label] of NOTE_FIELDS) {
    if (!textOk(input.notes?.[k])) throw new Error(`‘${label}’ 칸을 ${NOTE_MIN}자 이상 적으세요.`);
    notes[k] = input.notes[k].trim().slice(0, 1000);
  }
  let plan = null;
  if (input.plan?.mode === 'plan') {
    const invalid = Number(input.plan.invalid), target = input.plan.target === '' || input.plan.target == null ? null : Number(input.plan.target);
    const err = planError({ close: open.close, invalid, target });
    if (err) throw new Error(err);
    plan = { mode: 'plan', invalid, target, metrics: planMetrics({ close: open.close, atr: open.atr, invalid, target }) };
  } else if (input.plan?.mode === 'pass') {
    plan = { mode: 'pass' };
  } else throw new Error('계획을 세울지, 이 차트에서는 계획을 세우지 않을지(관망) 고르세요.');
  return { v: CAPSTONE_VERSION, submittedAt: now, close: open.close, atr: open.atr, parts, notes, plan,
    confidence: ['sure', 'half', 'unsure'].includes(input.confidence) ? input.confidence : null, self: null, review: null };
}

/** 제출한 계획의 이후 20봉 결과. 기록에 저장하지 않고 원자료에서 매번 다시 계산한다. */
export function capstoneOutcome(stock, i, record) {
  if (record.plan?.mode !== 'plan') return null;
  return planOutcome(stock.candles, i, record.plan);
}

/** 해설을 본 뒤의 자기 점검과 복기. 처음 기록은 그대로 둔다. */
export function capstoneReview(record, checks, note, now = Date.now()) {
  if (!record?.submittedAt) throw new Error('먼저 관찰지를 제출하세요.');
  const picked = Object.fromEntries(CAPSTONE_SELF.filter((id) => SELF_CHECKS[id]).map((id) => [id, checks?.[id] === true]));
  return { ...record, self: { at: now, checks: picked, note: String(note || '').trim().slice(0, 1000) } };
}

/** 지금까지의 관찰지 요약. 계획이 맞았는지는 세지 않는다. */
export function capstoneSummary(items) {
  const records = Object.values(items || {}).filter((r) => r?.submittedAt);
  const plans = records.filter((r) => r.plan?.mode === 'plan');
  const atrs = plans.map((r) => r.plan.metrics?.riskAtr).filter(Number.isFinite).sort((a, b) => a - b);
  const partsN = records.reduce((n, r) => n + Object.keys(r.parts || {}).length, 0);
  const partsOk = records.reduce((n, r) => n + Object.values(r.parts || {}).filter((p) => p.correct).length, 0);
  return { n: records.length, plans: plans.length, passes: records.filter((r) => r.plan?.mode === 'pass').length,
    medianRiskAtr: atrs.length ? atrs[Math.floor(atrs.length / 2)] : null, partsN, partsOk };
}
