/**
 * 탐지 결과에 공통으로 붙는 두 가지: "이후 실제 성과"와 "차트에 보여줄 구간"
 * patterns.js(차트 패턴)와 candlestick.js(캔들 패턴)가 함께 쓴다.
 */

import { pct } from './indicators.js';

/** 신호 이후 성과를 확인할 기간(거래일). 판정에는 절대 쓰지 않고 사실 확인용으로만 붙인다. */
export const OUTCOME_DAYS = 20;

const round = (v, d = 2) => {
  if (v == null || !Number.isFinite(v)) return null;
  const n = Number(v);
  return +n.toFixed(d === 2 && Math.abs(n) < 10 ? 4 : d);
};

/** 신호일 이후 실제로 어떻게 움직였는지 */
export function outcomeAt(candles, i, days = OUTCOME_DAYS) {
  const j = Math.min(i + days, candles.length - 1);
  if (j <= i) return null;
  const from = candles[i].close;
  let hi = -Infinity;
  let lo = Infinity;
  for (let k = i + 1; k <= j; k++) {
    if (candles[k].high > hi) hi = candles[k].high;
    if (candles[k].low < lo) lo = candles[k].low;
  }
  return {
    days: j - i,
    fromDate: candles[i].date,
    toDate: candles[j].date,
    changePct: round(pct(from, candles[j].close)),
    maxUpPct: round(pct(from, hi)),
    maxDownPct: round(pct(from, lo)),
  };
}

/**
 * 신호를 실제로 알 수 있게 되는 날("확인일")부터 성과를 잰다.
 *
 * 판정에 뒷날 봉이 필요한 규칙이 있다. 스윙 저점은 뒤로 5봉이 더 지나야 저점이었음이
 * 확정되고, "교차가 5일 유지" 같은 조건도 5일이 지나야 참·거짓이 갈린다.
 * 그런 규칙의 성과를 신호일부터 재면, 그날은 아직 알 수 없던 사실을 알고 산 셈이 된다.
 * 게다가 "뒤 5봉보다 낮다"가 저점의 정의이므로 그 5봉은 반드시 위에 있다 —
 * 규칙이 스스로 수익을 만들어내고, 승률이 실제보다 크게 부풀려진다.
 *
 * 그래서 도형은 원래 지점에 그대로 그리고, 성적을 매기는 출발선만 확인일로 민다.
 * lag 가 0 인 규칙(그날 종가만으로 판정되는 규칙)은 이 함수를 쓸 필요가 없다.
 */
export function confirmedOutcome(candles, signalIdx, lag, days = OUTCOME_DAYS) {
  const j = signalIdx + lag;
  if (j >= candles.length) {
    return { confirmLag: lag, confirmDate: null, outcome: null };
  }
  return {
    confirmLag: lag,
    confirmDate: candles[j].date,
    outcome: outcomeAt(candles, j, days),
  };
}

/** 차트에 보여줄 앞뒤 여유 구간 */
export function windowRange(candles, startIdx, endIdx, pad = 40) {
  const a = Math.max(0, startIdx - pad);
  const b = Math.min(candles.length - 1, endIdx + pad);
  return { fromDate: candles[a].date, toDate: candles[b].date };
}

export { round };
