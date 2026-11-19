/**
 * 2단계 추세와 가격대: 확인된 고점·저점 비교, 저항 후보와 종가 돌파.
 * chart-course.js 의 makeCourseQuestion() 에서 옮겼다. 계산과 문구는 그대로다. i 뒤의 봉을 읽지 않는다.
 */
import { pivots } from '../indicators.js';
import { n } from './format.js';

/** trend: 확인된 고점·저점 비교 */
export function buildTrend(ctx, i, q, tools) {
  const { candles: cs, c, m5, m20, m60 } = ctx, today = cs[i], prev = cs[i - 1];
  const { price, num, choose, read } = tools;
  const start = i - 79, view = cs.slice(start, i + 1), p = pivots(view, 3);
  if (p.highs.length < 2 || p.lows.length < 2) return null;
  const hs = p.highs.slice(-2).map((j) => cs[start + j]), ls = p.lows.slice(-2).map((j) => cs[start + j]);
  const h = hs[1].high - hs[0].high, l = ls[1].low - ls[0].low;
  choose(['표시된 고점·저점 모두 높아졌다', '표시된 고점·저점 모두 낮아졌다', '두 비교가 엇갈리거나 같은 값이 있다'], h > 0 && l > 0 ? 0 : h < 0 && l < 0 ? 1 : 2);
  const dir = (x) => x > 0 ? 'up' : x < 0 ? 'down' : 'same';
  const DIR = { up: '높아졌다', down: '낮아졌다', same: '같다' };
  read('high', '고점 1 → 고점 2', dir(h), DIR, `${n(hs[0].high)} (${hs[0].date}) → ${n(hs[1].high)} (${hs[1].date})`, '차트의 ‘고1’, ‘고2’ 표시');
  read('low', '저점 1 → 저점 2', dir(l), DIR, `${n(ls[0].low)} (${ls[0].date}) → ${n(ls[1].low)} (${ls[1].date})`, '차트의 ‘저1’, ‘저2’ 표시');
  read('structure', '두 비교를 합친 구조', h > 0 && l > 0 ? 'up' : h < 0 && l < 0 ? 'down' : 'mixed',
    { up: '모두 높아졌다', down: '모두 낮아졌다', mixed: '엇갈리거나 같은 값이 있다' },
    `고점은 ${DIR[dir(h)]}, 저점은 ${DIR[dir(l)]}`, '고점끼리, 저점끼리 따로 비교한 뒤 합친다');
  q.claims = [{ high: 'up', low: 'up' }, { high: 'down', low: 'down' }, { structure: 'mixed' }];
  q.prompt = '최근 80봉에서 표시한 마지막 고점 둘과 저점 둘의 구조는?';
  q.margin = Math.min(Math.abs(h) / hs[0].high, Math.abs(l) / ls[0].low) * 100;
  q.hint = '이 연습은 좌우 각 3봉보다 높은 고점·낮은 저점을 씁니다. 오른쪽 3봉이 이미 끝난 지점만 표시합니다.';
  q.facts = [...hs.map((c, j) => price(`고점 ${j + 1} (${c.date})`, c.high)), ...ls.map((c, j) => price(`저점 ${j + 1} (${c.date})`, c.low))];
  q.markers = [...hs.map((c, j) => ({ date: c.date, text: `고${j + 1}`, position: 'aboveBar' })), ...ls.map((c, j) => ({ date: c.date, text: `저${j + 1}`, position: 'belowBar' }))];
  q.explanation = `고점은 ${n(hs[0].high)} → ${n(hs[1].high)}, 저점은 ${n(ls[0].low)} → ${n(ls[1].low)}입니다. 이 구간의 구조를 설명한 것이지 장기 추세나 다음 방향을 확정한 것은 아닙니다. 다른 관찰 범위에서는 다르게 보일 수 있습니다.`;
  return q;
}

/** level: 직전 20봉 최고가와 종가 돌파 */
export function buildLevel(ctx, i, q, tools) {
  const { candles: cs, c, m5, m20, m60 } = ctx, today = cs[i], prev = cs[i - 1];
  const { price, num, choose, read } = tools;
  const level = Math.max(...cs.slice(i - 20, i).map((c) => c.high));
  const state = today.close > level ? 0 : today.high > level ? 1 : 2;
  choose(['종가가 후보선 위에서 끝났다', '장중에는 넘었지만 종가는 선 위가 아니다', '장중 고가도 후보선을 넘지 않았다'], state);
  const ABOVE = { above: '후보선보다 높다', below: '후보선보다 높지 않다' };
  read('close', '종가와 후보선', today.close > level ? 'above' : 'below', ABOVE,
    `종가 ${n(today.close)} · 후보선 ${n(level)}`, '마지막 봉 몸통의 끝(종가)과 가로선');
  read('high', '고가와 후보선', today.high > level ? 'above' : 'below', ABOVE,
    `고가 ${n(today.high)} · 후보선 ${n(level)}`, '마지막 봉 윗꼬리의 끝(고가)과 가로선');
  q.claims = [{ close: 'above' }, { high: 'above', close: 'below' }, { high: 'below' }];
  q.prompt = '직전 20봉의 최고가를 저항 후보로 정했습니다. 마지막 봉은?';
  q.margin = Math.min(Math.abs(today.close - level), Math.abs(today.high - level)) / level * 100;
  q.hint = '“돌파”를 종가가 선보다 높은 경우로 정합니다. 고가만 넘은 경우와 구분하세요.';
  q.facts = [price('후보선 (오늘 제외)', level), price('오늘 고가', today.high), price('오늘 종가', today.close)];
  q.lines = [{ name: '직전 20봉 최고가', value: level, from: cs[i - 20].date }];
  q.explanation = `후보선 ${n(level)}와 고가 ${n(today.high)}, 종가 ${n(today.close)}를 각각 비교합니다. 과거 최고가는 관찰 후보일 뿐 반드시 막히는 벽이 아닙니다. 종가로 넘었어도 이후 유지·되돌림 여부는 아직 별도 확인이 필요합니다.`;
  return q;
}
