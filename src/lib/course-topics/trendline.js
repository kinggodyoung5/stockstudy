/**
 * 추세선 (조건형). 최근 80봉에서 확인된 저점 둘(또는 고점 둘)을 이은 선이 조건을 채웠는지 묻는다.
 * 극점은 좌우 3봉 기준이며 오른쪽 3봉이 끝난 것만 쓴다. 오늘 뒤의 봉은 보지 않는다.
 */
import { pivots } from '../indicators.js';
import { uniform } from '../hash.js';

export const TRENDLINE = { pivotWidth: 3, minGap: 10, touchPct: 1.5, touchAfter: 4 };

/** 두 점 (k1, v1), (k2, v2)를 지나는 직선의 k 에서의 값 */
export const lineAt = (k1, v1, k2, v2, k) => v1 + (v2 - v1) * (k - k1) / (k2 - k1);

/** 추세선 후보와 세 조건을 계산한다. 테스트도 이 함수를 직접 쓴다. */
export function trendlineCase(cs, i, dir) {
  const start = i - 79, view = cs.slice(start, i + 1), p = pivots(view, TRENDLINE.pivotWidth);
  const up = dir === 'up', list = (up ? p.lows : p.highs).map((j) => start + j);
  if (list.length < 2) return null;
  const k1 = list.at(-2), k2 = list.at(-1);
  const v1 = up ? cs[k1].low : cs[k1].high, v2 = up ? cs[k2].low : cs[k2].high;
  if (k2 - k1 < TRENDLINE.minGap || (up ? v2 <= v1 : v2 >= v1)) return null;
  const at = (k) => lineAt(k1, v1, k2, v2, k);
  const beyond = (k) => (up ? cs[k].close < at(k) : cs[k].close > at(k));   // 종가가 선 바깥(깨진 쪽)
  const between = !Array.from({ length: k2 - k1 + 1 }, (_, d) => k1 + d).some(beyond);
  let touch = -1, broke = -1;
  for (let k = k2 + 1; k <= i; k++) {
    if (broke < 0 && beyond(k)) broke = k;
    const edge = up ? cs[k].low : cs[k].high;
    if (touch < 0 && k >= k2 + TRENDLINE.touchAfter && Math.abs(edge - at(k)) / at(k) * 100 <= TRENDLINE.touchPct) touch = k;
  }
  return { up, k1, k2, v1, v2, at, between, touch, broke };
}

export function buildTrendline(ctx, i, q, h) {
  const cs = ctx.candles, today = cs[i];
  const cases = ['up', 'down'].map((d) => trendlineCase(cs, i, d)).filter(Boolean);
  if (!cases.length) return null;
  const t = cases.length > 1 ? cases[Math.floor(uniform(`trendline|${today.date}|${today.close}`) * 2)] : cases[0];
  const { up, k1, k2, v1, v2, at, between, touch, broke } = t;
  const lineNow = at(i), kind = up ? '저점' : '고점', side = up ? '위' : '아래';
  q.conditions = [
    { id: 'between', label: `두 ${kind} 사이의 종가가 모두 선 ${side}에 있다`, status: between ? 'pass' : 'fail',
      text: between ? '선을 넘어 끝난 종가 없음' : '선 반대편에서 끝난 종가 있음', look: '‘점 1’과 ‘점 2’ 사이의 봉' },
    { id: 'touch', label: `둘째 ${kind} 뒤 4봉째부터, ${up ? '저가' : '고가'}가 선의 ±1.5% 안으로 다시 들어온 날이 있다 (세 번째 반응)`,
      status: touch >= 0 ? 'pass' : 'pending',
      text: touch >= 0 ? `${cs[touch].date}에 반응` : '아직 없음', look: '‘점 2’ 오른쪽에서 선 근처까지 온 봉' },
    { id: 'held', label: `둘째 ${kind} 뒤 오늘까지 종가가 선 ${up ? '아래' : '위'}로 끝난 날이 없다`, status: broke < 0 ? 'pass' : 'fail',
      text: broke < 0 ? '없음' : `${cs[broke].date} 종가 ${h.n(cs[broke].close)} · 선 ${h.n(at(broke))}`, look: '‘점 2’ 오른쪽 봉들의 종가와 선' },
  ];
  const status = !between || broke >= 0 ? 'fail' : touch < 0 ? 'pending' : 'pass';
  h.choose(['모든 조건 충족', '조건 불충족', '아직 확인 대기'], { pass: 0, fail: 1, pending: 2 }[status], `${t.up ? 'up' : 'down'}:${status}`);
  q.verdicts = ['pass', 'fail', 'pending'];
  q.verdictText = {
    'pass>pending': '깨진 조건은 없지만 세 번째 반응이 아직 없습니다. 두 점만으로는 어떤 선이든 그을 수 있으므로 지금은 후보입니다.',
    'fail>pending': '깨진 조건은 없습니다. 세 번째 반응이 아직 나오지 않았을 뿐입니다.',
    'pending>fail': '세 번째 반응을 기다릴 필요가 없습니다. 종가가 이미 선 반대편에서 끝난 날이 있습니다.',
  };
  q.prompt = `표시한 두 ${kind}을 이은 ${up ? '상승' : '하락'} 추세선 후보는 아래 조건을 모두 충족했나요?`;
  q.hint = `${up ? '상승 추세선은 높아지는 저점 둘을 잇습니다' : '하락 추세선은 낮아지는 고점 둘을 잇습니다'}. 두 점만으로는 후보이고, 세 번째로 선 근처까지 왔다가 되돌아가야 확인으로 봅니다. 장중에 넘은 것과 종가로 넘은 것을 구분합니다.`;
  q.rules = [`극점: 좌우 3봉보다 ${up ? '낮은 저가' : '높은 고가'} (오른쪽 3봉이 끝난 것만)`, '두 점 사이 10봉 이상',
    `선 근처: 선 값의 ±1.5%`, '이 연습의 기준이며 추세선의 유일한 정의가 아닙니다'];
  q.lines = [{ name: `${up ? '상승' : '하락'} 추세선 후보`, points: [{ date: cs[k1].date, value: v1 }, { date: today.date, value: lineNow }] }];
  q.markers = [{ date: cs[k1].date, text: '점 1', position: up ? 'belowBar' : 'aboveBar' },
    { date: cs[k2].date, text: '점 2', position: up ? 'belowBar' : 'aboveBar' }];
  q.revealMarkers = [
    touch >= 0 ? { date: cs[touch].date, text: '세 번째 반응', position: up ? 'belowBar' : 'aboveBar', color: '#f2b134' } : null,
    broke >= 0 ? { date: cs[broke].date, text: '종가 이탈', position: up ? 'belowBar' : 'aboveBar', color: '#2f7fe0' } : null,
  ].filter(Boolean);
  q.facts = [h.price(`점 1 (${cs[k1].date}) ${up ? '저가' : '고가'}`, v1), h.price(`점 2 (${cs[k2].date}) ${up ? '저가' : '고가'}`, v2),
    h.price('오늘 선의 값', lineNow), h.price('오늘 종가', today.close)];
  q.margin = Math.abs(today.close - lineNow) / lineNow * 100;
  q.explanation = `점 1 ${h.n(v1)}과 점 2 ${h.n(v2)}을 이은 선은 오늘 ${h.n(lineNow)}입니다. ${
    status === 'pass' ? `${cs[touch].date}에 세 번째로 선 근처까지 왔다가 되돌아갔고, 종가가 선을 넘어 끝난 날은 없습니다. 조건을 채웠다는 것이지 앞으로도 선이 지켜진다는 뜻은 아닙니다.`
      : status === 'pending' ? '종가가 선을 넘어 끝난 날은 없지만 세 번째 반응이 아직 없습니다. 지금은 후보입니다.'
        : `종가가 선 ${up ? '아래' : '위'}에서 끝난 날이 있어 이 연습의 조건에 맞지 않습니다. 선이 깨졌다고 방향이 뒤집혔다는 뜻은 아닙니다. 고점·저점 구조를 다시 확인하세요.`}`;
  return q;
}
