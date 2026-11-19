import { closes, sma, bollinger } from './indicators.js';
import { rsi, macd, atr, trueRange } from './oscillators.js';
import { volumeCondition } from './signal-conditions.js';
import { diagnose, checkNumeric, CONFIDENCE } from './course-feedback.js';
import { inspectStock } from './data-quality.js';
import { TOPIC_BUILDERS } from './course-topics/index.js';
import { n } from './course-topics/format.js';

export const COURSE_VERSION = '2026-11-19.1';
export const COURSE_STEPS = [
  { title: '가격과 시간', intro: '봉의 색과 전일 대비 등락은 비교하는 가격이 다릅니다. 실제 숫자로 확인해봅니다.', ids: ['candle', 'wick', 'timeframe'] },
  { title: '추세와 가격대', intro: '관찰 범위를 정하고 고점·저점을 비교합니다. 선을 잠깐 넘는 것과 종가로 넘는 것도 구별합니다.', ids: ['trend', 'level'] },
  { title: '이동평균과 조건 구별', intro: '선 위에 있다는 위치, 선이 향하는 기울기, 두 선이 만나는 교차는 각각 다른 사실입니다.', ids: ['ma-position', 'ma-slope', 'ma-settings', 'cross-status'] },
  { title: '거래량과 변동 폭', intro: '거래량은 얼마나 거래됐는지, 변동 폭은 얼마나 크게 움직였는지 보여줍니다. 어느 쪽으로 갈지는 별도 질문입니다.', ids: ['volume', 'volume-rule', 'atr', 'bands'] },
  { title: 'RSI와 MACD', intro: '모멘텀은 최근 가격 변화의 힘을 수치로 보는 방법입니다. 수치의 상태를 읽은 뒤, 알 수 없는 것도 구분합니다.', ids: ['rsi', 'macd'] },
  { title: '선과 가격대', intro: '추세선과 지지·저항 후보를 근거가 되는 고점·저점으로 확인합니다. 두 점은 후보이고, 종가로 넘은 것과 장중에 넘은 것은 다릅니다. 이중 천장·바닥도 사이 골로 그은 넥라인을 종가로 넘기 전에는 후보입니다.', ids: ['trendline', 'sr-level', 'retest', 'double'] },
  { title: '시간 단위와 맥락', intro: '같은 차트도 주봉과 일봉이 다르게 보이고, 같은 모양도 앞선 흐름에 따라 이름이 다릅니다. 거래량과 지표가 가격과 같은 말을 하는지도 봅니다.', ids: ['mtf', 'breakout-volume', 'divergence', 'candle-context', 'engulf'] },
  { title: '종합 읽기', intro: '여러 근거가 엇갈리는 차트를 한쪽 이야기로만 설명하지 않습니다. 관찰, 해석, 무효 조건을 나눠 씁니다.', ids: ['integrated', 'limits'] },
];
export const TASKS = {
  candle: ['봉의 색과 전일 등락', 'chart-basics'], wick: ['꼬리와 장중 경로', 'chart-basics'], timeframe: ['일봉을 주봉으로 묶기', 'chart-basics'],
  trend: ['확인된 고점·저점 비교', 'structure-basics'], level: ['저항 후보와 종가 돌파', 'structure-basics'],
  'ma-position': ['가격과 평균의 위치', 'moving-average'], 'ma-slope': ['평균선의 기울기', 'moving-average'], 'ma-settings': ['기간을 바꾸면 달라지는 관찰', 'indicator-settings'], 'cross-status': ['교차: 충족·불충족·확인 대기', 'cross'],
  volume: ['거래량의 비교 기준', 'volume'], 'volume-rule': ['거래량 급증: 경계 사례', 'volume'], atr: ['ATR로 변동 폭 읽기', 'atr'], bands: ['밴드 안팎의 위치', 'bollinger-bands'],
  trendline: ['추세선: 두 점과 세 번째 반응', 'trendline'], 'sr-level': ['가격대의 반응 횟수와 위치', 'support-resistance'], retest: ['돌파 뒤 되돌림과 실패', 'support-resistance'], double: ['이중 천장·바닥: 조건과 넥라인 이탈', 'double-patterns'],
  mtf: ['주봉과 일봉 함께 읽기', 'timeframes'], 'breakout-volume': ['돌파한 날의 거래량과 마감 위치', 'price-volume'],
  divergence: ['RSI 다이버전스의 조건', 'divergence'], 'candle-context': ['같은 모양, 다른 자리', 'candlestick-reversal'],
  rsi: ['RSI 상태와 예측 구분', 'rsi'], macd: ['MACD선과 막대 구분', 'macd'], engulf: ['몸통 모양과 선행 추세', 'candlestick-engulfing'], integrated: ['엇갈리는 근거 함께 읽기', 'analysis-process'], limits: ['관찰·해석·무효 조건', 'analysis-process'],
};
export function courseContext(candles) {
  const c = closes(candles), m20 = sma(c, 20), m60 = sma(c, 60);
  let previous = -999;
  const volume = candles.map((_, i) => {
    if (i < 21) return null;
    const state = volumeCondition(candles, i, previous);
    if (state.candidate) previous = i;
    return state;
  });
  return { candles, c, m5: sma(c, 5), m20, m60, bb: bollinger(c), rsi: rsi(c), macd: macd(c), atr: atr(candles), tr: trueRange(candles), volume };
}

/** 생성·실행 모두 마감일 이후를 참조하지 않는다. 학습 대상의 당시 상태만 분류한다. */
export function makeCourseQuestion(ctx, i, type) {
  if (!TASKS[type] || i < 120 || !ctx.candles[i]) return null;
  const today = ctx.candles[i];
  const q = { type, title: TASKS[type][0], lesson: TASKS[type][1], cutoff: today.date, options: [], answer: 0,
    overlays: {}, panels: [], facts: [], markers: [], lines: [], bucket: '', viewBars: 80 };
  const price = (label, value) => [label, n(value), 'price'];
  const num = (label, value, unit = '') => [label, n(value) + unit];
  const choose = (options, answer, bucket = String(answer)) => Object.assign(q, { options, answer, bucket });
  // 학생이 읽어야 할 관찰. truth 는 정답을 정한 바로 그 비교에서 나온다.
  // text 는 실제 수치, look 은 차트에서 볼 자리. 선택지가 주장하는 값은 q.claims 에 둔다.
  const read = (id, label, truth, values, text, look) => {
    (q.reads ||= []).push({ id, label, truth, values, text, look });
    return truth;
  };
  // q.margin: 정답을 가른 비교가 판정 문턱에서 얼마나 떨어져 있는지. 값이 작을수록 경계 사례다.
  // 단위는 주제마다 다르다(가격 대비 %, 거래량 배수, RSI 점수, ATR %p). 정답과 분류에는 쓰지 않는다.
  if (!TOPIC_BUILDERS[type](ctx, i, q, { n, price, num, choose, read })) return null;
  if (!q.options.length || q.options.some((x) => !x)) return null;
  return q;
}

/** 로드할 때 원자료·버전·상태를 다시 확인하며, 차트와 지표 이력을 같은 날에 자른다. */
export function openCourseCase(stock, ref) {
  if (stock.ticker !== ref.ticker || !inspectStock(stock).eligible) throw new Error('학습용 원자료 검사 실패');
  const i = stock.candles.findIndex((c) => c.date === ref.date);
  if (i < 120) throw new Error('학습 구간 누락');
  const history = stock.candles.slice(0, i + 1), question = makeCourseQuestion(courseContext(history), i, ref.type);
  if (!question || question.bucket !== ref.bucket) throw new Error('교재와 원자료가 다릅니다. 입문 교재를 다시 생성하세요.');
  return { question, history, view: history.slice(-question.viewBars) };
}

/**
 * 최초 제출 기록. 한 번 만든 기록은 다시 제출해도 바뀌지 않는다.
 * auto 는 제출 시점의 자동 확인 결과다. 나중에 정의가 바뀌어도 이 기록을 다시 채점하지 않는다.
 * self(자기 점검)는 해설을 본 뒤 따로 붙으며, 여기서는 비워둔다.
 * 8자 검사는 제출 여부 확인일 뿐 글의 질 판정이 아니다.
 */
export function courseRecord(previous, choice, question, reflection, now = Date.now(), extra = {}) {
  if (previous?.submittedAt) return previous;
  if (!Number.isInteger(choice) || !question.options[choice]) throw new Error('답을 선택하세요.');
  let numeric = null;
  if (question.numeric) {
    numeric = checkNumeric(question.numeric, extra.numeric);
    if (!numeric) throw new Error(`‘${question.numeric.label}’ 값을 숫자로 적으세요. 예: 1.85`);
  }
  if (question.reflection && String(reflection).trim().length < 8) throw new Error('종합 문제는 관찰 근거를 8자 이상 기록한 뒤 확인하세요.');
  const d = diagnose(question, choice);
  const auto = d.kind === 'reads'
    ? { wrong: d.wrong.map((r) => r.id), numeric }
    : { claimed: d.claimed, truth: d.truth, numeric };
  // choiceText: 고른 문장을 함께 남긴다. 나중에 교재가 바뀌어 문제를 다시 열 수 없어도 무엇을 골랐는지 보인다.
  return { v: 2, submittedAt: now, choice, choiceText: question.options[choice], correct: d.correct,
    confidence: CONFIDENCE[extra.confidence] ? extra.confidence : null,
    reflection: String(reflection || '').trim().slice(0, 1500), auto, self: null };
}
