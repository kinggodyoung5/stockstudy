/**
 * 캔들스틱 패턴 (1~3봉으로 판정하는 형태)
 *
 * 차트 패턴(patterns.js)이 수십 봉짜리 큰 그림이라면, 이쪽은 하루~사흘짜리 미시 신호다.
 * 판정 원칙은 동일하다 — 전부 정량 조건이고, 근거 수치를 함께 남긴다.
 *
 * 공통으로 쓰는 정의:
 *   몸통(body)   = |종가 − 시가|
 *   전체폭(range) = 고가 − 저가
 *   윗꼬리        = 고가 − max(시가, 종가)
 *   아랫꼬리      = min(시가, 종가) − 저가
 *
 * "장대봉/작은 몸통" 같은 표현은 최근 20봉 평균 몸통과 비교해 상대적으로 판정한다.
 * 그래야 종목·시기에 따라 가격 단위가 달라도 같은 기준이 적용된다.
 */

import { pct } from './indicators.js';
import { outcomeAt, windowRange } from './outcome.js';

const body = (c) => Math.abs(c.close - c.open);
const range = (c) => c.high - c.low;
const upperShadow = (c) => c.high - Math.max(c.open, c.close);
const lowerShadow = (c) => Math.min(c.open, c.close) - c.low;
const isBull = (c) => c.close > c.open;
const isBear = (c) => c.close < c.open;
const bodyTop = (c) => Math.max(c.open, c.close);
const bodyBottom = (c) => Math.min(c.open, c.close);

const round = (v, d = 2) => {
  if (v == null || !Number.isFinite(v)) return null;
  const n = Number(v);
  return +n.toFixed(d === 2 && Math.abs(n) < 10 ? 4 : d);
};

/** 최근 20봉 평균 몸통 — "장대", "작은 몸통"의 기준 */
function avgBody(candles, i, look = 20) {
  const from = Math.max(0, i - look);
  if (i - from < 5) return null;
  let s = 0;
  for (let k = from; k < i; k++) s += body(candles[k]);
  return s / (i - from);
}

/** 직전 추세 — n봉 전 종가 대비 몇 % 인가 */
function priorTrend(candles, i, n = 10) {
  if (i - n < 0) return null;
  return pct(candles[i - n].close, candles[i].close);
}

const DOWNTREND = -3; // 직전 10봉 −3% 이하이면 하락 뒤
const UPTREND = 3;    // +3% 이상이면 상승 뒤

// ── 개별 판정기 ────────────────────────────────────────────────
// 각 판정기는 조건을 만족하면 evidence 배열을, 아니면 null을 돌려준다.

function hammerLike(c, avg) {
  // 아랫꼬리가 길고 윗꼬리가 짧은 형태
  const b = body(c);
  const r = range(c);
  if (r <= 0 || b <= 0) return null;
  if (lowerShadow(c) < b * 2) return null;
  if (upperShadow(c) > b * 0.5) return null;
  if (b / r > 0.35) return null;
  if (avg && b > avg * 1.5) return null; // 몸통이 너무 크면 망치가 아니다
  return { b, r };
}

function invertedHammerLike(c, avg) {
  const b = body(c);
  const r = range(c);
  if (r <= 0 || b <= 0) return null;
  if (upperShadow(c) < b * 2) return null;
  if (lowerShadow(c) > b * 0.5) return null;
  if (b / r > 0.35) return null;
  if (avg && b > avg * 1.5) return null;
  return { b, r };
}

function shadowEvidence(c, extra = []) {
  return [
    { label: '몸통', value: round(body(c)) },
    { label: '전체폭(고가−저가)', value: round(range(c)) },
    { label: '윗꼬리', value: round(upperShadow(c)) },
    { label: '아랫꼬리', value: round(lowerShadow(c)) },
    { label: '아랫꼬리 ÷ 몸통 비율', value: round(body(c) ? lowerShadow(c) / body(c) : null) },
    { label: '윗꼬리 ÷ 몸통 비율', value: round(body(c) ? upperShadow(c) / body(c) : null) },
    ...extra,
  ];
}

const DETECTORS = {
  hammer: (candles, i) => {
    const c = candles[i];
    const avg = avgBody(candles, i);
    const t = priorTrend(candles, i);
    if (t == null || t > DOWNTREND) return null;
    if (!hammerLike(c, avg)) return null;
    return shadowEvidence(c, [{ label: '직전 10거래일 등락률(%)', value: round(t) }]);
  },

  'hanging-man': (candles, i) => {
    const c = candles[i];
    const avg = avgBody(candles, i);
    const t = priorTrend(candles, i);
    if (t == null || t < UPTREND) return null;
    if (!hammerLike(c, avg)) return null;
    return shadowEvidence(c, [{ label: '직전 10거래일 등락률(%)', value: round(t) }]);
  },

  'inverted-hammer': (candles, i) => {
    const c = candles[i];
    const avg = avgBody(candles, i);
    const t = priorTrend(candles, i);
    if (t == null || t > DOWNTREND) return null;
    if (!invertedHammerLike(c, avg)) return null;
    return shadowEvidence(c, [{ label: '직전 10거래일 등락률(%)', value: round(t) }]);
  },

  'shooting-star': (candles, i) => {
    const c = candles[i];
    const avg = avgBody(candles, i);
    const t = priorTrend(candles, i);
    if (t == null || t < UPTREND) return null;
    if (!invertedHammerLike(c, avg)) return null;
    return shadowEvidence(c, [{ label: '직전 10거래일 등락률(%)', value: round(t) }]);
  },

  'bullish-engulfing': (candles, i) => {
    if (i < 1) return null;
    const p = candles[i - 1];
    const c = candles[i];
    const avg = avgBody(candles, i);
    if (!isBear(p) || !isBull(c)) return null;
    if (!(c.close > p.open && c.open < p.close)) return null;      // 전봉 몸통을 완전히 감쌈
    if (avg && body(c) < avg) return null;                          // 감싸는 봉이 평균 이상 크기
    if (body(p) < (avg || 0) * 0.3) return null;                    // 전봉이 너무 작으면 의미 없음
    const t = priorTrend(candles, i);
    if (t == null || t > DOWNTREND) return null;
    return [
      { label: '전봉 (음봉) 시가 → 종가', value: round(p.open) + ' → ' + round(p.close) },
      { label: '당봉 (양봉) 시가 → 종가', value: round(c.open) + ' → ' + round(c.close) },
      { label: '당봉 몸통 ÷ 전봉 몸통', value: round(body(p) ? body(c) / body(p) : null) },
      { label: '당봉 몸통 ÷ 20봉 평균 몸통', value: round(avg ? body(c) / avg : null) },
      { label: '직전 10거래일 등락률(%)', value: round(t) },
    ];
  },

  'bearish-engulfing': (candles, i) => {
    if (i < 1) return null;
    const p = candles[i - 1];
    const c = candles[i];
    const avg = avgBody(candles, i);
    if (!isBull(p) || !isBear(c)) return null;
    if (!(c.open > p.close && c.close < p.open)) return null;
    if (avg && body(c) < avg) return null;
    if (body(p) < (avg || 0) * 0.3) return null;
    const t = priorTrend(candles, i);
    if (t == null || t < UPTREND) return null;
    return [
      { label: '전봉 (양봉) 시가 → 종가', value: round(p.open) + ' → ' + round(p.close) },
      { label: '당봉 (음봉) 시가 → 종가', value: round(c.open) + ' → ' + round(c.close) },
      { label: '당봉 몸통 ÷ 전봉 몸통', value: round(body(p) ? body(c) / body(p) : null) },
      { label: '당봉 몸통 ÷ 20봉 평균 몸통', value: round(avg ? body(c) / avg : null) },
      { label: '직전 10거래일 등락률(%)', value: round(t) },
    ];
  },

  doji: (candles, i) => {
    const c = candles[i];
    const avg = avgBody(candles, i);
    const r = range(c);
    if (r <= 0 || !avg) return null;
    if (body(c) / r > 0.05) return null;      // 몸통이 전체폭의 5% 이하
    if (r < avg * 2) return null;             // 변동이 거의 없는 날은 제외
    return [
      { label: '몸통', value: round(body(c)) },
      { label: '전체폭', value: round(r) },
      { label: '몸통 ÷ 전체폭 비율(%)', value: round((body(c) / r) * 100) },
      { label: '전체폭 ÷ 20봉 평균 몸통', value: round(r / avg) },
      { label: '직전 10거래일 등락률(%)', value: round(priorTrend(candles, i)) },
    ];
  },

  'morning-star': (candles, i) => {
    if (i < 2) return null;
    const [a, b, c] = [candles[i - 2], candles[i - 1], candles[i]];
    const avg = avgBody(candles, i - 2);
    if (!avg) return null;
    if (!isBear(a) || body(a) < avg) return null;                    // 1봉: 큰 음봉
    if (body(b) > body(a) * 0.4) return null;                        // 2봉: 작은 몸통
    if (bodyTop(b) > bodyBottom(a)) return null;                     // 2봉이 1봉 몸통 아래로 이탈
    if (!isBull(c)) return null;                                     // 3봉: 양봉
    const recover = (c.close - bodyBottom(a)) / body(a);
    if (recover < 0.5) return null;                                  // 1봉 몸통의 절반 이상 회복
    return [
      { label: '1봉 (음봉) 몸통', value: round(body(a)) },
      { label: '2봉 몸통 ÷ 1봉 몸통', value: round(body(b) / body(a)) },
      { label: '3봉 (양봉) 종가', value: round(c.close) },
      { label: '1봉 몸통 회복 비율', value: round(recover) },
      { label: '직전 10거래일 등락률(%)', value: round(priorTrend(candles, i - 2)) },
    ];
  },

  'evening-star': (candles, i) => {
    if (i < 2) return null;
    const [a, b, c] = [candles[i - 2], candles[i - 1], candles[i]];
    const avg = avgBody(candles, i - 2);
    if (!avg) return null;
    if (!isBull(a) || body(a) < avg) return null;
    if (body(b) > body(a) * 0.4) return null;
    if (bodyBottom(b) < bodyTop(a)) return null;
    if (!isBear(c)) return null;
    const giveback = (bodyTop(a) - c.close) / body(a);
    if (giveback < 0.5) return null;
    return [
      { label: '1봉 (양봉) 몸통', value: round(body(a)) },
      { label: '2봉 몸통 ÷ 1봉 몸통', value: round(body(b) / body(a)) },
      { label: '3봉 (음봉) 종가', value: round(c.close) },
      { label: '1봉 몸통 반납 비율', value: round(giveback) },
      { label: '직전 10거래일 등락률(%)', value: round(priorTrend(candles, i - 2)) },
    ];
  },

  'bullish-harami': (candles, i) => {
    if (i < 1) return null;
    const p = candles[i - 1];
    const c = candles[i];
    const avg = avgBody(candles, i);
    if (!avg || !isBear(p) || body(p) < avg) return null;
    if (!isBull(c)) return null;
    if (!(bodyTop(c) < bodyTop(p) && bodyBottom(c) > bodyBottom(p))) return null; // 전봉 몸통 안에 완전히 들어감
    const t = priorTrend(candles, i);
    if (t == null || t > DOWNTREND) return null;
    return [
      { label: '전봉 (음봉) 몸통', value: round(body(p)) },
      { label: '당봉 (양봉) 몸통', value: round(body(c)) },
      { label: '당봉 몸통 ÷ 전봉 몸통', value: round(body(c) / body(p)) },
      { label: '직전 10거래일 등락률(%)', value: round(t) },
    ];
  },

  'bearish-harami': (candles, i) => {
    if (i < 1) return null;
    const p = candles[i - 1];
    const c = candles[i];
    const avg = avgBody(candles, i);
    if (!avg || !isBull(p) || body(p) < avg) return null;
    if (!isBear(c)) return null;
    if (!(bodyTop(c) < bodyTop(p) && bodyBottom(c) > bodyBottom(p))) return null;
    const t = priorTrend(candles, i);
    if (t == null || t < UPTREND) return null;
    return [
      { label: '전봉 (양봉) 몸통', value: round(body(p)) },
      { label: '당봉 (음봉) 몸통', value: round(body(c)) },
      { label: '당봉 몸통 ÷ 전봉 몸통', value: round(body(c) / body(p)) },
      { label: '직전 10거래일 등락률(%)', value: round(t) },
    ];
  },

  'three-white-soldiers': (candles, i) => {
    if (i < 2) return null;
    const s = [candles[i - 2], candles[i - 1], candles[i]];
    const avg = avgBody(candles, i - 2);
    if (!avg) return null;
    for (const c of s) {
      if (!isBull(c)) return null;
      if (body(c) < avg * 0.8) return null;
      if (upperShadow(c) > body(c) * 0.5) return null; // 윗꼬리가 길면 매도 압력이 있다는 뜻
    }
    for (let k = 1; k < 3; k++) {
      if (s[k].close <= s[k - 1].close) return null;                  // 종가가 계속 높아짐
      if (s[k].open < bodyBottom(s[k - 1]) || s[k].open > s[k - 1].close) return null; // 전봉 몸통 안에서 출발
    }
    return [
      { label: '3봉 종가', value: s.map((c) => round(c.close)).join(' → ') },
      { label: '3봉 몸통', value: s.map((c) => round(body(c))).join(' / ') },
      { label: '20봉 평균 몸통', value: round(avg) },
      { label: '3봉 합산 등락률(%)', value: round(pct(s[0].open, s[2].close)) },
    ];
  },

  'three-black-crows': (candles, i) => {
    if (i < 2) return null;
    const s = [candles[i - 2], candles[i - 1], candles[i]];
    const avg = avgBody(candles, i - 2);
    if (!avg) return null;
    for (const c of s) {
      if (!isBear(c)) return null;
      if (body(c) < avg * 0.8) return null;
      if (lowerShadow(c) > body(c) * 0.5) return null;
    }
    for (let k = 1; k < 3; k++) {
      if (s[k].close >= s[k - 1].close) return null;
      if (s[k].open > bodyTop(s[k - 1]) || s[k].open < s[k - 1].close) return null;
    }
    return [
      { label: '3봉 종가', value: s.map((c) => round(c.close)).join(' → ') },
      { label: '3봉 몸통', value: s.map((c) => round(body(c))).join(' / ') },
      { label: '20봉 평균 몸통', value: round(avg) },
      { label: '3봉 합산 등락률(%)', value: round(pct(s[0].open, s[2].close)) },
    ];
  },

  marubozu: (candles, i) => {
    const c = candles[i];
    const avg = avgBody(candles, i);
    const r = range(c);
    if (!avg || r <= 0) return null;
    if (body(c) < avg * 2) return null;              // 평균의 2배 이상인 장대봉
    if (body(c) / r < 0.9) return null;              // 꼬리가 거의 없음
    return [
      { label: '방향', value: isBull(c) ? '양봉' : '음봉' },
      { label: '몸통', value: round(body(c)) },
      { label: '몸통 ÷ 전체폭 비율(%)', value: round((body(c) / r) * 100) },
      { label: '몸통 ÷ 20봉 평균 몸통', value: round(body(c) / avg) },
      { label: '당일 등락률(%)', value: round(pct(c.open, c.close)) },
    ];
  },

  'gap-up': (candles, i) => {
    if (i < 1) return null;
    const p = candles[i - 1];
    const c = candles[i];
    if (c.low <= p.high) return null;                                  // 저가가 전봉 고가보다 위 = 갭
    const gap = pct(p.high, c.low);
    if (gap < 1) return null;                                          // 1% 미만 갭은 제외
    return [
      { label: '전봉 고가', value: round(p.high) },
      { label: '당봉 저가', value: round(c.low) },
      { label: '갭 크기(%)', value: round(gap) },
      { label: '당일 등락률(%)', value: round(pct(p.close, c.close)) },
      { label: '당일 거래량', value: c.volume },
    ];
  },

  'gap-down': (candles, i) => {
    if (i < 1) return null;
    const p = candles[i - 1];
    const c = candles[i];
    if (c.high >= p.low) return null;
    const gap = pct(c.high, p.low);
    if (gap < 1) return null;
    return [
      { label: '전봉 저가', value: round(p.low) },
      { label: '당봉 고가', value: round(c.high) },
      { label: '갭 크기(%)', value: round(gap) },
      { label: '당일 등락률(%)', value: round(pct(p.close, c.close)) },
      { label: '당일 거래량', value: c.volume },
    ];
  },
};

/** 패턴 메타데이터 — 학습 탭에 그대로 노출된다 */
export const CANDLE_PATTERNS = {
  hammer: {
    name: '망치형', lesson: 'candlestick-reversal', bars: 1, bias: 'up',
    summary: '하락 뒤에 나타나는, 아래로 긴 꼬리를 단 작은 몸통 캔들',
    rules: [
      '직전 10거래일 등락률이 −3% 이하 (하락 뒤에 나타남)',
      '아랫꼬리 ≥ 몸통 × 2',
      '윗꼬리 ≤ 몸통 × 0.5',
      '몸통이 전체폭의 35% 이하',
      '몸통이 최근 20봉 평균 몸통의 1.5배 이하',
    ],
  },
  'hanging-man': {
    name: '교수형', lesson: 'candlestick-reversal', bars: 1, bias: 'down',
    summary: '망치형과 모양은 같지만 상승 뒤에 나타나는 것',
    rules: [
      '직전 10거래일 등락률이 +3% 이상 (상승 뒤에 나타남)',
      '아랫꼬리 ≥ 몸통 × 2',
      '윗꼬리 ≤ 몸통 × 0.5',
      '몸통이 전체폭의 35% 이하',
    ],
  },
  'inverted-hammer': {
    name: '역망치형', lesson: 'candlestick-reversal', bars: 1, bias: 'up',
    summary: '하락 뒤에 나타나는, 위로 긴 꼬리를 단 작은 몸통 캔들',
    rules: [
      '직전 10거래일 등락률이 −3% 이하',
      '윗꼬리 ≥ 몸통 × 2',
      '아랫꼬리 ≤ 몸통 × 0.5',
      '몸통이 전체폭의 35% 이하',
    ],
  },
  'shooting-star': {
    name: '유성형', lesson: 'candlestick-reversal', bars: 1, bias: 'down',
    summary: '상승 뒤에 나타나는 역망치형. 위로 올렸다가 밀린 자국',
    rules: [
      '직전 10거래일 등락률이 +3% 이상',
      '윗꼬리 ≥ 몸통 × 2',
      '아랫꼬리 ≤ 몸통 × 0.5',
      '몸통이 전체폭의 35% 이하',
    ],
  },
  'bullish-engulfing': {
    name: '상승장악형', lesson: 'candlestick-engulfing', bars: 2, bias: 'up',
    summary: '음봉 다음날 그 몸통을 통째로 덮는 양봉이 나오는 형태',
    rules: [
      '전봉은 음봉, 당봉은 양봉',
      '당봉 종가 > 전봉 시가 이고 당봉 시가 < 전봉 종가 (몸통을 완전히 감쌈)',
      '당봉 몸통 ≥ 최근 20봉 평균 몸통',
      '전봉 몸통 ≥ 평균 몸통 × 0.3 (전봉이 너무 작으면 제외)',
      '직전 10거래일 등락률이 −3% 이하',
    ],
  },
  'bearish-engulfing': {
    name: '하락장악형', lesson: 'candlestick-engulfing', bars: 2, bias: 'down',
    summary: '양봉 다음날 그 몸통을 통째로 덮는 음봉이 나오는 형태',
    rules: [
      '전봉은 양봉, 당봉은 음봉',
      '당봉 시가 > 전봉 종가 이고 당봉 종가 < 전봉 시가',
      '당봉 몸통 ≥ 최근 20봉 평균 몸통',
      '전봉 몸통 ≥ 평균 몸통 × 0.3',
      '직전 10거래일 등락률이 +3% 이상',
    ],
  },
  doji: {
    name: '도지', lesson: 'candlestick-reversal', bars: 1, bias: 'none',
    summary: '시가와 종가가 거의 같은 캔들. 매수·매도가 팽팽했다는 기록',
    rules: [
      '몸통이 전체폭의 5% 이하',
      '전체폭 ≥ 최근 20봉 평균 몸통 × 2 (하루 종일 움직임이 없던 날은 제외)',
    ],
  },
  'morning-star': {
    name: '샛별형', lesson: 'candlestick-star', bars: 3, bias: 'up',
    summary: '큰 음봉 → 작은 몸통 → 큰 양봉으로 이어지는 3봉 반전 형태',
    rules: [
      '1봉: 음봉이면서 몸통 ≥ 최근 20봉 평균 몸통',
      '2봉: 몸통 ≤ 1봉 몸통 × 0.4 (망설임 구간)',
      '2봉의 몸통 상단이 1봉 몸통 하단보다 아래 (아래로 벌어짐)',
      '3봉: 양봉',
      '3봉 종가가 1봉 몸통의 50% 이상을 회복',
    ],
  },
  'evening-star': {
    name: '석별형', lesson: 'candlestick-star', bars: 3, bias: 'down',
    summary: '큰 양봉 → 작은 몸통 → 큰 음봉으로 이어지는 3봉 반전 형태',
    rules: [
      '1봉: 양봉이면서 몸통 ≥ 최근 20봉 평균 몸통',
      '2봉: 몸통 ≤ 1봉 몸통 × 0.4',
      '2봉의 몸통 하단이 1봉 몸통 상단보다 위 (위로 벌어짐)',
      '3봉: 음봉',
      '3봉 종가가 1봉 몸통의 50% 이상을 반납',
    ],
  },
  'bullish-harami': {
    name: '상승하라미', lesson: 'candlestick-engulfing', bars: 2, bias: 'up',
    summary: '큰 음봉 다음에 그 몸통 안에 쏙 들어가는 작은 양봉',
    rules: [
      '전봉: 음봉이면서 몸통 ≥ 최근 20봉 평균 몸통',
      '당봉: 양봉',
      '당봉 몸통이 전봉 몸통 범위 안에 완전히 포함',
      '직전 10거래일 등락률이 −3% 이하',
    ],
  },
  'bearish-harami': {
    name: '하락하라미', lesson: 'candlestick-engulfing', bars: 2, bias: 'down',
    summary: '큰 양봉 다음에 그 몸통 안에 쏙 들어가는 작은 음봉',
    rules: [
      '전봉: 양봉이면서 몸통 ≥ 최근 20봉 평균 몸통',
      '당봉: 음봉',
      '당봉 몸통이 전봉 몸통 범위 안에 완전히 포함',
      '직전 10거래일 등락률이 +3% 이상',
    ],
  },
  'three-white-soldiers': {
    name: '적삼병', lesson: 'candlestick-continuation', bars: 3, bias: 'up',
    summary: '양봉 세 개가 계단처럼 이어지며 종가를 계속 높이는 형태',
    rules: [
      '3봉 모두 양봉',
      '각 봉의 몸통 ≥ 최근 20봉 평균 몸통 × 0.8',
      '각 봉의 윗꼬리 ≤ 몸통 × 0.5 (장중에 밀리지 않았음)',
      '종가가 매일 전봉보다 높음',
      '각 봉의 시가가 전봉 몸통 범위 안에서 출발',
    ],
  },
  'three-black-crows': {
    name: '흑삼병', lesson: 'candlestick-continuation', bars: 3, bias: 'down',
    summary: '음봉 세 개가 계단처럼 이어지며 종가를 계속 낮추는 형태',
    rules: [
      '3봉 모두 음봉',
      '각 봉의 몸통 ≥ 최근 20봉 평균 몸통 × 0.8',
      '각 봉의 아랫꼬리 ≤ 몸통 × 0.5',
      '종가가 매일 전봉보다 낮음',
      '각 봉의 시가가 전봉 몸통 범위 안에서 출발',
    ],
  },
  marubozu: {
    name: '마루보즈 (장대봉)', lesson: 'candlestick-continuation', bars: 1, bias: 'none',
    summary: '꼬리가 거의 없는 큰 몸통 캔들. 하루 종일 한 방향으로만 밀린 날',
    rules: [
      '몸통 ≥ 최근 20봉 평균 몸통 × 2',
      '몸통이 전체폭의 90% 이상 (위아래 꼬리가 거의 없음)',
    ],
  },
  'gap-up': {
    name: '갭 상승', lesson: 'gap', bars: 2, bias: 'up',
    summary: '전날 고가보다 높은 가격에서 시작해 빈 공간이 생긴 형태',
    rules: ['당봉 저가 > 전봉 고가 (구간이 겹치지 않음)', '갭 크기 ≥ 1%'],
  },
  'gap-down': {
    name: '갭 하락', lesson: 'gap', bars: 2, bias: 'down',
    summary: '전날 저가보다 낮은 가격에서 시작해 빈 공간이 생긴 형태',
    rules: ['당봉 고가 < 전봉 저가', '갭 크기 ≥ 1%'],
  },
};

export const CANDLE_IDS = Object.keys(DETECTORS);

/**
 * 한 종목에 모든 캔들 패턴을 적용.
 * patterns.js 의 detectStock 과 같은 형태의 결과를 돌려주므로 학습 탭에서 동일하게 다룰 수 있다.
 */
export function detectCandlePatterns(stock) {
  const { candles } = stock;
  const out = {};

  for (const [id, fn] of Object.entries(DETECTORS)) {
    const meta = CANDLE_PATTERNS[id];
    const hits = [];
    for (let i = 0; i < candles.length; i++) {
      const evidence = fn(candles, i);
      if (!evidence) continue;
      const first = Math.max(0, i - (meta.bars - 1));
      hits.push({
        ticker: stock.ticker,
        name: stock.name,
        market: stock.market,
        currency: stock.currency,
        pattern: id,
        index: i,
        date: candles[i].date,
        evidence,
        highlight: candles.slice(first, i + 1).map((c) => c.date),
        ...windowRange(candles, first, i, 30),
        outcome: outcomeAt(candles, i),
      });
    }
    out[id] = hits;
  }
  return out;
}
