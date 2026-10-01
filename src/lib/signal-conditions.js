import { crossAt, pct } from './indicators.js';

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
