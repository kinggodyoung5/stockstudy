/** 패턴 첫 봉은 제외. start-1-n → start-1의 n개 종가 변화 구간을 잰다. */
export function trendBeforePattern(candles, start, n = 10) {
  const end = start - 1;
  const first = end - n;
  if (first < 0 || !candles[end]) return null;
  return (candles[end].close / candles[first].close - 1) * 100;
}

/** 이중·삼중 패턴 깊이: 천장은 최고 고점, 바닥은 최저 저점을 분모로 쓴다. */
export function retracementDepth(prices, neckline, isTop) {
  const anchor = isTop ? Math.max(...prices) : Math.min(...prices);
  return (isTop ? anchor - neckline : neckline - anchor) / anchor * 100;
}

/** 앱이 정한 다이버전스 잡음 필터. 수익 최적화나 보편적인 표준값이 아니다. */
export const DIVERGENCE_LIMITS = { rsi: 5, macd: 0.1, obv: 5 };
export function divergenceMagnitude(kind, candles, series, i1, i2) {
  const change = Math.abs(series[i2] - series[i1]);
  let scale = 1;
  let label = 'RSI 차이(포인트)';
  if (kind === 'obv') {
    scale = 0;
    // OBV(i2)-OBV(i1)에 들어간 봉만 분모에 포함한다. 보합 거래량도 포함.
    for (let i = i1 + 1; i <= i2; i++) scale += candles[i].volume;
    label = 'OBV 차이 / 구간 총거래량(%)';
  } else if (kind === 'macd') {
    scale = (candles[i1].close + candles[i2].close) / 2;
    label = '히스토그램 차이 / 두 시점 평균 종가(%)';
  }
  const value = scale > 0 && Number.isFinite(scale) ? change / scale * (kind === 'rsi' ? 1 : 100) : null;
  return { value, label, threshold: DIVERGENCE_LIMITS[kind],
    passes: Number.isFinite(value) && value >= DIVERGENCE_LIMITS[kind] };
}
