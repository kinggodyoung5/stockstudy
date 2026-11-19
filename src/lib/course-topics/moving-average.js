/**
 * 3단계 이동평균과 조건 구별: 위치, 기울기, 기간 설정, 교차 조건.
 * chart-course.js 의 makeCourseQuestion() 에서 옮겼다. 계산과 문구는 그대로다. i 뒤의 봉을 읽지 않는다.
 */
import { crossAt } from '../indicators.js';
import { CROSS_HOLD, crossCondition } from '../signal-conditions.js';
import { PATTERNS } from '../patterns.js';
import { n, sign } from './format.js';

/** ma-position: 종가와 20·60일 평균의 위치 */
export function buildMaPosition(ctx, i, q, tools) {
  const { candles: cs, c, m5, m20, m60 } = ctx, today = cs[i], prev = cs[i - 1];
  const { price, num, choose, read } = tools;
  q.overlays = { ma5: q.type === 'ma-settings', ma20: true, ma60: true };
  q.facts = [price('종가', today.close), price('20일 평균', m20[i]), price('60일 평균', m60[i])];
  const SIDE = { above: '위', below: '아래' };
  const a = c[i] - m20[i], b = c[i] - m60[i];
  if (!a || !b) return null;
  choose(['종가는 두 평균선 모두 위', '종가는 20일선 위, 60일선 아래', '종가는 20일선 아래, 60일선 위', '종가는 두 평균선 모두 아래'], a > 0 ? (b > 0 ? 0 : 1) : (b > 0 ? 2 : 3));
  read('vs20', '종가와 20일 평균', a > 0 ? 'above' : 'below', SIDE, `종가 ${n(c[i])} · 20일 평균 ${n(m20[i])}`, '마지막 봉과 초록선');
  read('vs60', '종가와 60일 평균', b > 0 ? 'above' : 'below', SIDE, `종가 ${n(c[i])} · 60일 평균 ${n(m60[i])}`, '마지막 봉과 보라선');
  q.claims = [{ vs20: 'above', vs60: 'above' }, { vs20: 'above', vs60: 'below' }, { vs20: 'below', vs60: 'above' }, { vs20: 'below', vs60: 'below' }];
  q.prompt = '마지막 종가의 위치를 정확히 읽으면?';
  q.margin = Math.min(Math.abs(a) / m20[i], Math.abs(b) / m60[i]) * 100;
  q.hint = '초록선은 20일 평균, 보라선은 60일 평균입니다. 위치만 묻습니다. 선의 기울기와 혼동하지 마세요.';
  q.explanation = `종가 ${n(c[i])}는 20일 평균 ${n(m20[i])}의 ${sign(a)}, 60일 평균 ${n(m60[i])}의 ${sign(b)}입니다. 위에 있다는 사실만으로 선이 오르고 있거나 앞으로 오른다고 말할 수는 없습니다.`;
  return q;
}

/** ma-slope: 20일선의 5거래일 변화와 종가 위치 */
export function buildMaSlope(ctx, i, q, tools) {
  const { candles: cs, c, m5, m20, m60 } = ctx, today = cs[i], prev = cs[i - 1];
  const { price, num, choose, read } = tools;
  q.overlays = { ma5: q.type === 'ma-settings', ma20: true, ma60: true };
  q.facts = [price('종가', today.close), price('20일 평균', m20[i]), price('60일 평균', m60[i])];
  const SIDE = { above: '위', below: '아래' };
  const slope = m20[i] - m20[i - 5], location = c[i] - m20[i];
  if (!slope || !location) return null;
  choose(['20일선은 5거래일 전보다 높고 종가는 선 위', '20일선은 높아졌지만 종가는 선 아래', '20일선은 낮아졌지만 종가는 선 위', '20일선은 낮아졌고 종가는 선 아래'], slope > 0 ? (location > 0 ? 0 : 1) : (location > 0 ? 2 : 3));
  read('slope', '20일선의 5거래일 변화', slope > 0 ? 'up' : 'down', { up: '높아졌다', down: '낮아졌다' },
    `${n(m20[i - 5])} → ${n(m20[i])}`, '초록선의 오른쪽 끝과 다섯 봉 앞 지점');
  read('loc', '종가와 20일선', location > 0 ? 'above' : 'below', SIDE, `종가 ${n(c[i])} · 20일 평균 ${n(m20[i])}`, '마지막 봉과 초록선');
  q.claims = [{ slope: 'up', loc: 'above' }, { slope: 'up', loc: 'below' }, { slope: 'down', loc: 'above' }, { slope: 'down', loc: 'below' }];
  q.prompt = '20일선의 변화와 종가의 위치를 함께 설명하면?';
  q.margin = Math.min(Math.abs(slope) / m20[i - 5], Math.abs(location) / m20[i]) * 100;
  q.hint = '기울기는 같은 선의 과거 값과 비교합니다. 위치는 오늘 가격과 오늘 선을 비교합니다.';
  q.facts.push(price('5거래일 전 20일 평균', m20[i - 5]));
  q.explanation = `20일 평균은 ${n(m20[i - 5])} → ${n(m20[i])}로 변했습니다. 종가 ${n(c[i])}의 선 위·아래 위치와 별도로 읽어야 합니다.`;
  return q;
}

/** ma-settings: 5/20일과 20/60일 조합 */
export function buildMaSettings(ctx, i, q, tools) {
  const { candles: cs, c, m5, m20, m60 } = ctx, today = cs[i], prev = cs[i - 1];
  const { price, num, choose, read } = tools;
  q.overlays = { ma5: q.type === 'ma-settings', ma20: true, ma60: true };
  q.facts = [price('종가', today.close), price('20일 평균', m20[i]), price('60일 평균', m60[i])];
  const SIDE = { above: '위', below: '아래' };
  const short = m5[i] > m20[i], long = m20[i] > m60[i];
  if (m5[i] === m20[i] || m20[i] === m60[i]) return null;
  choose(['5일 > 20일, 20일 > 60일', '5일 > 20일, 20일 < 60일', '5일 < 20일, 20일 > 60일', '5일 < 20일, 20일 < 60일'], short ? (long ? 0 : 1) : (long ? 2 : 3));
  const GT = { gt: '짧은 쪽이 위', lt: '짧은 쪽이 아래' };
  read('short', '5일 평균과 20일 평균', short ? 'gt' : 'lt', GT, `5일 ${n(m5[i])} · 20일 ${n(m20[i])}`, '노란선과 초록선의 오른쪽 끝');
  read('long', '20일 평균과 60일 평균', long ? 'gt' : 'lt', GT, `20일 ${n(m20[i])} · 60일 ${n(m60[i])}`, '초록선과 보라선의 오른쪽 끝');
  q.claims = [{ short: 'gt', long: 'gt' }, { short: 'gt', long: 'lt' }, { short: 'lt', long: 'gt' }, { short: 'lt', long: 'lt' }];
  q.prompt = '5/20일 조합과 20/60일 조합의 위치 관계를 읽으면?';
  q.margin = Math.min(Math.abs(m5[i] - m20[i]) / m20[i], Math.abs(m20[i] - m60[i]) / m60[i]) * 100;
  q.hint = '노란선은 5일 평균입니다. 같은 차트라도 평균 내는 기간이 다르면 서로 다른 움직임을 요약합니다.';
  q.facts.unshift(price('5일 평균', m5[i]));
  q.explanation = `5일 ${n(m5[i])}, 20일 ${n(m20[i])}, 60일 ${n(m60[i])}입니다. 짧은 조합과 긴 조합의 관계가 다를 수 있습니다. 이것은 어느 설정이 더 수익성 있다는 비교가 아니며, 오늘 위치만으로 오늘 교차했다고 판단할 수도 없습니다.`;
  return q;
}

/** cross-status: 교차 후보의 충족·불충족·확인 대기 */
export function buildCrossStatus(ctx, i, q, tools) {
  const { candles: cs, c, m5, m20, m60 } = ctx, today = cs[i], prev = cs[i - 1];
  const { price, num, choose, read } = tools;
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
  q.conditions = [
    { id: 'cross', label: `20일선이 60일선을 ${direction > 0 ? '아래→위' : '위→아래'}로 교차`, status: state.cross ? 'pass' : 'fail',
      text: `${cs[start].date} · 20일선 ${n(m20[start])}, 60일선 ${n(m60[start])}`, look: '차트의 ‘교차 후보’ 표시' },
    { id: 'clean', label: '교차 직전 20거래일 안에 반대 교차가 없다', status: state.clean ? 'pass' : 'fail',
      text: state.clean ? '반대 교차 없음' : '반대 교차 있음', look: '교차 후보 왼쪽 20봉 구간의 두 선' },
    { id: 'held', label: `교차 후 ${CROSS_HOLD}거래일 동안 방향 유지`, status: !state.held ? 'fail' : state.elapsed < CROSS_HOLD ? 'pending' : 'pass',
      text: `교차 후 ${state.elapsed}거래일 지남 · 지금까지 ${state.held ? '유지' : '깨짐'}`, look: '교차 후보 오른쪽에서 두 선의 위아래' },
  ];
  q.verdicts = ['pass', 'fail', 'pending'];
  q.explanation = `교차 후 ${state.elapsed}거래일이 지났고, 직전 반대 교차는 ${state.clean ? '없습니다' : '있습니다'}. ${state.status === 'pending' ? '5거래일 유지 여부는 아직 알 수 없습니다. 나중에 실패할 수도 있으므로 지금 완료 신호로 세면 안 됩니다.' : state.status === 'pass' ? '5거래일 유지까지 확인됐습니다. “조건 충족”이지 이후 방향 보장은 아닙니다.' : '직전 반대 교차가 있거나 유지 조건이 깨졌으므로 이 앱의 조건에는 맞지 않습니다. 교차 모양 자체가 없었다는 뜻은 아닙니다.'}`;
  return q;
}
