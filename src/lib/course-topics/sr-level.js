/**
 * 가격대의 반응 횟수 (관찰형). 최근 120봉의 지지·저항 후보 가격대 하나를 보여주고,
 * 그 가격대(위아래 1.5%)에서 확인된 고점·저점이 몇 번이었는지와 오늘 종가가 어느 쪽인지 묻는다.
 * 가격대 후보는 데이터 뷰어와 같은 supportResistance() 로 찾는다.
 */
import { pivots, supportResistance } from '../indicators.js';
import { uniform } from '../hash.js';

export const SR_LEVEL = { bars: 120, pivotWidth: 5, zonePct: 1.5 };

/** 가격대 level 의 ±1.5% 안에 든 확인된 극점(봉 번호) */
export function zoneTouches(cs, start, i, level) {
  const view = cs.slice(start, i + 1), p = pivots(view, SR_LEVEL.pivotWidth);
  const near = (v) => Math.abs(v - level) / level * 100 <= SR_LEVEL.zonePct;
  return [...p.highs.filter((j) => near(view[j].high)), ...p.lows.filter((j) => near(view[j].low))]
    .map((j) => start + j).sort((a, b) => a - b);
}

export function buildSrLevel(ctx, i, q, h) {
  const cs = ctx.candles, today = cs[i], start = i - SR_LEVEL.bars + 1;
  if (start < 0) return null;
  const levels = supportResistance(cs.slice(start, i + 1), { window: SR_LEVEL.pivotWidth, tolerancePct: SR_LEVEL.zonePct, minTouches: 2, maxLevels: 99 })
    .map((l) => l.price).filter((v) => Math.abs(today.close - v) / v * 100 > SR_LEVEL.zonePct);
  if (!levels.length) return null;
  const level = levels[Math.floor(uniform(`sr-level|${today.date}|${today.close}`) * levels.length)];
  const touches = zoneTouches(cs, start, i, level);
  if (touches.length < 2) return null;
  const many = touches.length >= 3, above = today.close > level;
  h.choose(['두 번, 종가는 가격대 위 (지지 후보)', '두 번, 종가는 가격대 아래 (저항 후보)',
    '세 번 이상, 종가는 가격대 위 (지지 후보)', '세 번 이상, 종가는 가격대 아래 (저항 후보)'],
  (many ? 2 : 0) + (above ? 0 : 1));
  h.read('touches', '가격대 안의 확인된 고점·저점 수', many ? 'many' : 'two', { two: '두 번', many: '세 번 이상' },
    `${touches.length}번: ${touches.map((k) => cs[k].date).join(', ')}`, '가로선 위아래 1.5% 안에서 방향이 바뀐 봉');
  h.read('side', '오늘 종가와 가격대', above ? 'above' : 'below', { above: '가격대 위', below: '가격대 아래' },
    `종가 ${h.n(today.close)} · 가격대 ${h.n(level * (1 - SR_LEVEL.zonePct / 100))} ~ ${h.n(level * (1 + SR_LEVEL.zonePct / 100))}`, '마지막 봉 종가와 가로선');
  q.claims = [{ touches: 'two', side: 'above' }, { touches: 'two', side: 'below' }, { touches: 'many', side: 'above' }, { touches: 'many', side: 'below' }];
  q.viewBars = SR_LEVEL.bars;
  q.prompt = '표시한 가격대(가로선 위아래 1.5%)에서 확인된 고점·저점은 몇 번 나왔고, 오늘 종가는 어느 쪽에 있나요?';
  q.hint = '고점·저점은 좌우 5봉보다 높거나 낮은 봉입니다. 오른쪽 5봉이 끝난 것만 셉니다. 고점은 고가, 저점은 저가로 가격대 안에 들었는지 봅니다. 반응 횟수는 그 가격대를 주목할 이유이지, 지켜질 가능성의 크기가 아닙니다.';
  q.lines = [{ name: '가격대 가운데', value: level, from: cs[start].date }];
  q.revealMarkers = touches.map((k) => ({ date: cs[k].date, text: '반응', position: cs[k].high >= level ? 'aboveBar' : 'belowBar', color: '#f2b134' }));
  q.facts = [h.price('가격대 위 끝', level * (1 + SR_LEVEL.zonePct / 100)), h.price('가격대 가운데', level),
    h.price('가격대 아래 끝', level * (1 - SR_LEVEL.zonePct / 100)), h.price('오늘 종가', today.close)];
  q.margin = Math.abs(today.close - level) / level * 100 - SR_LEVEL.zonePct;
  q.explanation = `가격대 ${h.n(level)} 위아래 1.5% 안에서 확인된 고점·저점은 ${touches.length}번입니다(${touches.map((k) => cs[k].date).join(', ')}). 오늘 종가 ${h.n(today.close)}는 가격대 ${above ? '위에 있어 지지 후보' : '아래에 있어 저항 후보'}로 부릅니다. 여러 번 반응했다고 다음에도 지켜지는 것은 아닙니다. 어떤 극점으로 그은 선인지 날짜와 가격으로 말할 수 있어야 합니다.`;
  return q;
}
