/**
 * 지표 계산 모듈 (순수 함수)
 *
 * 설명서 4.2 원칙: 지표는 저장하지 않고 원시 OHLCV에서 즉석 계산한다.
 * 모든 함수는 입력과 같은 길이의 배열을 돌려주며, 계산이 불가능한 앞 구간은 null이다.
 * (React로 옮겨가도 이 파일은 그대로 재사용된다 — DOM/차트 의존성 없음)
 */

/** candles → 종가 배열 */
export const closes = (candles) => candles.map((c) => c.close);
/** candles → 거래량 배열 */
export const volumes = (candles) => candles.map((c) => c.volume);

/** 단순이동평균 */
export function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** 지수이동평균 (첫 값은 앞 period개의 단순평균으로 시작) */
export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev = null;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i === period - 1) {
      prev = sum / period;
      out[i] = prev;
    } else if (i >= period) {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

/** 이동 표준편차 (모집단 기준 — 볼린저밴드 관례) */
export function stdev(values, period) {
  const out = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let mean = 0;
    for (let k = i - period + 1; k <= i; k++) mean += values[k];
    mean /= period;
    let v = 0;
    for (let k = i - period + 1; k <= i; k++) v += (values[k] - mean) ** 2;
    out[i] = Math.sqrt(v / period);
  }
  return out;
}

/**
 * 볼린저밴드
 * 중심선 = 20일 이동평균, 상/하단 = 중심선 ± (표준편차 × mult)
 */
export function bollinger(values, period = 20, mult = 2) {
  const mid = sma(values, period);
  const sd = stdev(values, period);
  const upper = [], lower = [], width = [];
  for (let i = 0; i < values.length; i++) {
    if (mid[i] == null || sd[i] == null) {
      upper.push(null); lower.push(null); width.push(null);
      continue;
    }
    upper.push(mid[i] + sd[i] * mult);
    lower.push(mid[i] - sd[i] * mult);
    width.push(((sd[i] * mult * 2) / mid[i]) * 100); // 밴드폭(%) — 변동성 축소/확대 판단용
  }
  return { mid, upper, lower, width };
}

/**
 * 일목균형표
 * 전환선(9), 기준선(26), 선행스팬1/2(26칸 앞으로), 후행스팬(26칸 뒤로)
 * 반환 배열의 i번째 값은 "차트의 i번째 봉 위치에 그려질 값"이다 (선행/후행 이동이 이미 반영됨).
 */
export function ichimoku(candles, opt = {}) {
  const p = { conversion: 9, base: 26, span: 52, shift: 26, ...opt };
  const n = candles.length;
  const midOf = (period, i) => {
    if (i < period - 1 || i < 0) return null;
    let h = -Infinity, l = Infinity;
    for (let k = i - period + 1; k <= i; k++) {
      if (candles[k].high > h) h = candles[k].high;
      if (candles[k].low < l) l = candles[k].low;
    }
    return (h + l) / 2;
  };

  const tenkan = [], kijun = [], spanA = [], spanB = [], chikou = [];
  for (let i = 0; i < n; i++) {
    tenkan.push(midOf(p.conversion, i));
    kijun.push(midOf(p.base, i));
  }
  for (let i = 0; i < n; i++) {
    const src = i - p.shift; // 선행스팬은 26칸 전의 값을 현재 위치에 그린다
    spanA.push(src >= 0 && tenkan[src] != null && kijun[src] != null ? (tenkan[src] + kijun[src]) / 2 : null);
    spanB.push(src >= 0 ? midOf(p.span, src) : null);
    chikou.push(i + p.shift < n ? candles[i + p.shift].close : null); // 후행스팬은 26칸 뒤 종가
  }
  return { tenkan, kijun, spanA, spanB, chikou };
}

/** 구름대 상단/하단 (선행스팬1·2 중 큰 값 / 작은 값) */
export function cloudBounds(ich) {
  const top = [], bottom = [];
  for (let i = 0; i < ich.spanA.length; i++) {
    const a = ich.spanA[i], b = ich.spanB[i];
    if (a == null || b == null) { top.push(null); bottom.push(null); continue; }
    top.push(Math.max(a, b));
    bottom.push(Math.min(a, b));
  }
  return { top, bottom };
}

/** 두 선의 교차 방향: 1 = a가 b를 상향 돌파, -1 = 하향 돌파, 0 = 교차 없음 */
export function crossAt(a, b, i) {
  if (i < 1) return 0;
  if (a[i] == null || b[i] == null || a[i - 1] == null || b[i - 1] == null) return 0;
  const prev = a[i - 1] - b[i - 1];
  const cur = a[i] - b[i];
  if (prev <= 0 && cur > 0) return 1;
  if (prev >= 0 && cur < 0) return -1;
  return 0;
}

/** 변동률(%) */
export const pct = (from, to) => ((to - from) / from) * 100;
