/**
 * 이중 천장·바닥 (조건형, 로드맵 D8). 오늘까지 확인된 마지막 고점 둘(바닥은 저점 둘)과 그 사이 골로
 * 이중 천장·바닥 후보를 만들고, 탐지 규칙의 조건을 하나씩 판정한다.
 *
 * 기준값은 patterns-shape.js 의 multiTopBottom(…, 2, …) 과 같다. 탐지 코드를 고치지 않으려고 같은 값을
 * 여기 따로 적었다. "모든 조건 충족" 사례가 탐지기의 넥라인 이탈일과 같은지는 tests/double-topic.test.mjs 가 확인한다.
 * 극점은 좌우 5봉 기준이며 오른쪽 5봉이 끝난 것만 쓴다. 오늘 뒤의 봉은 보지 않는다.
 */
import { pivots } from '../indicators.js';
import { trendBeforePattern, retracementDepth } from '../pattern-context.js';
import { SHAPE_PATTERNS } from '../patterns-shape.js';
import { uniform } from '../hash.js';

export const DOUBLE = {
  pivotWidth: 5, heightPct: 5, minGap: 15, maxGap: 90, depthPct: 10, trendBars: 40, trendPct: 10, breakWithin: 30,
  // 문제로 낼 후보의 범위. 탐지 조건이 아니라 "이중 천장처럼 보이는가"를 정하는 느슨한 틀이다.
  looseHeightPct: 10, looseDepthPct: 5, view: 160,
};

/**
 * 오늘(i) 기준 이중 천장(top) 또는 바닥 후보. 넥라인 이탈이 오늘보다 앞서 이미 있었으면 null.
 * @returns { top, p1, p2, trough, v1, v2, neckline, height, depth, trend, broke, elapsed }
 */
export function doubleCase(cs, i, top) {
  const start = Math.max(0, i - DOUBLE.view + 1), view = cs.slice(start, i + 1), p = pivots(view, DOUBLE.pivotWidth);
  const peaks = (top ? p.highs : p.lows).map((j) => start + j), troughs = (top ? p.lows : p.highs).map((j) => start + j);
  if (peaks.length < 2) return null;
  const p1 = peaks.at(-2), p2 = peaks.at(-1);
  const gap = p2 - p1;
  if (gap < DOUBLE.minGap || gap > DOUBLE.maxGap) return null;
  // 마지막 고점이 확정된 날(p2 + 5봉)부터 30봉째까지만 낸다. 탐지기가 넥라인 이탈을 찾는 범위와 같다.
  if (i < p2 + DOUBLE.pivotWidth || i > p2 + DOUBLE.breakWithin) return null;
  const trough = troughs.find((x) => x > p1 && x < p2);
  if (trough == null) return null;
  const peakPrice = (k) => (top ? cs[k].high : cs[k].low);
  const v1 = peakPrice(p1), v2 = peakPrice(p2), neckline = top ? cs[trough].low : cs[trough].high;
  const hi = Math.max(v1, v2), lo = Math.min(v1, v2);
  const height = (hi - lo) / hi * 100, depth = retracementDepth([v1, v2], neckline, top);
  if (height > DOUBLE.looseHeightPct || depth < DOUBLE.looseDepthPct) return null;
  const trend = trendBeforePattern(cs, p1, DOUBLE.trendBars);
  if (trend == null) return null;
  const beyond = (k) => (top ? cs[k].close < neckline : cs[k].close > neckline);
  for (let k = p2 + DOUBLE.pivotWidth; k < i; k++) if (beyond(k)) return null;
  return { top, p1, p2, trough, v1, v2, neckline, height, depth, trend, broke: beyond(i), elapsed: i - p2 };
}

export function buildDouble(ctx, i, q, h) {
  const cs = ctx.candles, today = cs[i];
  const cases = [true, false].map((t) => doubleCase(cs, i, t)).filter(Boolean);
  if (!cases.length) return null;
  const d = cases.length > 1 ? cases[Math.floor(uniform(`double|${today.date}|${today.close}`) * 2)] : cases[0];
  const { top, p1, p2, trough, v1, v2, neckline, height, depth, trend, broke, elapsed } = d;
  const peak = top ? '고점' : '저점', name = top ? '이중 천장' : '이중 바닥', P = top ? '고' : '저';
  // 천장의 넥라인은 두 고점 사이의 저점(골), 바닥의 넥라인은 두 저점 사이의 고점이다.
  const mid = top ? '사이 골' : '사이 고점', M = top ? '골' : '사이 고점', ro = top ? '로' : '으로';
  const pc = (v) => h.n(Math.round(v * 100) / 100) + '%';
  const heightOk = height <= DOUBLE.heightPct, depthOk = depth >= DOUBLE.depthPct;
  const trendOk = top ? trend >= DOUBLE.trendPct : trend <= -DOUBLE.trendPct;
  q.conditions = [
    { id: 'height', label: `두 ${peak}의 가격 차가 ${DOUBLE.heightPct}% 이내`, status: heightOk ? 'pass' : 'fail',
      text: `${h.n(v1)} · ${h.n(v2)} → ${pc(height)} (높은 쪽 ${h.n(Math.max(v1, v2))} 기준)`, look: `‘${P}1’과 ‘${P}2’ 표시` },
    { id: 'depth', label: `${mid}(넥라인)이 ${top ? '높은 고점보다' : '낮은 저점보다'} ${DOUBLE.depthPct}% 이상 ${top ? '아래' : '위'}`, status: depthOk ? 'pass' : 'fail',
      text: `넥라인 ${h.n(neckline)} (${cs[trough].date}) → ${pc(depth)}`, look: `‘${M}’ 표시와 가로선` },
    { id: 'trend', label: `첫 ${peak} 전 ${DOUBLE.trendBars}거래일 등락이 ${top ? '+' : '−'}${DOUBLE.trendPct}% ${top ? '이상' : '이하'} (${top ? '오른 뒤' : '내린 뒤'})`,
      status: trendOk ? 'pass' : 'fail', text: pc(trend), look: `‘${P}1’ 왼쪽 40봉의 흐름` },
    { id: 'break', label: `둘째 ${peak} 뒤 ${DOUBLE.breakWithin}거래일 안에 종가가 넥라인 ${top ? '아래' : '위'}로 끝남`,
      status: broke ? 'pass' : 'pending',
      text: broke ? `오늘 종가 ${h.n(today.close)} · 넥라인 ${h.n(neckline)}` : `아직 없음 · 오늘 종가 ${h.n(today.close)}, 둘째 ${peak} 뒤 ${elapsed}거래일`,
      look: '마지막 봉 종가와 가로선' },
  ];
  const status = !heightOk || !depthOk || !trendOk ? 'fail' : broke ? 'pass' : 'pending';
  h.choose(['모든 조건 충족', '조건 불충족', '아직 확인 대기'], { pass: 0, fail: 1, pending: 2 }[status], `${top ? 'top' : 'bottom'}:${status}`);
  q.verdicts = ['pass', 'fail', 'pending'];
  q.verdictText = {
    'pass>pending': `모양의 조건은 채웠지만 종가가 아직 넥라인 ${top ? '아래' : '위'}로 끝나지 않았습니다. 넥라인 이탈 전에는 ${name} 후보입니다.`,
    'fail>pending': '깨진 조건은 없습니다. 넥라인 이탈이 아직 나오지 않았을 뿐입니다.',
    'pending>fail': '넥라인 이탈을 기다릴 필요가 없습니다. 모양의 조건 가운데 이미 맞지 않는 것이 있습니다.',
    'pass>fail': `넥라인을 ${top ? '아래로' : '위로'} 넘은 것만으로는 이 앱의 ${name} 조건을 채우지 않습니다. 가격 차, 넥라인까지의 깊이, 앞선 흐름을 따로 확인하세요.`,
  };
  q.prompt = `표시한 두 ${peak}(${P}1, ${P}2)과 ${mid}${ro} ${name} 후보를 봅니다. 오늘까지 아래 조건을 모두 충족했나요?`;
  q.hint = `${name}은 비슷한 가격의 ${peak} 둘과 그 ${mid}${ro} 그린 가로선(넥라인)으로 봅니다. 모양이 비슷해도 종가가 넥라인을 ${top ? '아래로' : '위로'} 넘기 전에는 후보입니다. ${top ? '고점은 고가, 골은 저가' : '저점은 저가, 사이 고점은 고가'}로 잽니다.`;
  q.rules = SHAPE_PATTERNS[top ? 'double-top' : 'double-bottom'].rules;
  q.viewBars = Math.min(i + 1, Math.max(80, i - p1 + 45));
  q.lines = [{ name: `넥라인 (${mid})`, value: neckline, from: cs[trough].date }];
  q.markers = [{ date: cs[p1].date, text: `${P}1`, position: top ? 'aboveBar' : 'belowBar' },
    { date: cs[trough].date, text: M, position: top ? 'belowBar' : 'aboveBar' },
    { date: cs[p2].date, text: `${P}2`, position: top ? 'aboveBar' : 'belowBar' }];
  q.facts = [h.price(`${P}1 (${cs[p1].date})`, v1), h.price(`${P}2 (${cs[p2].date})`, v2), h.price(`넥라인 (${cs[trough].date})`, neckline),
    h.price('오늘 종가', today.close), h.num('첫 ' + peak + ' 전 40거래일 등락', trend, '%')];
  q.margin = Math.min(Math.abs(height - DOUBLE.heightPct), Math.abs(depth - DOUBLE.depthPct), Math.abs(Math.abs(trend) - DOUBLE.trendPct),
    Math.abs(today.close - neckline) / neckline * 100);
  q.explanation = `두 ${peak}은 ${h.n(v1)}, ${h.n(v2)}로 ${pc(height)} 차이이고, 넥라인 ${h.n(neckline)}까지 깊이는 ${pc(depth)}, 첫 ${peak} 전 40거래일 등락은 ${pc(trend)}입니다. ${
    status === 'pass' ? `오늘 종가가 넥라인 ${top ? '아래' : '위'}로 끝나 이 앱의 ${name} 조건을 모두 채웠습니다. 조건을 채웠다는 것이지 ${top ? '하락' : '상승'}이 이어진다는 보장은 아닙니다.`
      : status === 'pending' ? `모양의 조건은 채웠지만 넥라인 이탈이 아직 없습니다. 둘째 ${peak} 뒤 30거래일 안에 이탈하지 않으면 이 앱에서는 ${name}으로 세지 않습니다.`
        : `맞지 않는 조건이 있어 이 앱의 ${name}이 아닙니다. 비슷한 모양이 보인다는 것과 정해 둔 조건을 채웠다는 것은 다른 사실입니다.`}`;
  return q;
}
