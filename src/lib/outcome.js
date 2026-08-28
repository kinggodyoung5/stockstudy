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

/** 차트에 보여줄 앞뒤 여유 구간 */
export function windowRange(candles, startIdx, endIdx, pad = 40) {
  const a = Math.max(0, startIdx - pad);
  const b = Math.min(candles.length - 1, endIdx + pad);
  return { fromDate: candles[a].date, toDate: candles[b].date };
}

export { round };
