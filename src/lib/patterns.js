/**
 * 패턴 자동 탐지 엔진 (설명서 5.2)
 *
 * 원칙:
 *  - 판정은 "느낌"이 아니라 아래 PATTERNS.rules 에 적힌 정량 조건문으로만 이루어진다.
 *  - 경계가 애매한 후보는 조건을 엄격하게 잡아 아예 제외한다 (정확한 소수 > 애매한 다수).
 *  - 각 탐지 결과는 evidence(판정 근거 수치)를 그대로 들고 다녀서 역추적이 가능하다.
 */

import { sma, bollinger, ichimoku, cloudBounds, closes, volumes, crossAt, pct } from './indicators.js';

import { OUTCOME_DAYS, outcomeAt, windowRange, round } from './outcome.js';

export { OUTCOME_DAYS };

/**
 * 패턴 정의. rules 배열은 학습 탭에 "판정 기준"으로 그대로 노출된다.
 */
export const PATTERNS = {
  'golden-cross': {
    name: '골든크로스',
    lesson: 'cross',
    bias: 'up',
    summary: '단기 이동평균선이 장기 이동평균선을 아래에서 위로 뚫는 지점',
    rules: [
      '20일 이동평균선이 60일 이동평균선을 아래→위로 교차',
      '교차 이후 5거래일 동안 20일선이 60일선 위를 유지 (되돌림 교차 제외)',
      '교차 직전 20거래일 안에 반대 방향(데드크로스) 교차가 없음',
    ],
  },
  'dead-cross': {
    name: '데드크로스',
    lesson: 'cross',
    bias: 'down',
    summary: '단기 이동평균선이 장기 이동평균선을 위에서 아래로 뚫는 지점',
    rules: [
      '20일 이동평균선이 60일 이동평균선을 위→아래로 교차',
      '교차 이후 5거래일 동안 20일선이 60일선 아래를 유지',
      '교차 직전 20거래일 안에 반대 방향(골든크로스) 교차가 없음',
    ],
  },
  'ma-alignment': {
    name: '이동평균선 정배열 성립',
    lesson: 'moving-average',
    bias: 'up',
    summary: '5일 > 20일 > 60일 순서로 이동평균선이 위에서부터 정렬되는 첫 지점',
    rules: [
      '당일 5일선 > 20일선 > 60일선 (정배열)',
      '전일에는 정배열이 아니었음 (성립 시점만 포착)',
      '성립 이후 10거래일 연속으로 정배열 유지 (하루 스치는 경우 제외)',
    ],
  },
  'bollinger-breakout': {
    name: '볼린저밴드 상단 이탈',
    lesson: 'bollinger-bands',
    bias: 'up',
    summary: '종가가 볼린저밴드 상단 바깥으로 벗어난 지점',
    rules: [
      '종가 > 볼린저밴드 상단 (20일, +2σ)',
      '상단 이탈 폭이 상단선 대비 0.5% 이상 (간신히 걸친 경우 제외)',
      '직전 20거래일 안에 상단 이탈이 없었음 (연속 이탈의 첫날만)',
    ],
  },
  'volume-spike': {
    name: '거래량 급증',
    lesson: 'volume',
    bias: 'none',
    summary: '평소 거래량의 2배 이상이 거래된 날',
    rules: [
      '당일 거래량 ≥ 직전 20거래일 평균 거래량 × 2',
      '당일 등락률의 절대값 ≥ 2% (거래량만 늘고 가격은 그대로인 경우 제외)',
      '직전 10거래일 안에 다른 급증일이 없었음',
    ],
  },
  'cloud-breakout': {
    name: '일목균형표 구름대 상향 돌파',
    lesson: 'ichimoku',
    bias: 'up',
    summary: '주가가 구름대(선행스팬1·2 사이) 위로 올라선 지점',
    rules: [
      '전일 종가 ≤ 전일 구름대 상단 이면서 당일 종가 > 당일 구름대 상단',
      '구름대 두께가 종가 대비 1% 이상 (얇아서 의미 없는 구름 제외)',
      '돌파 이후 3거래일 동안 종가가 구름대 상단 위를 유지',
    ],
  },
};

// ── 개별 탐지기 ───────────────────────────────────────────────────────

function detectCross(stock, direction) {
  const { candles } = stock;
  const c = closes(candles);
  const short = sma(c, 20);
  const long = sma(c, 60);
  const hits = [];

  for (let i = 1; i < candles.length; i++) {
    if (crossAt(short, long, i) !== direction) continue;

    // 조건 2: 교차 후 5거래일 유지
    let held = true;
    for (let k = i; k <= i + 5 && k < candles.length; k++) {
      if (short[k] == null || long[k] == null) { held = false; break; }
      if (direction === 1 ? short[k] <= long[k] : short[k] >= long[k]) { held = false; break; }
    }
    if (!held) continue;

    // 조건 3: 직전 20거래일 내 반대 교차 없음
    let clean = true;
    for (let k = Math.max(1, i - 20); k < i; k++) {
      if (crossAt(short, long, k) === -direction) { clean = false; break; }
    }
    if (!clean) continue;

    hits.push({
      index: i,
      date: candles[i].date,
      evidence: [
        { label: '20일 이동평균', value: round(short[i]) },
        { label: '60일 이동평균', value: round(long[i]) },
        { label: '전일 (20일선 − 60일선)', value: round(short[i - 1] - long[i - 1]) },
        { label: '당일 (20일선 − 60일선)', value: round(short[i] - long[i]) },
      ],
      ...windowRange(candles, i, i),
      outcome: outcomeAt(candles, i),
    });
  }
  return hits;
}

function detectMaAlignment(stock) {
  const { candles } = stock;
  const c = closes(candles);
  const m5 = sma(c, 5);
  const m20 = sma(c, 20);
  const m60 = sma(c, 60);
  const aligned = (i) =>
    m5[i] != null && m20[i] != null && m60[i] != null && m5[i] > m20[i] && m20[i] > m60[i];
  const hits = [];

  for (let i = 1; i < candles.length; i++) {
    if (!aligned(i) || aligned(i - 1)) continue;

    let held = true;
    for (let k = i; k <= i + 10 && k < candles.length; k++) {
      if (!aligned(k)) { held = false; break; }
    }
    if (!held) continue;

    hits.push({
      index: i,
      date: candles[i].date,
      evidence: [
        { label: '5일 이동평균', value: round(m5[i]) },
        { label: '20일 이동평균', value: round(m20[i]) },
        { label: '60일 이동평균', value: round(m60[i]) },
        { label: '5일선 − 60일선 이격률(%)', value: round(pct(m60[i], m5[i])) },
      ],
      ...windowRange(candles, i, i),
      outcome: outcomeAt(candles, i),
    });
  }
  return hits;
}

function detectBollingerBreakout(stock) {
  const { candles } = stock;
  const c = closes(candles);
  const bb = bollinger(c, 20, 2);
  const hits = [];
  let lastOver = -999;

  for (let i = 0; i < candles.length; i++) {
    if (bb.upper[i] == null) continue;
    if (c[i] <= bb.upper[i]) continue;

    const overPct = pct(bb.upper[i], c[i]);
    const isFirst = i - lastOver > 20;
    lastOver = i; // 살짝 걸친 날도 "이탈 중"으로 간주해 연속 판정에 반영

    if (overPct < 0.5) continue;
    if (!isFirst) continue;

    hits.push({
      index: i,
      date: candles[i].date,
      evidence: [
        { label: '종가', value: round(c[i]) },
        { label: '밴드 상단 (20일 +2σ)', value: round(bb.upper[i]) },
        { label: '상단 이탈 폭(%)', value: round(overPct) },
        { label: '밴드폭(%)', value: round(bb.width[i]) },
      ],
      ...windowRange(candles, i, i),
      outcome: outcomeAt(candles, i),
    });
  }
  return hits;
}

function detectVolumeSpike(stock) {
  const { candles } = stock;
  const v = volumes(candles);
  const hits = [];
  let last = -999;

  for (let i = 21; i < candles.length; i++) {
    let avg = 0;
    for (let k = i - 20; k < i; k++) avg += v[k];
    avg /= 20;
    if (avg <= 0) continue;

    const ratio = v[i] / avg;
    if (ratio < 2) continue;   // 2배가 가장 널리 쓰이는 기준

    const chg = pct(candles[i - 1].close, candles[i].close);
    if (Math.abs(chg) < 2) continue;

    const isFirst = i - last > 10;
    last = i;
    if (!isFirst) continue;

    hits.push({
      index: i,
      date: candles[i].date,
      evidence: [
        { label: '당일 거래량', value: v[i] },
        { label: '직전 20일 평균 거래량', value: Math.round(avg) },
        { label: '평균 대비 배수', value: round(ratio) },
        { label: '당일 등락률(%)', value: round(chg) },
      ],
      ...windowRange(candles, i, i),
      outcome: outcomeAt(candles, i),
    });
  }
  return hits;
}

function detectCloudBreakout(stock) {
  const { candles } = stock;
  const ich = ichimoku(candles);
  const cloud = cloudBounds(ich);
  const hits = [];
  let last = -999;

  for (let i = 1; i < candles.length; i++) {
    const top = cloud.top[i];
    const bottom = cloud.bottom[i];
    const prevTop = cloud.top[i - 1];
    if (top == null || bottom == null || prevTop == null) continue;

    const prevClose = candles[i - 1].close;
    const close = candles[i].close;
    if (!(prevClose <= prevTop && close > top)) continue;

    const thickPct = ((top - bottom) / close) * 100;
    if (thickPct < 1) continue;

    let held = true;
    for (let k = i; k <= i + 3 && k < candles.length; k++) {
      if (cloud.top[k] == null || candles[k].close <= cloud.top[k]) { held = false; break; }
    }
    if (!held) continue;

    const isFirst = i - last > 20;
    last = i;
    if (!isFirst) continue;

    hits.push({
      index: i,
      date: candles[i].date,
      evidence: [
        { label: '전일 종가', value: round(prevClose) },
        { label: '당일 종가', value: round(close) },
        { label: '구름대 상단', value: round(top) },
        { label: '구름대 하단', value: round(bottom) },
        { label: '구름 두께 (종가 대비 %)', value: round(thickPct) },
      ],
      ...windowRange(candles, i, i),
      outcome: outcomeAt(candles, i),
    });
  }
  return hits;
}

const DETECTORS = {
  'golden-cross': (s) => detectCross(s, 1),
  'dead-cross': (s) => detectCross(s, -1),
  'ma-alignment': detectMaAlignment,
  'bollinger-breakout': detectBollingerBreakout,
  'volume-spike': detectVolumeSpike,
  'cloud-breakout': detectCloudBreakout,
};

export const PATTERN_IDS = Object.keys(DETECTORS);

/** 한 종목에 모든 규칙을 적용 */
export function detectStock(stock) {
  const out = {};
  for (const [id, fn] of Object.entries(DETECTORS)) {
    out[id] = fn(stock).map((h) => ({
      ticker: stock.ticker,
      name: stock.name,
      market: stock.market,
      currency: stock.currency,
      pattern: id,
      ...h,
    }));
  }
  return out;
}
