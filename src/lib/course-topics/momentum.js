/**
 * 5단계 RSI와 MACD: 수치의 상태 읽기.
 * chart-course.js 의 makeCourseQuestion() 에서 옮겼다. 계산과 문구는 그대로다. i 뒤의 봉을 읽지 않는다.
 */
import { n } from './format.js';

/** rsi: RSI(14)의 구간 */
export function buildRsi(ctx, i, q, tools) {
  const { candles: cs, c, m5, m20, m60 } = ctx, today = cs[i], prev = cs[i - 1];
  const { price, num, choose, read } = tools;
  const value = ctx.rsi[i]; if (value == null) return null;
  choose(['70 이상인 높은 구간. 하락 확정은 아니다', '30 초과 70 미만. 상승·하락 확정은 아니다', '30 이하인 낮은 구간. 반등 확정은 아니다'], value >= 70 ? 0 : value <= 30 ? 2 : 1);
  read('zone', 'RSI(14) 값의 구간', value >= 70 ? 'high' : value <= 30 ? 'low' : 'mid',
    { high: '70 이상', mid: '30 초과 70 미만', low: '30 이하' }, `현재 RSI ${n(value)}`, 'RSI 패널 선의 오른쪽 끝');
  q.claims = [{ zone: 'high' }, { zone: 'mid' }, { zone: 'low' }];
  q.prompt = 'RSI(14)의 현재 상태를 범위 안에서 설명하면?';
  q.margin = Math.min(Math.abs(value - 70), Math.abs(value - 30));
  q.hint = '이 연습은 70 이상을 높은 구간, 30 이하를 낮은 구간으로 부릅니다. 상태와 경계선을 처음 넘는 사건은 다릅니다.';
  q.panels = ['rsi']; q.facts = [num('현재 RSI', value)];
  q.explanation = `RSI는 ${n(value)}입니다. 최근 종가 상승폭과 하락폭의 상대 크기를 요약한 수치입니다. 과매수·과매도라는 이름은 즉시 팔기·사기의 정답이 아닙니다. 강한 추세에서는 높은/낮은 구간에 머무를 수 있습니다.`;
  return q;
}

/** macd: MACD선의 0선 위치와 시그널선 관계 */
export function buildMacd(ctx, i, q, tools) {
  const { candles: cs, c, m5, m20, m60 } = ctx, today = cs[i], prev = cs[i - 1];
  const { price, num, choose, read } = tools;
  const line = ctx.macd.line[i], signal = ctx.macd.signal[i], hist = ctx.macd.hist[i];
  if (line == null || !hist || !line) return null;
  choose(['MACD선은 0 위, 시그널선 위', 'MACD선은 0 위, 시그널선 아래', 'MACD선은 0 아래, 시그널선 위', 'MACD선은 0 아래, 시그널선 아래'], line > 0 ? (hist > 0 ? 0 : 1) : (hist > 0 ? 2 : 3));
  const SIDE = { above: '위', below: '아래' };
  read('zero', 'MACD선과 0선', line > 0 ? 'above' : 'below', SIDE, `MACD선 ${n(line)}`, 'MACD 패널의 초록선과 0 가로선');
  read('signal', 'MACD선과 시그널선', hist > 0 ? 'above' : 'below', SIDE,
    `MACD선 ${n(line)} − 시그널선 ${n(signal)} = 막대 ${n(hist)}`, '초록선과 빨간선, 막대가 0 위인지 아래인지');
  q.claims = [{ zero: 'above', signal: 'above' }, { zero: 'above', signal: 'below' }, { zero: 'below', signal: 'above' }, { zero: 'below', signal: 'below' }];
  q.prompt = 'MACD선의 0선 위치와 시그널선과의 관계를 구분하면?';
  q.margin = Math.min(Math.abs(line), Math.abs(hist)) / c[i] * 100;
  q.hint = '초록 MACD선 = 12일 지수평균 − 26일 지수평균. 빨간 시그널선 = MACD선의 9일 지수평균. 막대 = MACD선 − 시그널선.';
  q.panels = ['macd']; q.facts = [price('MACD선', line), price('시그널선', signal), price('히스토그램 (막대)', hist)];
  q.explanation = `MACD선 ${n(line)}, 시그널선 ${n(signal)}, 둘의 차이 ${n(hist)}입니다. 막대가 0 위라는 말은 MACD선이 시그널선 위라는 뜻이지 MACD선 자체가 0 위라는 뜻은 아닙니다. 교차 여부는 전일 관계까지 봐야 합니다.`;
  return q;
}
