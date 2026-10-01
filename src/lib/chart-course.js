import { closes, sma, bollinger, pivots, resample, crossAt, pct } from './indicators.js';
import { rsi, macd, atr } from './oscillators.js';
import { crossCondition, volumeCondition } from './signal-conditions.js';
import { candleEvidence, CANDLE_PATTERNS } from './candlestick.js';
import { trendBeforePattern } from './pattern-context.js';
import { inspectStock } from './data-quality.js';
import { PATTERNS } from './patterns.js';

export const COURSE_VERSION = '2026-09-27.1';
export const COURSE_STEPS = [
  { title: '가격과 시간', intro: '봉의 색과 전일 대비 등락은 비교하는 가격이 다릅니다. 실제 숫자로 확인해봅니다.', ids: ['candle', 'wick', 'timeframe'] },
  { title: '추세와 가격대', intro: '관찰 범위를 정하고 고점·저점을 비교합니다. 선을 잠깐 넘는 것과 종가로 넘는 것도 구별합니다.', ids: ['trend', 'level'] },
  { title: '이동평균과 조건 구별', intro: '선 위에 있다는 위치, 선이 향하는 기울기, 두 선이 만나는 교차는 각각 다른 사실입니다.', ids: ['ma-position', 'ma-slope', 'ma-settings', 'cross-status'] },
  { title: '거래량과 변동 폭', intro: '거래량은 얼마나 거래됐는지, 변동 폭은 얼마나 크게 움직였는지 보여줍니다. 어느 쪽으로 갈지는 별도 질문입니다.', ids: ['volume', 'volume-rule', 'atr', 'bands'] },
  { title: 'RSI와 MACD', intro: '모멘텀은 최근 가격 변화의 힘을 수치로 보는 방법입니다. 수치의 상태를 읽은 뒤, 알 수 없는 것도 구분합니다.', ids: ['rsi', 'macd'] },
  { title: '맥락과 종합 읽기', intro: '같은 모양도 앞선 흐름에 따라 다릅니다. 여러 근거가 엇갈리는 차트를 한쪽 이야기로만 설명하지 않습니다.', ids: ['engulf', 'integrated', 'limits'] },
];
export const TASKS = {
  candle: ['봉의 색과 전일 등락', 'chart-basics'], wick: ['꼬리와 장중 경로', 'chart-basics'], timeframe: ['일봉을 주봉으로 묶기', 'chart-basics'],
  trend: ['확인된 고점·저점 비교', 'structure-basics'], level: ['저항 후보와 종가 돌파', 'structure-basics'],
  'ma-position': ['가격과 평균의 위치', 'moving-average'], 'ma-slope': ['평균선의 기울기', 'moving-average'], 'ma-settings': ['기간을 바꾸면 달라지는 관찰', 'indicator-settings'], 'cross-status': ['교차: 충족·불충족·확인 대기', 'cross'],
  volume: ['거래량의 비교 기준', 'volume'], 'volume-rule': ['거래량 급증: 경계 사례', 'volume'], atr: ['ATR로 변동 폭 읽기', 'atr'], bands: ['밴드 안팎의 위치', 'bollinger-bands'],
  rsi: ['RSI 상태와 예측 구분', 'rsi'], macd: ['MACD선과 막대 구분', 'macd'], engulf: ['몸통 모양과 선행 추세', 'candlestick-engulfing'], integrated: ['엇갈리는 근거 함께 읽기', 'analysis-process'], limits: ['관찰·해석·무효 조건', 'analysis-process'],
};
const n = (v) => Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 4 });
const sign = (v) => v > 0 ? '위' : v < 0 ? '아래' : '같은 위치';
const body = (c) => Math.abs(c.close - c.open);
export function courseContext(candles) {
  const c = closes(candles), m20 = sma(c, 20), m60 = sma(c, 60);
  let previous = -999;
  const volume = candles.map((_, i) => {
    if (i < 21) return null;
    const state = volumeCondition(candles, i, previous);
    if (state.candidate) previous = i;
    return state;
  });
  return { candles, c, m5: sma(c, 5), m20, m60, bb: bollinger(c), rsi: rsi(c), macd: macd(c), atr: atr(candles), volume };
}

/** 생성·실행 모두 마감일 이후를 참조하지 않는다. 학습 대상의 당시 상태만 분류한다. */
export function makeCourseQuestion(ctx, i, type) {
  if (!TASKS[type] || i < 120 || !ctx.candles[i]) return null;
  const { candles: cs, c, m5, m20, m60 } = ctx, today = cs[i], prev = cs[i - 1];
  const q = { type, title: TASKS[type][0], lesson: TASKS[type][1], cutoff: today.date, options: [], answer: 0,
    overlays: {}, panels: [], facts: [], markers: [], lines: [], bucket: '', viewBars: 80 };
  const price = (label, value) => [label, n(value), 'price'];
  const num = (label, value, unit = '') => [label, n(value) + unit];
  const choose = (options, answer, bucket = String(answer)) => Object.assign(q, { options, answer, bucket });
  const past = () => cs.slice(0, i + 1);
  if (type === 'candle') {
    q.viewBars = 20;
    const b = today.close - today.open, d = today.close - prev.close;
    if (!b || !d) return null;
    choose(['양봉이며 전일 종가보다 올랐다', '양봉이지만 전일 종가보다 내렸다', '음봉이지만 전일 종가보다 올랐다', '음봉이며 전일 종가보다 내렸다'], b > 0 ? (d > 0 ? 0 : 1) : (d > 0 ? 2 : 3));
    q.prompt = '마지막 봉의 몸통과 전일 대비 등락을 함께 읽으면?';
    q.hint = '양봉·음봉은 오늘 시가와 종가를 비교합니다. 전일 등락은 어제 종가와 비교합니다.';
    q.facts = [price('전일 종가', prev.close), price('오늘 시가', today.open), price('오늘 종가', today.close)];
    q.explanation = `오늘 종가 ${n(today.close)}는 시가 ${n(today.open)}보다 ${b > 0 ? '높으므로 양봉' : '낮으므로 음봉'}입니다. 전일 종가 ${n(prev.close)}와 비교하면 ${n(pct(prev.close, today.close))}%입니다. 두 비교를 따로 해야 합니다.`;
  } else if (type === 'wick') {
    q.viewBars = 20;
    const upper = today.high - Math.max(today.open, today.close), lower = Math.min(today.open, today.close) - today.low;
    if (Math.abs(upper - lower) < today.close * .0001) return null;
    choose(['윗꼬리가 더 길다. 고가·저가에 도달한 순서는 알 수 없다', '아랫꼬리가 더 길다. 고가·저가에 도달한 순서는 알 수 없다', '긴 꼬리 쪽 가격에 반드시 먼저 도달했다'], upper > lower ? 0 : 1);
    q.prompt = '마지막 봉의 꼬리에서 확인할 수 있는 사실은?';
    q.hint = '윗꼬리 = 고가 − 몸통 위쪽. 아랫꼬리 = 몸통 아래쪽 − 저가.';
    q.facts = [price('시가', today.open), price('고가', today.high), price('저가', today.low), price('종가', today.close)];
    q.explanation = `윗꼬리 ${n(upper)}, 아랫꼬리 ${n(lower)}입니다. 일봉은 네 가격을 요약할 뿐, 장중 어느 가격을 먼저 거쳤는지는 남기지 않습니다.`;
  } else if (type === 'timeframe') {
    q.viewBars = 30;
    // 마지막 주는 아직 진행 중일 수 있으므로 제외하고 그 이전 주만 출제한다.
    const weeks = resample(past(), 'week'), w = weeks.at(-2), before = weeks.at(-3);
    if (!w || !before) return null;
    const days = cs.slice(0, i + 1).filter((c) => c.date > before.date && c.date <= w.date);
    const dailySign = Math.sign(days.at(-1).close - days.at(-1).open), weekSign = Math.sign(w.close - w.open);
    if (!dailySign || !weekSign) return null;
    choose(['마지막 일봉과 주봉 모두 양봉', '마지막 일봉은 양봉, 주봉은 음봉', '마지막 일봉은 음봉, 주봉은 양봉', '마지막 일봉과 주봉 모두 음봉'], dailySign > 0 ? (weekSign > 0 ? 0 : 1) : (weekSign > 0 ? 2 : 3));
    q.prompt = `${days[0].date}~${w.date}에 해당하는 일봉과 주봉을 비교하면?`;
    q.hint = '주봉 시가는 그 주 첫 거래일의 시가, 주봉 종가는 마지막 거래일의 종가입니다. 봉 하나의 길이가 다릅니다.';
    q.facts = [price('그 주 첫 시가', w.open), price('마지막 날 시가', days.at(-1).open), price('마지막 날 종가', w.close), ['해당 주 거래일 수', String(days.length) + '일']];
    q.weekly = weeks.slice(0, -1).slice(-20); q.focusDate = w.date;
    q.explanation = `주봉은 시가 ${n(w.open)}, 종가 ${n(w.close)}이고 마지막 일봉은 시가 ${n(days.at(-1).open)}, 종가 ${n(w.close)}입니다. 마지막 일봉 하나만 보고 한 주 전체가 같은 방향이었다고 말할 수 없습니다. 진행 중일 수 있는 마지막 주는 비교에서 제외했습니다.`;
  } else if (type === 'trend') {
    const start = i - 79, view = cs.slice(start, i + 1), p = pivots(view, 3);
    if (p.highs.length < 2 || p.lows.length < 2) return null;
    const hs = p.highs.slice(-2).map((j) => cs[start + j]), ls = p.lows.slice(-2).map((j) => cs[start + j]);
    const h = hs[1].high - hs[0].high, l = ls[1].low - ls[0].low;
    choose(['표시된 고점·저점 모두 높아졌다', '표시된 고점·저점 모두 낮아졌다', '두 비교가 엇갈리거나 같은 값이 있다'], h > 0 && l > 0 ? 0 : h < 0 && l < 0 ? 1 : 2);
    q.prompt = '최근 80봉에서 표시한 마지막 고점 둘과 저점 둘의 구조는?';
    q.hint = '이 연습은 좌우 각 3봉보다 높은 고점·낮은 저점을 씁니다. 오른쪽 3봉이 이미 끝난 지점만 표시합니다.';
    q.facts = [...hs.map((c, j) => price(`고점 ${j + 1} (${c.date})`, c.high)), ...ls.map((c, j) => price(`저점 ${j + 1} (${c.date})`, c.low))];
    q.markers = [...hs.map((c, j) => ({ date: c.date, text: `고${j + 1}`, position: 'aboveBar' })), ...ls.map((c, j) => ({ date: c.date, text: `저${j + 1}`, position: 'belowBar' }))];
    q.explanation = `고점은 ${n(hs[0].high)} → ${n(hs[1].high)}, 저점은 ${n(ls[0].low)} → ${n(ls[1].low)}입니다. 이 구간의 구조를 설명한 것이지 장기 추세나 다음 방향을 확정한 것은 아닙니다. 다른 관찰 범위에서는 다르게 보일 수 있습니다.`;
  } else if (type === 'level') {
    const level = Math.max(...cs.slice(i - 20, i).map((c) => c.high));
    const state = today.close > level ? 0 : today.high > level ? 1 : 2;
    choose(['종가가 후보선 위에서 끝났다', '장중에는 넘었지만 종가는 선 위가 아니다', '장중 고가도 후보선을 넘지 않았다'], state);
    q.prompt = '직전 20봉의 최고가를 저항 후보로 정했습니다. 마지막 봉은?';
    q.hint = '“돌파”를 종가가 선보다 높은 경우로 정합니다. 고가만 넘은 경우와 구분하세요.';
    q.facts = [price('후보선 (오늘 제외)', level), price('오늘 고가', today.high), price('오늘 종가', today.close)];
    q.lines = [{ name: '직전 20봉 최고가', value: level, from: cs[i - 20].date }];
    q.explanation = `후보선 ${n(level)}와 고가 ${n(today.high)}, 종가 ${n(today.close)}를 각각 비교합니다. 과거 최고가는 관찰 후보일 뿐 반드시 막히는 벽이 아닙니다. 종가로 넘었어도 이후 유지·되돌림 여부는 아직 별도 확인이 필요합니다.`;
  } else if (type.startsWith('ma-')) {
    q.overlays = { ma5: type === 'ma-settings', ma20: true, ma60: true };
    q.facts = [price('종가', today.close), price('20일 평균', m20[i]), price('60일 평균', m60[i])];
    if (type === 'ma-position') {
      const a = c[i] - m20[i], b = c[i] - m60[i];
      if (!a || !b) return null;
      choose(['종가는 두 평균선 모두 위', '종가는 20일선 위, 60일선 아래', '종가는 20일선 아래, 60일선 위', '종가는 두 평균선 모두 아래'], a > 0 ? (b > 0 ? 0 : 1) : (b > 0 ? 2 : 3));
      q.prompt = '마지막 종가의 위치를 정확히 읽으면?';
      q.hint = '초록선은 20일 평균, 보라선은 60일 평균입니다. 위치만 묻습니다. 선의 기울기와 혼동하지 마세요.';
      q.explanation = `종가 ${n(c[i])}는 20일 평균 ${n(m20[i])}의 ${sign(a)}, 60일 평균 ${n(m60[i])}의 ${sign(b)}입니다. 위에 있다는 사실만으로 선이 오르고 있거나 앞으로 오른다고 말할 수는 없습니다.`;
    } else if (type === 'ma-slope') {
      const slope = m20[i] - m20[i - 5], location = c[i] - m20[i];
      if (!slope || !location) return null;
      choose(['20일선은 5거래일 전보다 높고 종가는 선 위', '20일선은 높아졌지만 종가는 선 아래', '20일선은 낮아졌지만 종가는 선 위', '20일선은 낮아졌고 종가는 선 아래'], slope > 0 ? (location > 0 ? 0 : 1) : (location > 0 ? 2 : 3));
      q.prompt = '20일선의 변화와 종가의 위치를 함께 설명하면?';
      q.hint = '기울기는 같은 선의 과거 값과 비교합니다. 위치는 오늘 가격과 오늘 선을 비교합니다.';
      q.facts.push(price('5거래일 전 20일 평균', m20[i - 5]));
      q.explanation = `20일 평균은 ${n(m20[i - 5])} → ${n(m20[i])}로 변했습니다. 종가 ${n(c[i])}의 선 위·아래 위치와 별도로 읽어야 합니다.`;
    } else {
      const short = m5[i] > m20[i], long = m20[i] > m60[i];
      if (m5[i] === m20[i] || m20[i] === m60[i]) return null;
      choose(['5일 > 20일, 20일 > 60일', '5일 > 20일, 20일 < 60일', '5일 < 20일, 20일 > 60일', '5일 < 20일, 20일 < 60일'], short ? (long ? 0 : 1) : (long ? 2 : 3));
      q.prompt = '5/20일 조합과 20/60일 조합의 위치 관계를 읽으면?';
      q.hint = '노란선은 5일 평균입니다. 같은 차트라도 평균 내는 기간이 다르면 서로 다른 움직임을 요약합니다.';
      q.facts.unshift(price('5일 평균', m5[i]));
      q.explanation = `5일 ${n(m5[i])}, 20일 ${n(m20[i])}, 60일 ${n(m60[i])}입니다. 짧은 조합과 긴 조합의 관계가 다를 수 있습니다. 이것은 어느 설정이 더 수익성 있다는 비교가 아니며, 오늘 위치만으로 오늘 교차했다고 판단할 수도 없습니다.`;
    }
  } else if (type === 'cross-status') {
    let start = -1, direction = 0;
    for (let j = i; j >= i - 5; j--) if (crossAt(m20, m60, j)) { start = j; direction = crossAt(m20, m60, j); break; }
    if (start < 0) return null;
    const state = crossCondition(m20, m60, start, i, direction), id = direction === 1 ? 'golden-cross' : 'dead-cross';
    choose(['모든 조건 충족', '조건 불충족', '아직 확인 대기'], state.status === 'pass' ? 0 : state.status === 'fail' ? 1 : 2, `${direction}:${state.status}`);
    q.prompt = `${cs[start].date}의 ${direction > 0 ? '상향' : '하향'} 교차 후보는 아래 조건을 모두 충족했나요?`;
    q.hint = '교차 자체와 앱의 추가 확인 조건을 나눠봅니다. 이미 깨진 조건은 불충족, 아직 날짜가 안 지난 조건은 확인 대기입니다.';
    q.rules = PATTERNS[id].rules;
    q.overlays = { ma20: true, ma60: true };
    q.facts = [price('교차일 20일선', m20[start]), price('교차일 60일선', m60[start]), ['교차 후 지난 거래일', String(state.elapsed)], ['교차 직전 20거래일 반대 교차', state.clean ? '없음' : '있음'], ['지금까지 교차 방향 유지', state.held ? '유지' : '깨짐']];
    q.markers = [{ date: cs[start].date, text: '교차 후보' }];
    q.explanation = `교차 후 ${state.elapsed}거래일이 지났고, 직전 반대 교차는 ${state.clean ? '없습니다' : '있습니다'}. ${state.status === 'pending' ? '5거래일 유지 여부는 아직 알 수 없습니다. 나중에 실패할 수도 있으므로 지금 완료 신호로 세면 안 됩니다.' : state.status === 'pass' ? '5거래일 유지까지 확인됐습니다. “조건 충족”이지 이후 방향 보장은 아닙니다.' : '직전 반대 교차가 있거나 유지 조건이 깨졌으므로 이 앱의 조건에는 맞지 않습니다. 교차 모양 자체가 없었다는 뜻은 아닙니다.'}`;
  } else if (type === 'volume' || type === 'volume-rule') {
    const v = ctx.volume[i]; if (v.ratio == null) return null;
    q.overlays = { volume: true };
    q.facts = [num('오늘 거래량', today.volume, '주'), num('직전 20봉 평균 (오늘 제외)', v.avg, '주'), num('종가의 전일 대비 등락', v.change, '%')];
    if (type === 'volume') {
      choose(['평균 미만', '평균 이상 2배 미만', '평균의 2배 이상'], v.ratio < 1 ? 0 : v.ratio < 2 ? 1 : 2);
      q.prompt = '마지막 거래량을 직전 20봉 평균과 비교하면?';
      q.hint = '오늘 거래량 ÷ 직전 20봉 평균. 거래량은 거래된 주식 수이며 매수자 수나 순매수액이 아닙니다.';
      q.explanation = `${n(today.volume)} ÷ ${n(v.avg)} = ${n(v.ratio)}배입니다. 모든 체결에는 매수와 매도가 함께 있습니다. 거래량 증가만으로 누가 샀는지, 내일 오를지 알 수 없습니다.`;
    } else {
      const bucket = v.status === 'pass' ? 'pass' : v.ratio >= 1.7 && v.ratio < 2 ? 'near' : v.ratio >= 2 && Math.abs(v.change) < 2 ? 'price-fail' : v.candidate ? 'repeat' : null;
      if (!bucket) return null;
      choose(['모든 조건 충족', '조건 불충족', '지금 자료로 판정 불가'], v.status === 'pass' ? 0 : 1, bucket);
      q.prompt = '거래량이 눈에 띄는 이 날, 아래 급증 조건을 모두 충족했나요?';
      q.hint = '2배에 가까운 것과 2배 이상은 다릅니다. 거래량뿐 아니라 가격 변화와 중복 조건도 확인합니다.';
      q.rules = PATTERNS['volume-spike'].rules;
      q.facts.push(num('평균 대비 거래량', v.ratio, '배'), ['직전 10거래일에 두 수치 조건을 만족한 날', v.spaced ? '없음' : '있음']);
      q.explanation = `거래량 ${n(v.ratio)}배, 종가 변화 ${n(v.change)}%이며 직전 반복 조건은 ${v.spaced ? '통과' : '불통과'}입니다. 세 조건을 모두 만족해야 합니다. “거의 2배”를 반올림해 통과시키지 않습니다. 이는 앱의 사례 선택 기준이지 보편적인 매수·매도 규칙이 아닙니다.`;
    }
  } else if (type === 'atr') {
    const current = ctx.atr[i] / c[i] * 100, before = ctx.atr[i - 20] / c[i - 20] * 100;
    if (Math.abs(current - before) < .001) return null;
    choose(['가격 대비 변동 폭이 커졌다. 방향은 별도로 봐야 한다', '가격 대비 변동 폭이 작아졌다. 방향은 별도로 봐야 한다', 'ATR%의 크기는 다음 날 상승률 예측값이다'], current > before ? 0 : 1);
    q.prompt = 'ATR을 종가로 나눈 비율(ATR%)을 20거래일 전과 비교하면?';
    q.hint = 'ATR(14)은 전일 종가와의 벌어짐도 포함한 하루 가격 범위를 평균낸 값입니다. 가격으로 나눈 ATR%는 가격 대비 폭입니다.';
    q.panels = ['atr'];
    q.facts = [num('20거래일 전 ATR%', before, '%'), num('현재 ATR%', current, '%'), price('현재 ATR (가격 단위)', ctx.atr[i])];
    q.explanation = `ATR%는 ${n(before)}% → ${n(current)}%입니다. 최근 흔들림의 크기를 비교한 것입니다. “앞으로 이만큼 오른다”나 손실 한도라는 뜻은 아닙니다.`;
  } else if (type === 'bands') {
    const { upper, lower } = ctx.bb;
    choose(['종가가 상단선 위', '종가가 두 밴드 사이 (경계 포함)', '종가가 하단선 아래'], c[i] > upper[i] ? 0 : c[i] < lower[i] ? 2 : 1);
    q.prompt = '볼린저밴드(20일, 표준편차 2배)에서 마지막 종가의 위치는?';
    q.hint = '이 문제는 위치만 묻습니다. 레슨의 “상단 이탈 사례”에 붙는 0.5%·중복 제외 조건과 다릅니다.';
    q.overlays = { bollinger: true }; q.facts = [price('상단선', upper[i]), price('종가', c[i]), price('하단선', lower[i])];
    q.explanation = `하단 ${n(lower[i])}, 종가 ${n(c[i])}, 상단 ${n(upper[i])}을 비교합니다. 밴드 밖에 있다는 이유만으로 반드시 안으로 돌아오거나 그대로 돌파한다고 결정할 수 없습니다.`;
  } else if (type === 'rsi') {
    const value = ctx.rsi[i]; if (value == null) return null;
    choose(['70 이상인 높은 구간. 하락 확정은 아니다', '30 초과 70 미만. 상승·하락 확정은 아니다', '30 이하인 낮은 구간. 반등 확정은 아니다'], value >= 70 ? 0 : value <= 30 ? 2 : 1);
    q.prompt = 'RSI(14)의 현재 상태를 범위 안에서 설명하면?';
    q.hint = '이 연습은 70 이상을 높은 구간, 30 이하를 낮은 구간으로 부릅니다. 상태와 경계선을 처음 넘는 사건은 다릅니다.';
    q.panels = ['rsi']; q.facts = [num('현재 RSI', value)];
    q.explanation = `RSI는 ${n(value)}입니다. 최근 종가 상승폭과 하락폭의 상대 크기를 요약한 수치입니다. 과매수·과매도라는 이름은 즉시 팔기·사기의 정답이 아닙니다. 강한 추세에서는 높은/낮은 구간에 머무를 수 있습니다.`;
  } else if (type === 'macd') {
    const line = ctx.macd.line[i], signal = ctx.macd.signal[i], hist = ctx.macd.hist[i];
    if (line == null || !hist || !line) return null;
    choose(['MACD선은 0 위, 시그널선 위', 'MACD선은 0 위, 시그널선 아래', 'MACD선은 0 아래, 시그널선 위', 'MACD선은 0 아래, 시그널선 아래'], line > 0 ? (hist > 0 ? 0 : 1) : (hist > 0 ? 2 : 3));
    q.prompt = 'MACD선의 0선 위치와 시그널선과의 관계를 구분하면?';
    q.hint = '초록 MACD선 = 12일 지수평균 − 26일 지수평균. 빨간 시그널선 = MACD선의 9일 지수평균. 막대 = MACD선 − 시그널선.';
    q.panels = ['macd']; q.facts = [price('MACD선', line), price('시그널선', signal), price('히스토그램 (막대)', hist)];
    q.explanation = `MACD선 ${n(line)}, 시그널선 ${n(signal)}, 둘의 차이 ${n(hist)}입니다. 막대가 0 위라는 말은 MACD선이 시그널선 위라는 뜻이지 MACD선 자체가 0 위라는 뜻은 아닙니다. 교차 여부는 전일 관계까지 봐야 합니다.`;
  } else if (type === 'engulf') {
    q.viewBars = 40;
    if (!(prev.close < prev.open && today.close > today.open && today.close > prev.open && today.open < prev.close)) return null;
    const average = cs.slice(i - 21, i - 1).reduce((s, c) => s + body(c), 0) / 20;
    const trend = trendBeforePattern(cs, i - 1), evidence = candleEvidence('bullish-engulfing', cs, i);
    const size = body(today) >= average && body(prev) >= average * .3;
    const bucket = evidence ? 'pass' : size && trend > -3 ? 'trend-fail' : 'size-fail';
    choose(['모양·크기·앞선 흐름 조건 모두 충족', '모양은 감싸지만 추가 조건은 불충족', '내일 상승해야 오늘 조건 충족으로 판정 가능'], evidence ? 0 : 1, bucket);
    q.prompt = '마지막 양봉이 전일 음봉 몸통을 감쌌습니다. 아래 조건까지 맞나요?';
    q.hint = '반전 후보를 찾는 것이므로 두 봉이 나오기 전의 흐름을 따로 봅니다. 패턴 이름부터 외우지 말고 각 조건을 비교하세요.';
    q.rules = CANDLE_PATTERNS['bullish-engulfing'].rules;
    q.facts = [price('앞 음봉 몸통', body(prev)), price('뒤 양봉 몸통', body(today)), price('패턴 전 20봉 평균 몸통', average), num('패턴 첫 봉 전일까지 10거래일 등락', trend, '%')];
    q.explanation = `앞선 흐름은 ${n(trend)}% (−3% 이하 요구), 뒤 몸통은 평균의 ${n(body(today) / average)}배 (1배 이상), 앞 몸통은 ${n(body(prev) / average)}배 (0.3배 이상)입니다. 감싸는 모양만으로 반전 조건을 충족하지는 않습니다. 내일 결과를 보고 오늘 패턴을 판정하지 않습니다.`;
    q.markers = [{ date: prev.date, text: '첫 봉' }, { date: today.date, text: '둘째 봉' }];
  } else if (type === 'integrated' || type === 'limits') {
    const above = c[i] > m20[i], rising = m20[i] > m20[i - 5], positive = ctx.macd.hist[i] > 0;
    if (c[i] === m20[i] || m20[i] === m20[i - 5]) return null;
    q.overlays = { ma20: true, volume: true }; q.panels = ['macd'];
    q.facts = [price('종가', c[i]), price('20일 평균', m20[i]), price('5거래일 전 20일 평균', m20[i - 5]), price('MACD 막대', ctx.macd.hist[i])];
    const summary = `종가는 20일선 ${above ? '위' : '아래'}, 20일선은 5거래일 전보다 ${rising ? '높고' : '낮고'}, MACD선은 시그널선 ${positive ? '위' : '아래'}`;
    if (type === 'integrated') {
      choose([summary,
        `종가는 20일선 ${above ? '아래' : '위'}, 20일선은 5거래일 전보다 ${rising ? '높고' : '낮고'}, MACD선은 시그널선 ${positive ? '위' : '아래'}`,
        `종가는 20일선 ${above ? '위' : '아래'}, 20일선은 5거래일 전보다 ${rising ? '낮고' : '높고'}, MACD선은 시그널선 ${positive ? '위' : '아래'}`,
        `종가는 20일선 ${above ? '위' : '아래'}, 20일선은 5거래일 전보다 ${rising ? '높고' : '낮고'}, MACD선은 시그널선 ${positive ? '아래' : '위'}`,
      ], 0, above === rising && rising === positive ? 'aligned' : 'mixed');
      q.prompt = '세 가지 관찰을 빠뜨리지 않고 설명한 문장은?';
      q.hint = '한 지표가 다른 지표의 대답을 대신하지 않습니다. 엇갈리면 엇갈린 상태 그대로 적습니다.';
      q.explanation = summary + '입니다. 서로 다른 기간·관계를 요약한 값이므로 다수결로 다음 방향을 정하지 않습니다.';
      q.reflection = '내 해석을 약하게 만드는 관찰이 있다면 숫자와 함께 하나 쓰세요. 없으면 지금 자료로 모르는 점을 쓰세요.';
    } else {
      const level = Math.min(...cs.slice(i - 20, i).map((c) => c.low));
      q.lines = [{ name: '직전 20봉 최저가', value: level, from: cs[i - 20].date }];
      q.facts.push(price('직전 20봉 최저가', level));
      choose(['현재 확인한 사실이다', '현재 차트에 대한 해석이다', '앞으로 확인할 무효 조건이다'], 2, above ? 'above' : 'below');
      q.prompt = `“앞으로 종가가 ${n(level)} 아래로 끝나면 이 가격대가 지켜진다는 생각을 다시 검토한다”는 무엇인가요?`;
      q.hint = '관찰은 이미 본 값, 해석은 그 값에 붙인 의미, 무효 조건은 내 생각을 바꾸기로 미리 정한 관찰 기준입니다.';
      q.explanation = `미래에 점검할 기준이므로 무효 조건입니다. 오늘 종가 ${n(c[i])}가 후보 가격 ${n(level)}보다 ${sign(c[i] - level)}라는 사실과 구분하세요. 무효 조건은 손실이 제한된다는 보장이나 매매 지시가 아닙니다.`;
      q.reflection = '이 차트에서 관찰 1개 → 내 해석 → 반대 근거 또는 모르는 점 → 해석을 바꿀 조건을 짧게 써보세요.';
    }
  }
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

export function courseRecord(previous, choice, question, reflection, now = Date.now()) {
  if (previous?.submittedAt) return previous;
  if (!Number.isInteger(choice) || !question.options[choice]) throw new Error('답을 선택하세요.');
  if (question.reflection && String(reflection).trim().length < 8) throw new Error('종합 문제는 관찰 근거를 8자 이상 기록한 뒤 확인하세요.');
  return { submittedAt: now, choice, correct: choice === question.answer, reflection: String(reflection || '').trim().slice(0, 1500) };
}
