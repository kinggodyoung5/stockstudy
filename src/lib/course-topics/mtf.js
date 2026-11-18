/**
 * 주봉과 일봉 (관찰형). 완료된 주봉의 20주선 기준 상태와 일봉의 20일선 기준 상태를 함께 읽는다.
 * 마지막 주는 진행 중일 수 있어 빼고, 주봉 평균은 그 앞 완료된 주봉으로만 계산한다.
 */
import { closes, sma, resample } from '../indicators.js';

export const MTF = { weekMa: 20, weekSlope: 4, dayMa: 20, daySlope: 5, minWeeks: 30, shownWeeks: 30 };

/** 위치와 기울기가 같은 쪽이면 그 방향, 엇갈리면 혼재 */
export const stateOf = (close, ma, maBefore) =>
  close > ma && ma > maBefore ? 'up' : close < ma && ma < maBefore ? 'down' : 'mixed';

export function weeklyState(history) {
  const weeks = resample(history, 'week').slice(0, -1);
  if (weeks.length < MTF.minWeeks) return null;
  const w = sma(closes(weeks), MTF.weekMa), k = weeks.length - 1;
  if (w[k] == null || w[k - MTF.weekSlope] == null) return null;
  return { weeks, w, k, state: stateOf(weeks[k].close, w[k], w[k - MTF.weekSlope]) };
}

export function buildMtf(ctx, i, q, h) {
  const cs = ctx.candles, today = cs[i], m20 = ctx.m20;
  const wk = weeklyState(cs.slice(0, i + 1));
  if (!wk) return null;
  const { weeks, w, k } = wk, last = weeks[k];
  if (last.close === w[k] || w[k] === w[k - MTF.weekSlope] || today.close === m20[i] || m20[i] === m20[i - MTF.daySlope]) return null;
  const daily = stateOf(today.close, m20[i], m20[i - MTF.daySlope]), weekly = wk.state;
  const mixed = weekly === 'mixed' || daily === 'mixed';
  const answer = mixed ? 4 : (weekly === 'up' ? 0 : 2) + (daily === 'up' ? 0 : 1);
  h.choose(['주봉 상승 · 일봉 상승', '주봉 상승 · 일봉 하락', '주봉 하락 · 일봉 상승', '주봉 하락 · 일봉 하락',
    '주봉이나 일봉 안에서 위치와 기울기가 엇갈린다'], answer, mixed ? 'mixed' : weekly[0] + daily[0]);
  const DIR = { up: '상승 (선 위, 선 오름)', down: '하락 (선 아래, 선 내림)', mixed: '혼재 (위치와 기울기가 엇갈림)' };
  h.read('weekly', '주봉 · 마지막 완료 주 종가와 20주선', weekly, DIR,
    `종가 ${h.n(last.close)} · 20주선 ${h.n(w[k])} · 4주 전 20주선 ${h.n(w[k - MTF.weekSlope])}`, '아래 주봉 차트의 마지막 봉과 선');
  h.read('daily', '일봉 · 오늘 종가와 20일선', daily, DIR,
    `종가 ${h.n(today.close)} · 20일선 ${h.n(m20[i])} · 5거래일 전 20일선 ${h.n(m20[i - MTF.daySlope])}`, '위 일봉 차트의 마지막 봉과 초록선');
  h.read('anyMixed', '둘 중 엇갈린 쪽이 있는가', mixed ? 'yes' : 'no', { yes: '있다', no: '없다' },
    mixed ? `${weekly === 'mixed' ? '주봉' : '일봉'}에서 위치와 기울기가 엇갈립니다` : '두 단위 모두 위치와 기울기가 같은 쪽입니다', '두 차트 각각의 위치와 기울기');
  q.claims = [{ weekly: 'up', daily: 'up', anyMixed: 'no' }, { weekly: 'up', daily: 'down', anyMixed: 'no' },
    { weekly: 'down', daily: 'up', anyMixed: 'no' }, { weekly: 'down', daily: 'down', anyMixed: 'no' }, { anyMixed: 'yes' }];
  q.viewBars = 120;
  q.overlays = { ma20: true };
  q.weekly = weeks.slice(-MTF.shownWeeks);
  q.weeklyHistory = weeks;
  q.weeklyOverlays = { ma20: true };
  q.weeklyMarkerText = '마지막 완료 주';
  q.focusDate = last.date;
  q.prompt = '주봉(20주선)과 일봉(20일선)에서 각각 종가의 위치와 선의 기울기를 함께 읽으면?';
  q.hint = '이 연습은 "종가가 선 위이고 선이 오르면 상승, 둘 다 반대면 하락, 엇갈리면 혼재"로 정합니다. 주봉 20선은 20주(약 100거래일) 평균입니다. 진행 중일 수 있는 마지막 주는 뺐습니다.';
  q.facts = [h.price('마지막 완료 주 종가', last.close), h.price('20주선', w[k]), h.price('4주 전 20주선', w[k - MTF.weekSlope]),
    h.price('오늘 종가', today.close), h.price('20일선', m20[i]), h.price('5거래일 전 20일선', m20[i - MTF.daySlope])];
  q.margin = Math.min(Math.abs(last.close - w[k]) / w[k], Math.abs(w[k] - w[k - MTF.weekSlope]) / w[k],
    Math.abs(today.close - m20[i]) / m20[i], Math.abs(m20[i] - m20[i - MTF.daySlope]) / m20[i]) * 100;
  const NAME = { up: '상승', down: '하락', mixed: '혼재' };
  q.explanation = `주봉은 ${NAME[weekly]}, 일봉은 ${NAME[daily]}입니다. ${
    mixed ? '한쪽이라도 위치와 기울기가 엇갈리면 억지로 상승·하락을 고르지 않고 혼재로 둡니다.'
      : weekly !== daily ? `주봉이 ${NAME[weekly]}인데 일봉이 ${NAME[daily]}이면 큰 흐름 안의 ${weekly === 'up' ? '되돌림' : '반등'}일 수 있다고 설명합니다. 어느 쪽이었는지는 나중에야 알 수 있습니다.`
        : '두 단위의 방향이 같습니다. 같은 방향이라는 사실이 앞으로도 그 방향이 이어진다는 뜻은 아닙니다.'}`;
  return q;
}
