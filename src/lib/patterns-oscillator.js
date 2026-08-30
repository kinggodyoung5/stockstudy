/**
 * 오실레이터 기반 패턴 (RSI · MACD · 스토캐스틱 · ADX · 이격도 · 볼린저 스퀴즈 · 다이버전스)
 *
 * 다이버전스는 "가격은 신고가인데 지표는 못 따라간다"처럼 두 시계열의 방향이
 * 어긋나는 것을 잡는다. 사람 눈으로는 아무 데서나 보이기 때문에,
 * 여기서는 국소 극점끼리만 비교하고 간격·폭 조건을 걸어 후보를 크게 줄인다.
 */

import { pivots, closes, pct, bollinger, disparity } from './indicators.js';
import { rsi, macd, obv, stochastic, adx } from './oscillators.js';
import { outcomeAt, confirmedOutcome, windowRange, round } from './outcome.js';

// ── 다이버전스 (범용) ────────────────────────────────────────

/**
 * 스윙 고점·저점을 인정할 좌우 폭.
 *
 * 어떤 날이 저점인지는 그 뒤로 PIVOT_W 봉이 더 지나야 확정된다 — 그 전에는 더 떨어질 수
 * 있기 때문이다. 그래서 성과는 저점 당일이 아니라 PIVOT_W 봉 뒤(확인일)부터 잰다.
 * 저점의 정의가 "뒤 PIVOT_W 봉보다 낮다"이므로, 저점 당일부터 재면 그 구간은
 * 반드시 위로 가 있다. 규칙이 스스로 만들어낸 수익을 성과로 착각하게 된다.
 */
const PIVOT_W = 5;

/**
 * @param stock      종목
 * @param series     비교할 지표 값 배열
 * @param bullish    true면 강세 다이버전스(가격 저점 낮아짐 + 지표 저점 높아짐)
 * @param label      근거 표시에 쓸 지표 이름
 */
function divergence(stock, series, bullish, label) {
  const { candles } = stock;
  const { highs, lows } = pivots(candles, PIVOT_W);
  const points = bullish ? lows : highs;
  const priceAt = (i) => (bullish ? candles[i].low : candles[i].high);
  const hits = [];
  let last = -999;

  for (let a = 0; a + 1 < points.length; a++) {
    const i1 = points[a];
    const i2 = points[a + 1];
    const gap = i2 - i1;
    if (gap < 10 || gap > 60) continue;
    if (series[i1] == null || series[i2] == null) continue;

    const p1 = priceAt(i1);
    const p2 = priceAt(i2);
    const priceMove = pct(p1, p2);

    // 가격은 방향을 이어가는데(저점 더 낮게 / 고점 더 높게) 지표는 반대로 꺾여야 한다
    const priceOk = bullish ? priceMove <= -2 : priceMove >= 2;
    const indOk = bullish ? series[i2] > series[i1] : series[i2] < series[i1];
    if (!priceOk || !indOk) continue;

    // 지표 차이가 미미하면 잡음이다
    const indDiff = Math.abs(series[i2] - series[i1]);
    const indScale = Math.max(Math.abs(series[i1]), Math.abs(series[i2]), 1e-9);
    if (indDiff / indScale < 0.05) continue;

    if (i2 - last < 30) continue;
    last = i2;

    hits.push({
      index: i2,
      date: candles[i2].date,
      evidence: [
        { label: `가격 ${bullish ? '저점' : '고점'} 1`, value: round(p1) + ' (' + candles[i1].date + ')' },
        { label: `가격 ${bullish ? '저점' : '고점'} 2`, value: round(p2) + ' (' + candles[i2].date + ')' },
        { label: '가격 변화(%)', value: round(priceMove) },
        { label: `${label} 값 1`, value: round(series[i1], 3) },
        { label: `${label} 값 2`, value: round(series[i2], 3) },
        { label: `${label} 변화율(%)`, value: round((indDiff / indScale) * 100) },
        { label: '두 지점 간격(거래일)', value: gap },
        { label: '신호를 알 수 있게 된 날', value: candles[Math.min(i2 + PIVOT_W, candles.length - 1)].date },
      ],
      shape: {
        divergence: {
          price: [
            { date: candles[i1].date, value: round(p1) },
            { date: candles[i2].date, value: round(p2) },
          ],
        },
      },
      ...windowRange(candles, i1, i2 + PIVOT_W, 25),
      ...confirmedOutcome(candles, i2, PIVOT_W),
    });
  }
  return hits;
}

// ── 단순 임계값 / 교차 판정기 ────────────────────────────────

/** 값이 임계선을 처음 넘은 날만 잡는다 (연속 구간의 첫날) */
function thresholdCross(stock, series, { above, level, cooldown = 20, evidence }) {
  const { candles } = stock;
  const hits = [];
  let last = -999;
  for (let i = 1; i < candles.length; i++) {
    if (series[i] == null || series[i - 1] == null) continue;
    const now = above ? series[i] >= level : series[i] <= level;
    const before = above ? series[i - 1] >= level : series[i - 1] <= level;
    if (!now || before) continue;
    if (i - last < cooldown) { last = i; continue; }
    last = i;
    hits.push({
      index: i,
      date: candles[i].date,
      evidence: evidence(i),
      ...windowRange(candles, i, i),
      outcome: outcomeAt(candles, i),
    });
  }
  return hits;
}

/** 두 선의 교차 */
function lineCross(stock, a, b, up, { cooldown = 15, guard, evidence }) {
  const { candles } = stock;
  const hits = [];
  let last = -999;
  for (let i = 1; i < candles.length; i++) {
    if (a[i] == null || b[i] == null || a[i - 1] == null || b[i - 1] == null) continue;
    const crossed = up ? a[i - 1] <= b[i - 1] && a[i] > b[i] : a[i - 1] >= b[i - 1] && a[i] < b[i];
    if (!crossed) continue;
    if (guard && !guard(i)) continue;
    if (i - last < cooldown) { last = i; continue; }
    last = i;
    hits.push({
      index: i,
      date: candles[i].date,
      evidence: evidence(i),
      ...windowRange(candles, i, i),
      outcome: outcomeAt(candles, i),
    });
  }
  return hits;
}

// ── 볼린저 스퀴즈 ────────────────────────────────────────────

function bollingerSqueeze(stock, up) {
  const { candles } = stock;
  const c = closes(candles);
  const bb = bollinger(c, 20, 2);
  const LOOK = 120;
  const hits = [];
  let last = -999;

  for (let i = LOOK; i < candles.length; i++) {
    if (bb.width[i - 1] == null) continue;
    // 전날까지의 밴드폭이 최근 120일 중 하위 10% 안에 있어야 "눌려 있던" 상태
    const window = bb.width.slice(i - LOOK, i).filter((v) => v != null).sort((x, y) => x - y);
    if (window.length < 60) continue;
    const p10 = window[Math.floor(window.length * 0.1)];
    if (bb.width[i - 1] > p10) continue;

    const broke = up ? c[i] > bb.upper[i] : c[i] < bb.lower[i];
    if (!broke) continue;
    if (i - last < 30) { last = i; continue; }
    last = i;

    hits.push({
      index: i,
      date: candles[i].date,
      evidence: [
        { label: '전일 밴드폭(%)', value: round(bb.width[i - 1]) },
        { label: '최근 120일 밴드폭 하위 10% 기준선(%)', value: round(p10) },
        { label: '당일 종가', value: round(c[i]) },
        { label: up ? '밴드 상단' : '밴드 하단', value: round(up ? bb.upper[i] : bb.lower[i]) },
        { label: '당일 밴드폭(%)', value: round(bb.width[i]) },
        { label: '밴드폭 확대 배수', value: round(bb.width[i] / bb.width[i - 1]) },
      ],
      ...windowRange(candles, Math.max(0, i - 60), i, 20),
      outcome: outcomeAt(candles, i),
    });
  }
  return hits;
}

// ── 메타데이터 ──────────────────────────────────────────────

export const OSC_PATTERNS = {
  'rsi-oversold': {
    name: 'RSI 과매도 진입', lesson: 'rsi', bias: 'up',
    summary: 'RSI(14)가 30 아래로 내려간 첫날',
    rules: ['전일 RSI > 30 이고 당일 RSI ≤ 30', '직전 20거래일 안에 같은 신호가 없었음'],
  },
  'rsi-overbought': {
    name: 'RSI 과매수 진입', lesson: 'rsi', bias: 'down',
    summary: 'RSI(14)가 70 위로 올라간 첫날',
    rules: ['전일 RSI < 70 이고 당일 RSI ≥ 70', '직전 20거래일 안에 같은 신호가 없었음'],
  },
  'rsi-bullish-divergence': {
    name: 'RSI 강세 다이버전스', lesson: 'divergence', bias: 'up',
    summary: '가격은 저점을 더 낮췄는데 RSI는 저점을 높인 구간',
    rules: [
      '국소 저점 두 개의 간격이 10 ~ 60 거래일',
      '두 번째 저가가 첫 저가보다 2% 이상 낮음',
      '같은 두 지점의 RSI는 두 번째가 더 높음',
      'RSI 차이가 5% 이상 (미미한 차이는 잡음으로 제외)',
    ],
    confirm: {
      lag: 5,
      why: '어떤 날이 국소 저점·고점인지는 뒤로 5봉이 더 지나야 정해집니다. 그 전에는 더 갈 수 있기 때문입니다. 그래서 성과는 그 지점이 아니라 확정된 날부터 쟀습니다.',
    },
  },
  'rsi-bearish-divergence': {
    name: 'RSI 약세 다이버전스', lesson: 'divergence', bias: 'down',
    summary: '가격은 고점을 더 높였는데 RSI는 고점을 낮춘 구간',
    rules: [
      '국소 고점 두 개의 간격이 10 ~ 60 거래일',
      '두 번째 고가가 첫 고가보다 2% 이상 높음',
      '같은 두 지점의 RSI는 두 번째가 더 낮음',
      'RSI 차이가 5% 이상',
    ],
    confirm: {
      lag: 5,
      why: '어떤 날이 국소 저점·고점인지는 뒤로 5봉이 더 지나야 정해집니다. 그 전에는 더 갈 수 있기 때문입니다. 그래서 성과는 그 지점이 아니라 확정된 날부터 쟀습니다.',
    },
  },
  'macd-golden-cross': {
    name: 'MACD 골든크로스', lesson: 'macd', bias: 'up',
    summary: 'MACD선이 시그널선을 아래에서 위로 뚫는 지점 (0선 아래에서 발생한 것만)',
    rules: [
      'MACD선이 시그널선을 상향 교차',
      '교차 시점의 MACD선이 0 아래 (하락 국면에서의 반전만 잡는다)',
      '직전 15거래일 안에 같은 신호가 없었음',
    ],
  },
  'macd-dead-cross': {
    name: 'MACD 데드크로스', lesson: 'macd', bias: 'down',
    summary: 'MACD선이 시그널선을 위에서 아래로 뚫는 지점 (0선 위에서 발생한 것만)',
    rules: [
      'MACD선이 시그널선을 하향 교차',
      '교차 시점의 MACD선이 0 위',
      '직전 15거래일 안에 같은 신호가 없었음',
    ],
  },
  'macd-bullish-divergence': {
    name: 'MACD 강세 다이버전스', lesson: 'divergence', bias: 'up',
    summary: '가격은 저점을 낮췄는데 MACD 히스토그램은 저점을 높인 구간',
    rules: [
      '국소 저점 두 개의 간격이 10 ~ 60 거래일',
      '두 번째 저가가 첫 저가보다 2% 이상 낮음',
      '같은 두 지점의 MACD 히스토그램은 두 번째가 더 높음',
      '히스토그램 차이가 5% 이상',
    ],
    confirm: {
      lag: 5,
      why: '어떤 날이 국소 저점·고점인지는 뒤로 5봉이 더 지나야 정해집니다. 그 전에는 더 갈 수 있기 때문입니다. 그래서 성과는 그 지점이 아니라 확정된 날부터 쟀습니다.',
    },
  },
  'macd-bearish-divergence': {
    name: 'MACD 약세 다이버전스', lesson: 'divergence', bias: 'down',
    summary: '가격은 고점을 높였는데 MACD 히스토그램은 고점을 낮춘 구간',
    rules: [
      '국소 고점 두 개의 간격이 10 ~ 60 거래일',
      '두 번째 고가가 첫 고가보다 2% 이상 높음',
      '같은 두 지점의 MACD 히스토그램은 두 번째가 더 낮음',
      '히스토그램 차이가 5% 이상',
    ],
    confirm: {
      lag: 5,
      why: '어떤 날이 국소 저점·고점인지는 뒤로 5봉이 더 지나야 정해집니다. 그 전에는 더 갈 수 있기 때문입니다. 그래서 성과는 그 지점이 아니라 확정된 날부터 쟀습니다.',
    },
  },
  'obv-bullish-divergence': {
    name: 'OBV 강세 다이버전스', lesson: 'obv', bias: 'up',
    summary: '가격은 저점을 낮췄는데 누적 거래량(OBV)은 저점을 높인 구간',
    rules: [
      '국소 저점 두 개의 간격이 10 ~ 60 거래일',
      '두 번째 저가가 첫 저가보다 2% 이상 낮음',
      '같은 두 지점의 OBV는 두 번째가 더 높음',
      'OBV 차이가 5% 이상',
    ],
    confirm: {
      lag: 5,
      why: '어떤 날이 국소 저점·고점인지는 뒤로 5봉이 더 지나야 정해집니다. 그 전에는 더 갈 수 있기 때문입니다. 그래서 성과는 그 지점이 아니라 확정된 날부터 쟀습니다.',
    },
  },
  'obv-bearish-divergence': {
    name: 'OBV 약세 다이버전스', lesson: 'obv', bias: 'down',
    summary: '가격은 고점을 높였는데 누적 거래량(OBV)은 고점을 낮춘 구간',
    rules: [
      '국소 고점 두 개의 간격이 10 ~ 60 거래일',
      '두 번째 고가가 첫 고가보다 2% 이상 높음',
      '같은 두 지점의 OBV는 두 번째가 더 낮음',
      'OBV 차이가 5% 이상',
    ],
    confirm: {
      lag: 5,
      why: '어떤 날이 국소 저점·고점인지는 뒤로 5봉이 더 지나야 정해집니다. 그 전에는 더 갈 수 있기 때문입니다. 그래서 성과는 그 지점이 아니라 확정된 날부터 쟀습니다.',
    },
  },
  'stochastic-oversold-cross': {
    name: '스토캐스틱 과매도 반등', lesson: 'stochastic', bias: 'up',
    summary: '과매도 구간(20 이하)에서 %K가 %D를 위로 뚫는 지점',
    rules: ['%K가 %D를 상향 교차', '교차 시점의 %K, %D 모두 20 이하 (표준 과매도선)', '직전 15거래일 안에 같은 신호가 없었음'],
  },
  'stochastic-overbought-cross': {
    name: '스토캐스틱 과열 꺾임', lesson: 'stochastic', bias: 'down',
    summary: '과매수 구간(80 이상)에서 %K가 %D를 아래로 뚫는 지점',
    rules: ['%K가 %D를 하향 교차', '교차 시점의 %K, %D 모두 80 이상 (표준 과매수선)', '직전 15거래일 안에 같은 신호가 없었음'],
  },
  'adx-uptrend-start': {
    name: 'ADX 상승추세 발생', lesson: 'adx', bias: 'up',
    summary: '횡보하던 흐름에서 ADX가 25를 넘어서고 +DI가 우위인 지점',
    rules: ['전일 ADX < 25 이고 당일 ADX ≥ 25', '당일 +DI > −DI (상승 방향)', '직전 20거래일 안에 같은 신호가 없었음'],
  },
  'adx-downtrend-start': {
    name: 'ADX 하락추세 발생', lesson: 'adx', bias: 'down',
    summary: 'ADX가 25를 넘어서고 −DI가 우위인 지점',
    rules: ['전일 ADX < 25 이고 당일 ADX ≥ 25', '당일 −DI > +DI (하락 방향)', '직전 20거래일 안에 같은 신호가 없었음'],
  },
  'disparity-overheat': {
    name: '이격도 과열', lesson: 'disparity', bias: 'down',
    summary: '종가가 20일선보다 10% 이상 위로 벌어진 지점',
    rules: ['이격도(종가 ÷ 20일선 × 100) ≥ 110', '직전 20거래일 안에 같은 신호가 없었음'],
  },
  'disparity-oversold': {
    name: '이격도 침체', lesson: 'disparity', bias: 'up',
    summary: '종가가 20일선보다 10% 이상 아래로 벌어진 지점',
    rules: ['이격도 ≤ 90', '직전 20거래일 안에 같은 신호가 없었음'],
  },
  'squeeze-breakout-up': {
    name: '볼린저 스퀴즈 상향 돌파', lesson: 'squeeze', bias: 'up',
    summary: '밴드가 오래 좁아져 있다가 위로 터지는 지점',
    rules: [
      '전일 밴드폭이 최근 120거래일 밴드폭 중 하위 10% 이내',
      '당일 종가가 밴드 상단을 돌파',
      '직전 30거래일 안에 같은 신호가 없었음',
    ],
  },
  'squeeze-breakout-down': {
    name: '볼린저 스퀴즈 하향 이탈', lesson: 'squeeze', bias: 'down',
    summary: '밴드가 오래 좁아져 있다가 아래로 터지는 지점',
    rules: [
      '전일 밴드폭이 최근 120거래일 밴드폭 중 하위 10% 이내',
      '당일 종가가 밴드 하단을 이탈',
      '직전 30거래일 안에 같은 신호가 없었음',
    ],
  },
};

export function detectOscillatorPatterns(stock) {
  const { candles } = stock;
  const c = closes(candles);
  const r = rsi(c, 14);
  const m = macd(c);
  const o = obv(candles);
  const st = stochastic(candles);
  const ax = adx(candles, 14);
  const dis = disparity(c, 20);

  return {
    'rsi-oversold': thresholdCross(stock, r, {
      above: false, level: 30,
      evidence: (i) => [
        { label: 'RSI (14)', value: round(r[i]) },
        { label: '전일 RSI', value: round(r[i - 1]) },
        { label: '당일 종가', value: round(c[i]) },
        { label: '직전 20거래일 등락률(%)', value: round(pct(c[Math.max(0, i - 20)], c[i])) },
      ],
    }),
    'rsi-overbought': thresholdCross(stock, r, {
      above: true, level: 70,
      evidence: (i) => [
        { label: 'RSI (14)', value: round(r[i]) },
        { label: '전일 RSI', value: round(r[i - 1]) },
        { label: '당일 종가', value: round(c[i]) },
        { label: '직전 20거래일 등락률(%)', value: round(pct(c[Math.max(0, i - 20)], c[i])) },
      ],
    }),
    'rsi-bullish-divergence': divergence(stock, r, true, 'RSI'),
    'rsi-bearish-divergence': divergence(stock, r, false, 'RSI'),

    'macd-golden-cross': lineCross(stock, m.line, m.signal, true, {
      guard: (i) => m.line[i] < 0,
      evidence: (i) => [
        { label: 'MACD선', value: round(m.line[i], 4) },
        { label: '시그널선', value: round(m.signal[i], 4) },
        { label: '전일 (MACD − 시그널)', value: round(m.line[i - 1] - m.signal[i - 1], 4) },
        { label: '당일 (MACD − 시그널)', value: round(m.line[i] - m.signal[i], 4) },
        { label: '당일 종가', value: round(c[i]) },
      ],
    }),
    'macd-dead-cross': lineCross(stock, m.line, m.signal, false, {
      guard: (i) => m.line[i] > 0,
      evidence: (i) => [
        { label: 'MACD선', value: round(m.line[i], 4) },
        { label: '시그널선', value: round(m.signal[i], 4) },
        { label: '전일 (MACD − 시그널)', value: round(m.line[i - 1] - m.signal[i - 1], 4) },
        { label: '당일 (MACD − 시그널)', value: round(m.line[i] - m.signal[i], 4) },
        { label: '당일 종가', value: round(c[i]) },
      ],
    }),
    'macd-bullish-divergence': divergence(stock, m.hist, true, 'MACD 히스토그램'),
    'macd-bearish-divergence': divergence(stock, m.hist, false, 'MACD 히스토그램'),

    'obv-bullish-divergence': divergence(stock, o, true, 'OBV'),
    'obv-bearish-divergence': divergence(stock, o, false, 'OBV'),

    'stochastic-oversold-cross': lineCross(stock, st.k, st.d, true, {
      guard: (i) => st.k[i] <= 20 && st.d[i] <= 20,
      evidence: (i) => [
        { label: '%K', value: round(st.k[i]) },
        { label: '%D', value: round(st.d[i]) },
        { label: '전일 %K', value: round(st.k[i - 1]) },
        { label: '전일 %D', value: round(st.d[i - 1]) },
        { label: '당일 종가', value: round(c[i]) },
      ],
    }),
    'stochastic-overbought-cross': lineCross(stock, st.k, st.d, false, {
      guard: (i) => st.k[i] >= 80 && st.d[i] >= 80,
      evidence: (i) => [
        { label: '%K', value: round(st.k[i]) },
        { label: '%D', value: round(st.d[i]) },
        { label: '전일 %K', value: round(st.k[i - 1]) },
        { label: '전일 %D', value: round(st.d[i - 1]) },
        { label: '당일 종가', value: round(c[i]) },
      ],
    }),

    'adx-uptrend-start': thresholdCross(stock, ax.adx, {
      above: true, level: 25,
      evidence: (i) => [
        { label: 'ADX', value: round(ax.adx[i]) },
        { label: '전일 ADX', value: round(ax.adx[i - 1]) },
        { label: '+DI', value: round(ax.plusDI[i]) },
        { label: '−DI', value: round(ax.minusDI[i]) },
        { label: '당일 종가', value: round(c[i]) },
      ],
    }).filter((h) => ax.plusDI[h.index] > ax.minusDI[h.index]),

    'adx-downtrend-start': thresholdCross(stock, ax.adx, {
      above: true, level: 25,
      evidence: (i) => [
        { label: 'ADX', value: round(ax.adx[i]) },
        { label: '전일 ADX', value: round(ax.adx[i - 1]) },
        { label: '+DI', value: round(ax.plusDI[i]) },
        { label: '−DI', value: round(ax.minusDI[i]) },
        { label: '당일 종가', value: round(c[i]) },
      ],
    }).filter((h) => ax.minusDI[h.index] > ax.plusDI[h.index]),

    'disparity-overheat': thresholdCross(stock, dis, {
      above: true, level: 110,
      evidence: (i) => [
        { label: '이격도 (20일)', value: round(dis[i]) },
        { label: '당일 종가', value: round(c[i]) },
        { label: '20일 이동평균', value: round(c[i] / (dis[i] / 100)) },
        { label: '직전 20거래일 등락률(%)', value: round(pct(c[Math.max(0, i - 20)], c[i])) },
      ],
    }),
    'disparity-oversold': thresholdCross(stock, dis, {
      above: false, level: 90,
      evidence: (i) => [
        { label: '이격도 (20일)', value: round(dis[i]) },
        { label: '당일 종가', value: round(c[i]) },
        { label: '20일 이동평균', value: round(c[i] / (dis[i] / 100)) },
        { label: '직전 20거래일 등락률(%)', value: round(pct(c[Math.max(0, i - 20)], c[i])) },
      ],
    }),

    'squeeze-breakout-up': bollingerSqueeze(stock, true),
    'squeeze-breakout-down': bollingerSqueeze(stock, false),
  };
}

export const OSC_PATTERN_IDS = Object.keys(OSC_PATTERNS);
