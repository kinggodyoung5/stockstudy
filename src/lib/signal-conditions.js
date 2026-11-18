import { crossAt, pct } from './indicators.js';
import { divergenceMagnitude } from './pattern-context.js';

export const CROSS_HOLD = 5;
/** 교차일부터 cutoff까지만 본다. pending과 실패를 구분하고 엔진·교재가 공유한다. */
export function crossCondition(short, long, start, cutoff, direction = 1) {
  const cross = crossAt(short, long, start) === direction;
  let clean = true;
  for (let k = Math.max(1, start - 20); k < start; k++) {
    if (crossAt(short, long, k) === -direction) clean = false;
  }
  let held = true;
  for (let k = start; k <= Math.min(start + CROSS_HOLD, cutoff); k++) {
    if (short[k] == null || long[k] == null || direction * (short[k] - long[k]) <= 0) held = false;
  }
  const elapsed = cutoff - start;
  return { cross, clean, held, elapsed,
    status: !cross || !clean || !held ? 'fail' : elapsed < CROSS_HOLD ? 'pending' : 'pass' };
}

/** cooldown은 두 수치 조건을 만족한 날을 기준으로 한다(연속 후보도 포함). */
export function volumeCondition(candles, i, lastCandidate = -999) {
  const avg = candles.slice(i - 20, i).reduce((sum, c) => sum + c.volume, 0) / 20;
  const ratio = avg > 0 ? candles[i].volume / avg : null;
  const change = pct(candles[i - 1].close, candles[i].close);
  const candidate = i >= 21 && ratio >= 2 && Math.abs(change) >= 2;
  return { avg, ratio, change, candidate, spaced: i - lastCandidate > 10,
    status: candidate && i - lastCandidate > 10 ? 'pass' : 'fail' };
}

/** 다이버전스로 비교할 두 극점의 간격(거래일). 탐지기와 입문 연습이 같이 쓴다. */
export const DIVERGENCE_GAP = [10, 60];
/** 가격 극점이 이만큼(%) 이상 낮아지거나(강세) 높아져야(약세) 한다. */
export const DIVERGENCE_PRICE_MOVE = 2;

/**
 * 두 극점 i1 < i2 의 다이버전스 조건. 탐지기(patterns-oscillator.js)와 입문 연습이 같은 계산을 쓴다.
 * 극점이 확인됐는지(뒤 5봉)는 여기서 보지 않는다. 부르는 쪽이 정한다.
 */
export function divergenceCondition(kind, candles, series, i1, i2, bullish) {
  const p1 = bullish ? candles[i1].low : candles[i1].high, p2 = bullish ? candles[i2].low : candles[i2].high;
  const gap = i2 - i1, gapOk = gap >= DIVERGENCE_GAP[0] && gap <= DIVERGENCE_GAP[1];
  const hasSeries = series[i1] != null && series[i2] != null;
  const priceMove = pct(p1, p2);
  // 가격은 방향을 이어가는데(저점 더 낮게 / 고점 더 높게) 지표는 반대로 꺾여야 한다
  const priceOk = bullish ? priceMove <= -DIVERGENCE_PRICE_MOVE : priceMove >= DIVERGENCE_PRICE_MOVE;
  const indOk = hasSeries && (bullish ? series[i2] > series[i1] : series[i2] < series[i1]);
  const magnitude = hasSeries ? divergenceMagnitude(kind, candles, series, i1, i2) : { value: null, passes: false };
  return { p1, p2, gap, gapOk, hasSeries, priceMove, priceOk, indOk, magnitude,
    pass: gapOk && hasSeries && priceOk && indOk && magnitude.passes };
}
