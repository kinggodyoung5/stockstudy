/**
 * 같은 모양, 다른 자리 (관찰형). 아래 꼬리가 긴 같은 모양이 하락 뒤(망치형), 상승 뒤(교수형),
 * 또는 어느 쪽도 아닌 자리에 나왔는지 묻는다. 모양과 앞선 흐름은 캔들 탐지기와 같은 함수로 판정한다.
 */
import { avgBody, hammerLike, candleEvidence } from '../candlestick.js';
import { trendBeforePattern } from '../pattern-context.js';

export const CANDLE_TREND = { down: -3, up: 3, days: 10 };

export function buildCandleContext(ctx, i, q, h) {
  const cs = ctx.candles, today = cs[i];
  if (i < 20 || !hammerLike(today, avgBody(cs, i))) return null;
  const t = trendBeforePattern(cs, i, CANDLE_TREND.days);
  if (t == null) return null;
  const state = t <= CANDLE_TREND.down ? 'down' : t >= CANDLE_TREND.up ? 'up' : 'none';
  // 탐지기의 판정과 어긋나는 날은 내지 않는다.
  if (!!candleEvidence('hammer', cs, i) !== (state === 'down') || !!candleEvidence('hanging-man', cs, i) !== (state === 'up')) return null;
  h.choose(['하락 뒤에 나왔다 (이 앱의 망치형 조건)', '상승 뒤에 나왔다 (이 앱의 교수형 조건)', '앞선 흐름이 어느 쪽 조건도 채우지 못한다 (모양만 같다)'],
    { down: 0, up: 1, none: 2 }[state], state);
  const first = cs[i - 1 - CANDLE_TREND.days], last = cs[i - 1];
  h.read('trend', '마지막 봉 전일까지 10거래일 종가 변화', state,
    { down: '−3% 이하 (하락 뒤)', up: '+3% 이상 (상승 뒤)', none: '−3%와 +3% 사이' },
    `${first.date} 종가 ${h.n(first.close)} → ${last.date} 종가 ${h.n(last.close)} = ${h.n(t)}%`, '마지막 봉 왼쪽 열 봉의 흐름');
  q.claims = [{ trend: 'down' }, { trend: 'up' }, { trend: 'none' }];
  q.viewBars = 40;
  q.markers = [{ date: cs[i - 1 - CANDLE_TREND.days].date, text: '10거래일 전', position: 'aboveBar' }, { date: today.date, text: '이 봉', position: 'belowBar' }];
  const lower = Math.min(today.open, today.close) - today.low, b = Math.abs(today.close - today.open);
  q.prompt = '마지막 봉은 아래 꼬리가 긴 같은 모양입니다. 앞선 흐름으로 보면 어느 경우인가요?';
  q.hint = '모양이 같아도 하락 뒤면 망치형, 상승 뒤면 교수형이라고 부릅니다. 이 앱은 마지막 봉 전일까지 10거래일의 종가 변화가 −3% 이하면 하락 뒤, +3% 이상이면 상승 뒤로 봅니다. 이름은 반등이나 하락을 보장하지 않습니다.';
  q.rules = ['아랫꼬리 ≥ 몸통 × 2, 윗꼬리 ≤ 몸통 × 0.5, 몸통이 전체 폭의 35% 이하 (이 봉은 이미 충족)', '앞선 흐름: 마지막 봉 전일까지 10거래일 종가 변화'];
  q.facts = [h.price('몸통', b), h.price('아랫꼬리', lower), h.price(`${first.date} 종가`, first.close), h.price(`${last.date} 종가`, last.close), h.num('10거래일 종가 변화', t, '%')];
  q.margin = Math.min(Math.abs(t - CANDLE_TREND.down), Math.abs(t - CANDLE_TREND.up));
  q.explanation = `앞선 10거래일 종가 변화는 ${h.n(t)}%입니다. ${
    state === 'down' ? '하락 뒤에 나왔으므로 이 앱의 망치형 조건에 맞습니다.'
      : state === 'up' ? '상승 뒤에 나왔으므로 이 앱의 교수형 조건에 맞습니다.'
        : '어느 쪽 조건도 채우지 못해 이름을 붙이지 않습니다. 모양만 같은 봉입니다.'} 같은 모양에 다른 이름을 붙이는 것은 나온 자리 때문이며, 이름이 이후 방향을 정하지는 않습니다.`;
  return q;
}
