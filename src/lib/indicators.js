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

/** 기간 내 최고가 / 최저가 (rolling) */
export function rollingHigh(candles, period) {
  const out = new Array(candles.length).fill(null);
  for (let i = period - 1; i < candles.length; i++) {
    let h = -Infinity;
    for (let k = i - period + 1; k <= i; k++) if (candles[k].high > h) h = candles[k].high;
    out[i] = h;
  }
  return out;
}

export function rollingLow(candles, period) {
  const out = new Array(candles.length).fill(null);
  for (let i = period - 1; i < candles.length; i++) {
    let l = Infinity;
    for (let k = i - period + 1; k <= i; k++) if (candles[k].low < l) l = candles[k].low;
    out[i] = l;
  }
  return out;
}

/**
 * 이격도 — 종가가 이동평균선에서 얼마나 떨어져 있는지 (%)
 * 100이면 이평선과 같은 값. 국내에서 과열/침체 판단에 자주 쓴다.
 */
export function disparity(values, period = 20) {
  const m = sma(values, period);
  return values.map((v, i) => (m[i] == null ? null : (v / m[i]) * 100));
}

/**
 * 좌우 w봉보다 높은(낮은) 국소 극점.
 * 지지·저항, 다이버전스, 차트 패턴 탐지가 전부 이 함수 위에 얹힌다.
 */
export function pivots(candles, w = 5) {
  const highs = [];
  const lows = [];
  for (let i = w; i < candles.length - w; i++) {
    let isHigh = true;
    let isLow = true;
    for (let k = i - w; k <= i + w; k++) {
      if (k === i) continue;
      if (candles[k].high >= candles[i].high) isHigh = false;
      if (candles[k].low <= candles[i].low) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) highs.push(i);
    if (isLow) lows.push(i);
  }
  return { highs, lows };
}

/**
 * 지지선 / 저항선 자동 탐지
 * 스윙 고점·저점을 가격대별로 묶어서, 여러 번 반복해서 반응한 가격대만 남긴다.
 * "몇 번 건드렸는가(touches)"가 그 선의 신뢰도 근거가 된다.
 */
export function supportResistance(candles, opt = {}) {
  const p = { window: 5, tolerancePct: 1.5, minTouches: 2, maxLevels: 6, ...opt };
  const { highs, lows } = pivots(candles, p.window);

  const points = [
    ...highs.map((i) => ({ i, price: candles[i].high, kind: 'high' })),
    ...lows.map((i) => ({ i, price: candles[i].low, kind: 'low' })),
  ].sort((a, b) => a.price - b.price);

  const clusters = [];
  for (const pt of points) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(pt.price - last.price) / last.price * 100 <= p.tolerancePct) {
      last.points.push(pt);
      last.price = last.points.reduce((s, x) => s + x.price, 0) / last.points.length;
    } else {
      clusters.push({ price: pt.price, points: [pt] });
    }
  }

  const lastClose = candles[candles.length - 1].close;
  return clusters
    .filter((c) => c.points.length >= p.minTouches)
    .map((c) => ({
      price: +c.price.toFixed(4),
      touches: c.points.length,
      lastTouch: candles[Math.max(...c.points.map((x) => x.i))].date,
      // 현재가보다 위면 저항, 아래면 지지
      kind: c.price > lastClose ? 'resistance' : 'support',
      distancePct: +(((c.price - lastClose) / lastClose) * 100).toFixed(2),
    }))
    .sort((a, b) => b.touches - a.touches)
    .slice(0, p.maxLevels)
    .sort((a, b) => b.price - a.price);
}

/**
 * 피보나치 되돌림
 * 한 번의 큰 상승(또는 하락) 구간을 잡고, 그 폭의 23.6/38.2/50/61.8/78.6% 지점을
 * 조정이 멈출 후보 자리로 본다.
 */
export const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

export function fibonacci(candles, fromIdx, toIdx) {
  const a = candles[fromIdx];
  const b = candles[toIdx];
  const up = b.close >= a.close;
  const hi = up ? Math.max(...candles.slice(fromIdx, toIdx + 1).map((c) => c.high))
                : Math.max(...candles.slice(fromIdx, toIdx + 1).map((c) => c.high));
  const lo = Math.min(...candles.slice(fromIdx, toIdx + 1).map((c) => c.low));
  const span = hi - lo;
  return {
    up,
    high: hi,
    low: lo,
    levels: FIB_RATIOS.map((r) => ({
      ratio: r,
      label: (r * 100).toFixed(1) + '%',
      // 상승 구간이면 고점에서 아래로, 하락 구간이면 저점에서 위로 되돌린다
      price: up ? hi - span * r : lo + span * r,
    })),
  };
}

/** 최근 구간에서 가장 큰 상승(또는 하락) 스윙을 자동으로 잡아준다 */
export function dominantSwing(candles, lookback = 120) {
  const start = Math.max(0, candles.length - lookback);
  let loIdx = start;
  let hiIdx = start;
  for (let i = start; i < candles.length; i++) {
    if (candles[i].low < candles[loIdx].low) loIdx = i;
    if (candles[i].high > candles[hiIdx].high) hiIdx = i;
  }
  return loIdx < hiIdx ? { fromIdx: loIdx, toIdx: hiIdx } : { fromIdx: hiIdx, toIdx: loIdx };
}

/**
 * 매물대 (Volume Profile)
 * 가격대를 bins개로 나누고, 각 봉의 거래량을 그 봉의 가격대에 배분해 누적한다.
 * 거래량이 몰린 가격대는 매물이 쌓인 구간이라 지지·저항으로 작용한다고 본다.
 */
export function volumeProfile(candles, bins = 24) {
  if (!candles.length) return { rows: [], poc: null };
  let hi = -Infinity;
  let lo = Infinity;
  for (const c of candles) {
    if (c.high > hi) hi = c.high;
    if (c.low < lo) lo = c.low;
  }
  const step = (hi - lo) / bins || 1;
  const rows = Array.from({ length: bins }, (_, i) => ({
    low: lo + step * i,
    high: lo + step * (i + 1),
    mid: lo + step * (i + 0.5),
    volume: 0,
  }));

  for (const c of candles) {
    // 한 봉의 거래량을 그 봉이 걸친 가격 구간에 균등 배분
    const a = Math.max(0, Math.floor((c.low - lo) / step));
    const b = Math.min(bins - 1, Math.floor((c.high - lo) / step));
    const share = c.volume / (b - a + 1);
    for (let k = a; k <= b; k++) rows[k].volume += share;
  }

  const poc = rows.reduce((m, r) => (r.volume > m.volume ? r : m), rows[0]); // Point of Control
  const total = rows.reduce((s, r) => s + r.volume, 0);
  return { rows, poc, total, step };
}

/**
 * 일봉 → 주봉 / 월봉 리샘플링
 * 같은 종목도 시간 단위를 바꾸면 신호가 완전히 달라진다는 걸 보여주기 위한 것.
 */
export function resample(candles, unit = 'week') {
  if (unit === 'day') return candles;
  const keyOf = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00Z');
    if (unit === 'month') return dateStr.slice(0, 7);
    // 주봉: 그 주 월요일 날짜를 키로
    const day = d.getUTCDay();
    const diff = (day + 6) % 7; // 월요일=0
    d.setUTCDate(d.getUTCDate() - diff);
    return d.toISOString().slice(0, 10);
  };

  const out = [];
  let cur = null;
  let curKey = null;
  for (const c of candles) {
    const key = keyOf(c.date);
    if (key !== curKey) {
      if (cur) out.push(cur);
      curKey = key;
      cur = { date: c.date, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
    } else {
      cur.high = Math.max(cur.high, c.high);
      cur.low = Math.min(cur.low, c.low);
      cur.close = c.close;
      cur.volume += c.volume;
      cur.date = c.date; // 그 주/달의 마지막 거래일을 대표 날짜로
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * 상대강도 (종목 ÷ 지수)
 * 값이 오르면 지수보다 잘 가고 있다는 뜻. 시장 전체가 오를 때
 * "이 종목이 특별히 센 건지, 그냥 시장을 따라간 건지"를 구분해준다.
 */
export function relativeStrength(candles, benchCandles) {
  const bench = new Map(benchCandles.map((c) => [c.date, c.close]));
  const out = new Array(candles.length).fill(null);
  let base = null;
  for (let i = 0; i < candles.length; i++) {
    const b = bench.get(candles[i].date);
    if (b == null) continue;
    const ratio = candles[i].close / b;
    if (base == null) base = ratio;
    out[i] = (ratio / base) * 100; // 시작 시점을 100으로 정규화
  }
  return out;
}
