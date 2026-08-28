/**
 * 오실레이터 / 보조지표 (가격 차트에 겹칠 수 없어 하단 별도 패널에 그리는 지표들)
 *
 * indicators.js 와 마찬가지로 전부 순수 함수이며,
 * 입력과 같은 길이의 배열을 돌려주고 계산 불가 구간은 null 이다.
 *
 * RSI·ATR·ADX 는 Wilder 평활(smoothing)을 쓴다. 일반 이동평균이 아니라
 * prev × (n-1)/n + 새값/n 방식이며, 대부분의 HTS/차트 프로그램이 이 방식을 따른다.
 */

import { sma, ema } from './indicators.js';

/**
 * RSI — 상대강도지수
 * 최근 period 동안 오른 폭과 내린 폭의 비율. 0~100.
 * 통상 70 이상 과매수, 30 이하 과매도로 본다.
 */
export function rsi(values, period = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length <= period) return out;

  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);

  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (period - 1) + (d > 0 ? d : 0)) / period;
    loss = (loss * (period - 1) + (d < 0 ? -d : 0)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

/** 앞쪽 null을 건너뛰고 계산한 뒤 원래 위치로 되돌리는 헬퍼 (지표의 지표를 만들 때 필요) */
function onCompact(values, fn) {
  const compact = [];
  const idx = [];
  for (let i = 0; i < values.length; i++) {
    if (values[i] != null) { compact.push(values[i]); idx.push(i); }
  }
  const result = fn(compact);
  const out = new Array(values.length).fill(null);
  for (let k = 0; k < result.length; k++) if (result[k] != null) out[idx[k]] = result[k];
  return out;
}

/**
 * MACD — 이동평균 수렴·확산
 * MACD선 = 12일 EMA − 26일 EMA, 시그널선 = MACD선의 9일 EMA, 히스토그램 = 둘의 차
 */
export function macd(values, fast = 12, slow = 26, signalPeriod = 9) {
  const ef = ema(values, fast);
  const es = ema(values, slow);
  const line = values.map((_, i) => (ef[i] == null || es[i] == null ? null : ef[i] - es[i]));
  const signal = onCompact(line, (c) => ema(c, signalPeriod));
  const hist = line.map((v, i) => (v == null || signal[i] == null ? null : v - signal[i]));
  return { line, signal, hist };
}

/**
 * 스토캐스틱 (Slow)
 * %K = (종가 − 기간 최저) ÷ (기간 최고 − 기간 최저) × 100 을 kSmooth 로 평활
 * %D = %K 의 dPeriod 이동평균
 */
export function stochastic(candles, kPeriod = 14, kSmooth = 3, dPeriod = 3) {
  const raw = new Array(candles.length).fill(null);
  for (let i = kPeriod - 1; i < candles.length; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let k = i - kPeriod + 1; k <= i; k++) {
      if (candles[k].high > hi) hi = candles[k].high;
      if (candles[k].low < lo) lo = candles[k].low;
    }
    raw[i] = hi === lo ? 50 : ((candles[i].close - lo) / (hi - lo)) * 100;
  }
  const k = onCompact(raw, (c) => sma(c, kSmooth));
  const d = onCompact(k, (c) => sma(c, dPeriod));
  return { raw, k, d };
}

/** 진폭(True Range) — 전일 종가까지 감안한 그날의 실제 변동폭 */
export function trueRange(candles) {
  const out = new Array(candles.length).fill(null);
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (i === 0) { out[i] = c.high - c.low; continue; }
    const pc = candles[i - 1].close;
    out[i] = Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
  }
  return out;
}

/** Wilder 평활 */
function wilder(values, period, from = 0) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  let count = 0;
  let prev = null;
  for (let i = from; i < values.length; i++) {
    if (values[i] == null) continue;
    if (prev == null) {
      sum += values[i];
      count++;
      if (count === period) { prev = sum / period; out[i] = prev; }
    } else {
      prev = (prev * (period - 1) + values[i]) / period;
      out[i] = prev;
    }
  }
  return out;
}

/**
 * ATR — 평균 진폭
 * "이 종목은 하루에 보통 얼마나 움직이나"를 가격 단위로 알려준다.
 * 손절 폭을 정할 때 널리 쓰인다 (예: 진입가 − ATR×2).
 */
export function atr(candles, period = 14) {
  return wilder(trueRange(candles), period);
}

/** ATR을 종가 대비 %로 (종목 간 비교용) */
export function atrPercent(candles, period = 14) {
  const a = atr(candles, period);
  return a.map((v, i) => (v == null ? null : (v / candles[i].close) * 100));
}

/**
 * ADX / DMI — 추세의 "강도"
 * +DI 가 −DI 위면 상승 우위, 아래면 하락 우위. ADX 는 방향과 무관한 추세 강도로,
 * 통상 25 이상이면 추세장, 20 이하면 횡보장으로 본다.
 * 다른 지표를 언제 믿을지 판단하는 메타 지표 역할을 한다.
 */
export function adx(candles, period = 14) {
  const n = candles.length;
  const plusDM = new Array(n).fill(null);
  const minusDM = new Array(n).fill(null);
  const tr = trueRange(candles);

  for (let i = 1; i < n; i++) {
    const up = candles[i].high - candles[i - 1].high;
    const down = candles[i - 1].low - candles[i].low;
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
  }

  const trS = wilder(tr, period, 1);
  const pS = wilder(plusDM, period, 1);
  const mS = wilder(minusDM, period, 1);

  const plusDI = new Array(n).fill(null);
  const minusDI = new Array(n).fill(null);
  const dx = new Array(n).fill(null);

  for (let i = 0; i < n; i++) {
    if (trS[i] == null || pS[i] == null || mS[i] == null || trS[i] === 0) continue;
    plusDI[i] = (pS[i] / trS[i]) * 100;
    minusDI[i] = (mS[i] / trS[i]) * 100;
    const sum = plusDI[i] + minusDI[i];
    dx[i] = sum === 0 ? 0 : (Math.abs(plusDI[i] - minusDI[i]) / sum) * 100;
  }

  return { plusDI, minusDI, adx: wilder(dx, period) };
}

/**
 * OBV — 누적 거래량
 * 종가가 오른 날은 거래량을 더하고 내린 날은 뺀다.
 * 가격이 제자리인데 OBV가 오르면 "조용히 매집 중"으로 해석하는 관점이 있다.
 */
export function obv(candles) {
  const out = new Array(candles.length).fill(null);
  let acc = 0;
  out[0] = 0;
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].close > candles[i - 1].close) acc += candles[i].volume;
    else if (candles[i].close < candles[i - 1].close) acc -= candles[i].volume;
    out[i] = acc;
  }
  return out;
}

/** 거래대금 (가격 × 거래량) — 국내에서 거래량보다 자주 쓰인다 */
export function tradingValue(candles) {
  return candles.map((c) => c.close * c.volume);
}

/**
 * 하나의 오실레이터 패널을 그리는 데 필요한 정보를 한 곳에 모아둔 정의.
 * views 와 chart.js 는 이 정의만 보고 패널을 만든다.
 */
export const OSCILLATORS = {
  rsi: {
    name: 'RSI (14)',
    lesson: 'rsi',
    height: 130,
    range: [0, 100],
    guides: [30, 50, 70],
    params: { period: 14 },
    compute: (candles, p = {}) => {
      const v = rsi(candles.map((c) => c.close), p.period || 14);
      return [{ key: 'RSI', type: 'line', color: '#f2b134', values: v }];
    },
  },
  macd: {
    name: 'MACD (12,26,9)',
    lesson: 'macd',
    height: 140,
    guides: [0],
    params: { fast: 12, slow: 26, signal: 9 },
    compute: (candles, p = {}) => {
      const m = macd(candles.map((c) => c.close), p.fast || 12, p.slow || 26, p.signal || 9);
      return [
        { key: '히스토그램', type: 'histogram', color: '#5b8def', values: m.hist, signed: true },
        { key: 'MACD', type: 'line', color: '#4dd0a7', values: m.line },
        { key: '시그널', type: 'line', color: '#e04b4b', values: m.signal },
      ];
    },
  },
  stochastic: {
    name: '스토캐스틱 (14,3,3)',
    lesson: 'stochastic',
    height: 130,
    range: [0, 100],
    guides: [20, 80],
    params: { k: 14, kSmooth: 3, d: 3 },
    compute: (candles, p = {}) => {
      const s = stochastic(candles, p.k || 14, p.kSmooth || 3, p.d || 3);
      return [
        { key: '%K', type: 'line', color: '#4dd0a7', values: s.k },
        { key: '%D', type: 'line', color: '#e04b4b', values: s.d },
      ];
    },
  },
  atr: {
    name: 'ATR (14, 종가 대비 %)',
    lesson: 'atr',
    height: 120,
    params: { period: 14 },
    compute: (candles, p = {}) => [
      { key: 'ATR%', type: 'line', color: '#a98bff', values: atrPercent(candles, p.period || 14) },
    ],
  },
  adx: {
    name: 'ADX / DMI (14)',
    lesson: 'adx',
    height: 140,
    guides: [20, 25],
    params: { period: 14 },
    compute: (candles, p = {}) => {
      const a = adx(candles, p.period || 14);
      return [
        { key: 'ADX', type: 'line', color: '#f2b134', values: a.adx, width: 2 },
        { key: '+DI', type: 'line', color: '#e04b4b', values: a.plusDI },
        { key: '−DI', type: 'line', color: '#2f7fe0', values: a.minusDI },
      ];
    },
  },
  obv: {
    name: 'OBV (누적 거래량)',
    lesson: 'obv',
    height: 120,
    compute: (candles) => [
      { key: 'OBV', type: 'line', color: '#8b95a9', values: obv(candles) },
    ],
  },
};

export const OSCILLATOR_IDS = Object.keys(OSCILLATORS);
