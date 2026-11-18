/**
 * RSI 다이버전스 (조건형). 탐지기와 같은 divergenceCondition() 으로 두 극점의 조건을 판정한다.
 * 극점은 좌우 5봉 기준이다. 둘째 극점의 오른쪽 5봉이 아직 다 지나지 않았으면 '확인 대기'다.
 * 오늘 뒤의 봉은 보지 않는다.
 */
import { pivots, pct } from '../indicators.js';
import { divergenceCondition, DIVERGENCE_GAP, DIVERGENCE_PRICE_MOVE } from '../signal-conditions.js';
import { DIVERGENCE_LIMITS } from '../pattern-context.js';
import { uniform } from '../hash.js';

export const DIVERGENCE_W = 5;

/**
 * 오늘 시점에서 비교할 두 극점. 확인된 극점과, 왼쪽 5봉보다 낮고(높고) 오늘까지 깨지지 않은 최근 후보.
 * 후보가 있으면 (마지막 확인 극점, 후보), 없으면 마지막 확인 극점 둘을 쓴다. 둘째 극점은 최근 15봉 안이어야 한다.
 */
export function divergencePair(cs, i, bullish) {
  const start = Math.max(0, i - 130), view = cs.slice(start, i + 1);
  const p = pivots(view, DIVERGENCE_W), list = (bullish ? p.lows : p.highs).map((j) => start + j);
  const val = (k) => (bullish ? cs[k].low : cs[k].high);
  const beats = (a, b) => (bullish ? val(a) < val(b) : val(a) > val(b));
  let candidate = -1;
  for (let j = i; j > i - DIVERGENCE_W; j--) {
    let ok = true;
    for (let k = j - DIVERGENCE_W; k < j && ok; k++) if (!beats(j, k)) ok = false;
    for (let k = j + 1; k <= i && ok; k++) if (!beats(j, k)) ok = false;
    if (ok) { candidate = j; break; }
  }
  if (candidate >= 0 && list.length) return { i1: list.at(-1), i2: candidate, confirmed: false };
  if (list.length >= 2 && list.at(-1) >= i - 15) return { i1: list.at(-2), i2: list.at(-1), confirmed: true };
  return null;
}

export function buildDivergence(ctx, i, q, h) {
  const cs = ctx.candles, today = cs[i], series = ctx.rsi;
  const options = [true, false].map((bullish) => {
    const pair = divergencePair(cs, i, bullish);
    if (!pair) return null;
    const cond = divergenceCondition('rsi', cs, series, pair.i1, pair.i2, bullish);
    return cond.gapOk && cond.hasSeries ? { bullish, ...pair, cond } : null;
  }).filter(Boolean);
  if (!options.length) return null;
  const pick = options.length > 1 ? options[Math.floor(uniform(`divergence|${today.date}|${today.close}`) * 2)] : options[0];
  const { bullish, i1, i2, confirmed, cond } = pick;
  const kind = bullish ? '저점' : '고점', P = bullish ? '저가' : '고가';
  const r1 = series[i1], r2 = series[i2], diff = Math.abs(r2 - r1);
  q.conditions = [
    { id: 'price', label: `가격: 둘째 ${kind}이 첫째보다 ${DIVERGENCE_PRICE_MOVE}% 이상 ${bullish ? '낮다' : '높다'}`, status: cond.priceOk ? 'pass' : 'fail',
      text: `${P} ${h.n(cond.p1)} → ${h.n(cond.p2)} (${h.n(cond.priceMove)}%)`, look: `차트의 ‘${kind}1’, ‘${kind}2’ 표시` },
    { id: 'rsi', label: `RSI: 둘째 ${kind}의 RSI가 첫째보다 ${bullish ? '높고' : '낮고'}, 차이가 ${DIVERGENCE_LIMITS.rsi}포인트 이상`,
      status: cond.indOk && cond.magnitude.passes ? 'pass' : 'fail',
      text: `RSI ${h.n(r1)} → ${h.n(r2)} (차이 ${h.n(diff)})`, look: 'RSI 패널에서 같은 두 날짜의 값' },
    { id: 'confirm', label: `확인: 둘째 ${kind} 뒤로 ${DIVERGENCE_W}봉이 지나 극점으로 확정됐다`, status: confirmed ? 'pass' : 'pending',
      text: `둘째 ${kind} 뒤 ${i - i2}봉 지남`, look: `‘${kind}2’ 오른쪽의 봉 수` },
  ];
  const status = q.conditions.some((c) => c.status === 'fail') ? 'fail' : confirmed ? 'pass' : 'pending';
  h.choose(['모든 조건 충족', '조건 불충족', '아직 확인 대기'], { pass: 0, fail: 1, pending: 2 }[status], `${bullish ? 'bull' : 'bear'}:${status}`);
  q.verdicts = ['pass', 'fail', 'pending'];
  q.verdictText = {
    'pass>pending': `두 조건은 맞았지만 둘째 ${kind} 뒤로 ${DIVERGENCE_W}봉이 아직 지나지 않았습니다. 더 ${bullish ? '낮은' : '높은'} 가격이 나오면 비교할 점 자체가 바뀝니다.`,
    'fail>pending': `깨진 조건은 없습니다. 둘째 ${kind}이 아직 확정되지 않았을 뿐입니다.`,
    'pending>fail': '기다릴 필요가 없습니다. 가격이나 RSI 조건이 이미 맞지 않습니다.',
  };
  q.overlays = {};
  q.panels = ['rsi'];
  q.viewBars = Math.min(100, i - i1 + 15);
  q.markers = [{ date: cs[i1].date, text: `${kind}1`, position: bullish ? 'belowBar' : 'aboveBar' },
    { date: cs[i2].date, text: `${kind}2`, position: bullish ? 'belowBar' : 'aboveBar' }];
  q.rules = [`극점: 좌우 ${DIVERGENCE_W}봉보다 ${bullish ? '낮은 저가' : '높은 고가'}`, `두 극점 간격 ${DIVERGENCE_GAP[0]}~${DIVERGENCE_GAP[1]}거래일 (문제로 고를 때 이미 맞춤)`,
    `가격 변화 ${DIVERGENCE_PRICE_MOVE}% 이상, RSI 차이 ${DIVERGENCE_LIMITS.rsi}포인트 이상 (이 앱의 잡음 기준)`];
  q.prompt = `표시한 두 ${kind}에서 가격과 RSI가 서로 다른 말을 하나요? 아래 조건으로 판단하세요.`;
  q.hint = `${bullish ? '강세 다이버전스는 가격 저점이 낮아지는데 RSI 저점은 높아지는 것' : '약세 다이버전스는 가격 고점이 높아지는데 RSI 고점은 낮아지는 것'}입니다. 극점은 오른쪽 ${DIVERGENCE_W}봉이 지나야 확정되므로, 그 전에는 조건이 맞아도 확인 대기입니다.`;
  q.facts = [h.price(`${kind}1 (${cs[i1].date}) ${P}`, cond.p1), h.price(`${kind}2 (${cs[i2].date}) ${P}`, cond.p2),
    h.num(`${kind}1 RSI`, r1), h.num(`${kind}2 RSI`, r2), ['두 극점 간격', `${cond.gap}거래일`]];
  q.margin = Math.min(Math.abs(Math.abs(pct(cond.p1, cond.p2)) - DIVERGENCE_PRICE_MOVE), Math.abs(diff - DIVERGENCE_LIMITS.rsi));
  q.explanation = `가격은 ${h.n(cond.p1)} → ${h.n(cond.p2)}, RSI는 ${h.n(r1)} → ${h.n(r2)}입니다. ${
    status === 'pass' ? '가격과 RSI가 반대로 움직였고 둘째 극점도 확정됐습니다. 다이버전스는 반전을 검토할 관찰 단서일 뿐, 반전 시점이나 이후 방향을 정하지 않습니다.'
      : status === 'pending' ? `조건은 맞지만 둘째 ${kind}이 아직 확정되지 않았습니다. 이 상태를 미리 신호로 세면, 나중에 사라질 수 있는 것을 센 셈입니다.`
        : '가격과 RSI 중 적어도 하나가 조건에 맞지 않습니다. 눈으로 보면 비슷해 보여도 정한 기준으로 판단합니다.'}`;
  return q;
}
