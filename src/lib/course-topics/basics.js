/**
 * 1단계 가격과 시간: 봉의 색과 전일 등락, 꼬리, 일봉과 주봉.
 * chart-course.js 의 makeCourseQuestion() 에서 옮겼다. 계산과 문구는 그대로다. i 뒤의 봉을 읽지 않는다.
 */
import { resample, pct } from '../indicators.js';
import { n } from './format.js';

/** candle: 봉의 색과 전일 등락 */
export function buildCandle(ctx, i, q, tools) {
  const { candles: cs, c, m5, m20, m60 } = ctx, today = cs[i], prev = cs[i - 1];
  const { price, num, choose, read } = tools;
  q.viewBars = 20;
  const b = today.close - today.open, d = today.close - prev.close;
  if (!b || !d) return null;
  choose(['양봉이며 전일 종가보다 올랐다', '양봉이지만 전일 종가보다 내렸다', '음봉이지만 전일 종가보다 올랐다', '음봉이며 전일 종가보다 내렸다'], b > 0 ? (d > 0 ? 0 : 1) : (d > 0 ? 2 : 3));
  read('body', '봉의 색 · 오늘 시가와 종가', b > 0 ? 'up' : 'down', { up: '양봉', down: '음봉' },
    `종가 ${n(today.close)} ${b > 0 ? '>' : '<'} 시가 ${n(today.open)}`, '마지막 봉 몸통의 위·아래 끝');
  read('change', '전일 대비 · 전일 종가와 오늘 종가', d > 0 ? 'up' : 'down', { up: '전일보다 올랐다', down: '전일보다 내렸다' },
    `오늘 종가 ${n(today.close)} ${d > 0 ? '>' : '<'} 전일 종가 ${n(prev.close)}`, '마지막 봉의 종가와 바로 앞 봉의 종가');
  q.claims = [{ body: 'up', change: 'up' }, { body: 'up', change: 'down' }, { body: 'down', change: 'up' }, { body: 'down', change: 'down' }];
  q.prompt = '마지막 봉의 몸통과 전일 대비 등락을 함께 읽으면?';
  q.margin = Math.min(Math.abs(b), Math.abs(d)) / today.close * 100;
  q.hint = '양봉·음봉은 오늘 시가와 종가를 비교합니다. 전일 등락은 어제 종가와 비교합니다.';
  q.facts = [price('전일 종가', prev.close), price('오늘 시가', today.open), price('오늘 종가', today.close)];
  q.explanation = `오늘 종가 ${n(today.close)}는 시가 ${n(today.open)}보다 ${b > 0 ? '높으므로 양봉' : '낮으므로 음봉'}입니다. 전일 종가 ${n(prev.close)}와 비교하면 ${n(pct(prev.close, today.close))}%입니다. 두 비교를 따로 해야 합니다.`;
  return q;
}

/** wick: 꼬리와 종가의 위치 */
export function buildWick(ctx, i, q, tools) {
  const { candles: cs, c, m5, m20, m60 } = ctx, today = cs[i], prev = cs[i - 1];
  const { price, num, choose, read } = tools;
  q.viewBars = 20;
  const upper = today.high - Math.max(today.open, today.close), lower = Math.min(today.open, today.close) - today.low;
  if (Math.abs(upper - lower) < today.close * .0001) return null;
  const range = today.high - today.low;
  if (!range) return null;
  // 종가가 그날 고가~저가 범위의 어디서 끝났는가. 0 은 저가, 1 은 고가.
  const closePos = (today.close - today.low) / range, mid = today.low + range / 2;
  if (closePos === 0.5) return null;
  const upLonger = upper > lower, closeHigh = closePos > 0.5;
  choose(['윗꼬리가 더 길고, 종가는 그날 범위의 위쪽 절반에서 끝났다', '윗꼬리가 더 길고, 종가는 그날 범위의 아래쪽 절반에서 끝났다',
    '아랫꼬리가 더 길고, 종가는 그날 범위의 위쪽 절반에서 끝났다', '아랫꼬리가 더 길고, 종가는 그날 범위의 아래쪽 절반에서 끝났다'],
  upLonger ? (closeHigh ? 0 : 1) : (closeHigh ? 2 : 3));
  read('longer', '더 긴 꼬리', upLonger ? 'upper' : 'lower', { upper: '윗꼬리', lower: '아랫꼬리' },
    `윗꼬리 ${n(upper)} (고가 ${n(today.high)} − 몸통 위 ${n(Math.max(today.open, today.close))}), 아랫꼬리 ${n(lower)} (몸통 아래 ${n(Math.min(today.open, today.close))} − 저가 ${n(today.low)})`,
    '마지막 봉 몸통 위아래로 뻗은 가는 선');
  read('closePos', '종가의 위치 · 그날 고가와 저가의 가운데와 비교', closeHigh ? 'high' : 'low', { high: '위쪽 절반', low: '아래쪽 절반' },
    `종가 ${n(today.close)} · 가운데 ${n(mid)} (고가 ${n(today.high)}와 저가 ${n(today.low)}의 평균)`, '마지막 봉 전체 길이의 가운데와 몸통 끝');
  read('order', '장중에 가격을 거친 순서', 'unknown', { unknown: '일봉만으로는 알 수 없다', known: '알 수 있다' },
    '일봉에는 시가·고가·저가·종가 네 값만 남습니다. 어느 가격을 먼저 거쳤는지는 기록되지 않습니다.', '봉 하나에 담긴 정보의 종류');
  q.claims = [{ longer: 'upper', closePos: 'high' }, { longer: 'upper', closePos: 'low' }, { longer: 'lower', closePos: 'high' }, { longer: 'lower', closePos: 'low' }];
  q.prompt = '마지막 봉의 꼬리 길이와 종가가 끝난 위치를 함께 읽으면?';
  q.margin = Math.min(Math.abs(upper - lower), Math.abs(today.close - mid)) / today.close * 100;
  q.hint = '윗꼬리 = 고가 − 몸통 위쪽. 아랫꼬리 = 몸통 아래쪽 − 저가. 종가의 위치는 고가와 저가의 가운데보다 위인지 아래인지로 봅니다. 고가와 저가 중 무엇을 먼저 거쳤는지는 일봉으로 알 수 없습니다.';
  q.facts = [price('시가', today.open), price('고가', today.high), price('저가', today.low), price('종가', today.close)];
  q.explanation = `윗꼬리 ${n(upper)}, 아랫꼬리 ${n(lower)}이고 종가 ${n(today.close)}는 가운데 ${n(mid)}보다 ${closeHigh ? '위' : '아래'}입니다. 꼬리가 길다는 것은 그 바깥에서도 거래가 있었다는 뜻입니다. 일봉은 네 가격을 요약할 뿐, 장중 어느 가격을 먼저 거쳤는지는 남기지 않습니다.`;
  return q;
}

/** timeframe: 일봉을 주봉으로 묶기 */
export function buildTimeframe(ctx, i, q, tools) {
  const { candles: cs, c, m5, m20, m60 } = ctx, today = cs[i], prev = cs[i - 1];
  const { price, num, choose, read } = tools;
  q.viewBars = 30;
  // 마지막 주는 아직 진행 중일 수 있으므로 제외하고 그 이전 주만 출제한다.
  const weeks = resample(cs.slice(0, i + 1), 'week'), w = weeks.at(-2), before = weeks.at(-3);
  if (!w || !before) return null;
  const days = cs.slice(0, i + 1).filter((c) => c.date > before.date && c.date <= w.date);
  const dailySign = Math.sign(days.at(-1).close - days.at(-1).open), weekSign = Math.sign(w.close - w.open);
  if (!dailySign || !weekSign) return null;
  choose(['마지막 일봉과 주봉 모두 양봉', '마지막 일봉은 양봉, 주봉은 음봉', '마지막 일봉은 음봉, 주봉은 양봉', '마지막 일봉과 주봉 모두 음봉'], dailySign > 0 ? (weekSign > 0 ? 0 : 1) : (weekSign > 0 ? 2 : 3));
  const UPDOWN = { up: '양봉', down: '음봉' };
  read('daily', '마지막 일봉', dailySign > 0 ? 'up' : 'down', UPDOWN,
    `${days.at(-1).date} 시가 ${n(days.at(-1).open)} → 종가 ${n(days.at(-1).close)}`, '위 일봉 차트에서 그 주의 마지막 봉');
  read('weekly', '그 주의 주봉', weekSign > 0 ? 'up' : 'down', UPDOWN,
    `주 첫 시가 ${n(w.open)} → 주 마지막 종가 ${n(w.close)}`, '아래 주봉 차트의 ‘비교할 주’ 표시');
  q.claims = [{ daily: 'up', weekly: 'up' }, { daily: 'up', weekly: 'down' }, { daily: 'down', weekly: 'up' }, { daily: 'down', weekly: 'down' }];
  q.prompt = `${days[0].date}~${w.date}에 해당하는 일봉과 주봉을 비교하면?`;
  q.margin = Math.min(Math.abs(days.at(-1).close - days.at(-1).open), Math.abs(w.close - w.open)) / w.close * 100;
  q.hint = '주봉 시가는 그 주 첫 거래일의 시가, 주봉 종가는 마지막 거래일의 종가입니다. 봉 하나의 길이가 다릅니다.';
  q.facts = [price('그 주 첫 시가', w.open), price('마지막 날 시가', days.at(-1).open), price('마지막 날 종가', w.close), ['해당 주 거래일 수', String(days.length) + '일']];
  q.weekly = weeks.slice(0, -1).slice(-20); q.focusDate = w.date;
  q.explanation = `주봉은 시가 ${n(w.open)}, 종가 ${n(w.close)}이고 마지막 일봉은 시가 ${n(days.at(-1).open)}, 종가 ${n(w.close)}입니다. 마지막 일봉 하나만 보고 한 주 전체가 같은 방향이었다고 말할 수 없습니다. 진행 중일 수 있는 마지막 주는 비교에서 제외했습니다.`;
  return q;
}
