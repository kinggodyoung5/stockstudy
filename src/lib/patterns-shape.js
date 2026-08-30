/**
 * 도형(형태) 차트 패턴
 *
 * 수십 봉에 걸쳐 만들어지는 "그림"을 판정한다.
 * 전부 국소 고점·저점(pivots)과 추세선 회귀 위에서 돌아가며,
 * 형태가 만들어진 것만으로는 인정하지 않고 **돌파/이탈이 실제로 일어난 것만** 잡는다.
 * (형태만 보고 판정하면 사후 확증 편향에 빠지기 쉽다)
 */

import { pivots, closes, pct, sma } from './indicators.js';
import { outcomeAt, windowRange, round } from './outcome.js';

// ── 공통 헬퍼 ────────────────────────────────────────────────

/** 최소제곱 직선 적합. r2 로 "정말 직선에 가까운가"를 판정한다. */
function fitLine(points) {
  const n = points.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of points) { sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y; }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  const mean = sy / n;
  let ssTot = 0, ssRes = 0;
  for (const p of points) {
    ssTot += (p.y - mean) ** 2;
    ssRes += (p.y - (slope * p.x + intercept)) ** 2;
  }
  return {
    slope,
    intercept,
    r2: ssTot === 0 ? 1 : 1 - ssRes / ssTot,
    // 적합 오차(RMSE). 추세선이 "정말 선처럼 놓였는가"는 R²가 아니라 이 값으로 본다.
    // 수평선은 설명할 분산 자체가 작아 R²가 구조적으로 낮게 나오므로,
    // R²를 문턱으로 쓰면 상승삼각형·하락삼각형처럼 한쪽이 수평인 형태가 통째로 걸러진다.
    rmse: Math.sqrt(ssRes / n),
    at: (x) => slope * x + intercept,
  };
}

/** 기울기를 가격 대비 "하루당 %"로 정규화해 종목 간 비교가 되게 한다 */
const slopePct = (line, price) => (line.slope / price) * 100;

/** 직전 추세 확인 — n봉 전 대비 등락률 */
function trendBefore(candles, i, n = 40) {
  const j = Math.max(0, i - n);
  return pct(candles[j].close, candles[i].close);
}

/**
 * 스윙 고점·저점을 인정할 좌우 폭.
 *
 * 어떤 날이 고점인지는 뒤로 PIVOT_W 봉이 더 지나야 확정된다. 그래서 넥라인 돌파를
 * 찾을 때도 마지막 어깨(봉우리)가 확정된 뒤부터 봐야 한다. 어깨 바로 다음 날부터
 * 찾으면, 아직 어깨인 줄 몰랐던 시점의 돌파를 신호로 세게 된다.
 */
const PIVOT_W = 5;
const WEDGE_PIVOT_W = 3;   // 삼각수렴·쐐기는 더 촘촘한 피벗을 쓴다

/** 두 점을 잇는 직선을 연장해 특정 인덱스에서의 값 */
const lineAt = (x1, y1, x2, y2, x) => y1 + ((y2 - y1) / (x2 - x1)) * x - ((y2 - y1) / (x2 - x1)) * x1;

// ── 헤드앤숄더 / 역헤드앤숄더 ─────────────────────────────────

function headAndShoulders(stock, inverse) {
  const { candles } = stock;
  const { highs, lows } = pivots(candles, PIVOT_W);
  // 역패턴은 저점 3개와 그 사이 고점 2개를 본다 (부호만 뒤집힌 같은 구조)
  const peaks = inverse ? lows : highs;
  const troughs = inverse ? highs : lows;
  const peakPrice = (i) => (inverse ? candles[i].low : candles[i].high);
  const troughPrice = (i) => (inverse ? candles[i].high : candles[i].low);
  const hits = [];

  for (let a = 0; a + 2 < peaks.length; a++) {
    const iL = peaks[a];
    const iH = peaks[a + 1];
    const iR = peaks[a + 2];
    const L = peakPrice(iL);
    const H = peakPrice(iH);
    const R = peakPrice(iR);

    // 머리가 양 어깨보다 3% 이상 바깥으로 나와 있어야 한다
    const deeper = inverse ? (H < L * 0.97 && H < R * 0.97) : (H > L * 1.03 && H > R * 1.03);
    if (!deeper) continue;
    if (Math.abs(L - R) / Math.max(L, R) > 0.1) continue;

    const t1 = troughs.find((x) => x > iL && x < iH);
    const t2 = troughs.find((x) => x > iH && x < iR);
    if (t1 == null || t2 == null) continue;

    const N1 = troughPrice(t1);
    const N2 = troughPrice(t2);
    if (Math.abs(N1 - N2) / Math.min(N1, N2) > 0.1) continue;

    const symmetry = (iH - iL) / (iR - iH);
    if (symmetry < 0.5 || symmetry > 2.0) continue;

    const span = iR - iL;
    if (span < 20 || span > 120) continue;

    // 넥라인을 연장해 돌파 확인
    // 오른쪽 어깨는 PIVOT_W 봉이 더 지나야 어깨로 확정된다. 그 전 돌파는 알 수 없었다.
    let breakIdx = null;
    for (let k = iR + PIVOT_W; k <= iR + 20 && k < candles.length; k++) {
      const neck = lineAt(t1, N1, t2, N2, k);
      if (inverse ? candles[k].close > neck : candles[k].close < neck) { breakIdx = k; break; }
    }
    if (breakIdx == null) continue;

    const side = inverse ? '저점' : '고점';
    hits.push({
      index: breakIdx,
      date: candles[breakIdx].date,
      evidence: [
        { label: `왼쪽 어깨 ${side}`, value: round(L) + ' (' + candles[iL].date + ')' },
        { label: `머리 ${side}`, value: round(H) + ' (' + candles[iH].date + ')' },
        { label: `오른쪽 어깨 ${side}`, value: round(R) + ' (' + candles[iR].date + ')' },
        { label: '머리 ÷ 어깨 평균 비율', value: round(H / ((L + R) / 2), 3) },
        { label: '두 어깨 높이 차(%)', value: round((Math.abs(L - R) / Math.max(L, R)) * 100) },
        { label: '넥라인 두 지점', value: round(N1) + ' → ' + round(N2) },
        { label: '좌우 대칭 비율', value: round(symmetry) },
        { label: '전체 폭(거래일)', value: span },
        { label: '넥라인 돌파일', value: candles[breakIdx].date },
      ],
      shape: {
        leftShoulder: { date: candles[iL].date, price: round(L) },
        head: { date: candles[iH].date, price: round(H) },
        rightShoulder: { date: candles[iR].date, price: round(R) },
        neckline: [
          { date: candles[t1].date, value: round(N1) },
          { date: candles[t2].date, value: round(N2) },
        ],
        breakout: { date: candles[breakIdx].date, price: round(candles[breakIdx].close) },
      },
      ...windowRange(candles, iL, breakIdx, 20),
      outcome: outcomeAt(candles, breakIdx),
    });
  }
  return hits;
}

// ── 이중/삼중 천장·바닥 ───────────────────────────────────────

function multiTopBottom(stock, count, isTop) {
  const { candles } = stock;
  const { highs, lows } = pivots(candles, PIVOT_W);
  const peaks = isTop ? highs : lows;
  const troughs = isTop ? lows : highs;
  const peakPrice = (i) => (isTop ? candles[i].high : candles[i].low);
  const troughPrice = (i) => (isTop ? candles[i].low : candles[i].high);
  const hits = [];

  for (let a = 0; a + count - 1 < peaks.length; a++) {
    const idx = [];
    for (let k = 0; k < count; k++) idx.push(peaks[a + k]);
    const prices = idx.map(peakPrice);

    // 봉우리(바닥) 높이가 서로 나란해야 한다. 3~5% 이내를 쓰는 자료가 많아 5%로 잡았다.
    const hi = Math.max(...prices);
    const lo = Math.min(...prices);
    if ((hi - lo) / hi > 0.05) continue;

    // 간격 조건
    let okGap = true;
    for (let k = 1; k < count; k++) {
      const gap = idx[k] - idx[k - 1];
      if (gap < 15 || gap > 90) { okGap = false; break; }
    }
    if (!okGap) continue;

    // 사이의 되돌림 골이 충분히 깊어야 (5% 이상) 별개의 봉우리로 인정
    const mids = [];
    for (let k = 1; k < count; k++) {
      const t = troughs.find((x) => x > idx[k - 1] && x < idx[k]);
      if (t == null) { mids.length = 0; break; }
      mids.push(t);
    }
    if (mids.length !== count - 1) continue;

    const midPrices = mids.map(troughPrice);
    const neckline = isTop ? Math.min(...midPrices) : Math.max(...midPrices);
    // 사이 골이 충분히 깊어야 별개의 봉우리다. 통상 10% 이상을 요구한다.
    const depth = Math.abs(pct(neckline, hi));
    if (depth < 10) continue;

    // 직전 추세 (천장은 상승 뒤, 바닥은 하락 뒤에 나와야 반전이다)
    const t0 = trendBefore(candles, idx[0], 40);
    if (isTop ? t0 < 10 : t0 > -10) continue;

    // 넥라인 이탈 확인
    const lastPeak = idx[count - 1];
    // 마지막 봉우리도 PIVOT_W 봉 뒤에야 봉우리로 확정된다
    let breakIdx = null;
    for (let k = lastPeak + PIVOT_W; k <= lastPeak + 30 && k < candles.length; k++) {
      if (isTop ? candles[k].close < neckline : candles[k].close > neckline) { breakIdx = k; break; }
    }
    if (breakIdx == null) continue;

    hits.push({
      index: breakIdx,
      date: candles[breakIdx].date,
      evidence: [
        { label: `${count}개 ${isTop ? '고점' : '저점'}`, value: idx.map((i, k) => round(prices[k]) + '(' + candles[i].date + ')').join(', ') },
        { label: '고점 간 높이 차(%)', value: round(((hi - lo) / hi) * 100) },
        { label: '넥라인', value: round(neckline) },
        { label: '되돌림 깊이(%)', value: round(depth) },
        { label: '직전 40거래일 등락률(%)', value: round(t0) },
        { label: '넥라인 이탈일', value: candles[breakIdx].date },
      ],
      shape: {
        peaks: idx.map((i, k) => ({ date: candles[i].date, price: round(prices[k]) })),
        neckline: [
          { date: candles[idx[0]].date, value: round(neckline) },
          { date: candles[breakIdx].date, value: round(neckline) },
        ],
        breakout: { date: candles[breakIdx].date, price: round(candles[breakIdx].close) },
      },
      ...windowRange(candles, idx[0], breakIdx, 20),
      outcome: outcomeAt(candles, breakIdx),
    });
  }
  return hits;
}

// ── 삼각수렴 / 쐐기 ──────────────────────────────────────────

const WINDOW = 60;      // 형태를 찾을 되돌아볼 구간
const FLAT = 0.05;      // 하루당 ±0.05% 이내면 "수평선"으로 본다
const MAX_FIT_ERR = 3;  // 추세선 적합 오차가 가격의 3% 이내여야 "선"으로 인정
const CONVERGE = 0.75;  // 끝 폭이 시작 폭의 이 비율 이하로 좁아져야 수렴

/**
 * 수렴형 패턴 공통 판정기.
 * i 시점의 돌파를 확인하고, 직전 WINDOW 구간의 고점선/저점선을 적합해 종류를 가른다.
 */
function convergingShapes(stock) {
  const { candles } = stock;
  const { highs, lows } = pivots(candles, WEDGE_PIVOT_W);
  const out = {
    'ascending-triangle': [],
    'descending-triangle': [],
    'symmetric-triangle': [],
    'rising-wedge': [],
    'falling-wedge': [],
  };
  const lastHitAt = {};

  for (let i = WINDOW; i < candles.length; i++) {
    const from = i - WINDOW;
    // i 시점에 이미 확정된 피벗만 쓴다 (x + WEDGE_PIVOT_W 봉까지 봐야 피벗으로 확정되므로)
    const confirmed = (x) => x + WEDGE_PIVOT_W <= i;
    const hp = highs.filter((x) => x >= from && confirmed(x)).map((x) => ({ x, y: candles[x].high }));
    const lp = lows.filter((x) => x >= from && confirmed(x)).map((x) => ({ x, y: candles[x].low }));
    if (hp.length < 3 || lp.length < 3) continue;

    const upper = fitLine(hp);
    const lower = fitLine(lp);
    if (!upper || !lower) continue;

    const price = candles[i - 1].close;
    if ((upper.rmse / price) * 100 > MAX_FIT_ERR) continue;
    if ((lower.rmse / price) * 100 > MAX_FIT_ERR) continue;

    const su = slopePct(upper, price);
    const sl = slopePct(lower, price);

    // 폭이 실제로 좁아지고 있어야 수렴이다
    const widthStart = upper.at(from) - lower.at(from);
    const widthEnd = upper.at(i - 1) - lower.at(i - 1);
    if (widthEnd <= 0 || widthStart <= 0) continue;
    const converging = widthEnd < widthStart * CONVERGE;
    if (!converging) continue;

    // 수렴이 확인된 뒤라 두 선의 기울기 부호만으로 종류가 갈린다
    let id = null;
    if (Math.abs(su) < FLAT && sl > FLAT) id = 'ascending-triangle';
    else if (su < -FLAT && Math.abs(sl) < FLAT) id = 'descending-triangle';
    else if (su < -FLAT && sl > FLAT) id = 'symmetric-triangle';
    else if (su > FLAT && sl > FLAT) id = 'rising-wedge';
    else if (su < -FLAT && sl < -FLAT) id = 'falling-wedge';
    if (!id) continue;

    // 돌파 방향: 상승삼각형·대칭삼각형·하락쐐기는 위로, 하락삼각형·상승쐐기는 아래로 이탈해야 인정
    const up = id === 'ascending-triangle' || id === 'falling-wedge' || (id === 'symmetric-triangle' && candles[i].close > upper.at(i));
    const level = up ? upper.at(i) : lower.at(i);
    const broke = up ? candles[i].close > level * 1.005 : candles[i].close < level * 0.995;
    if (!broke) continue;
    if (id === 'descending-triangle' && up) continue;
    if (id === 'rising-wedge' && up) continue;

    if (lastHitAt[id] != null && i - lastHitAt[id] < 40) continue; // 같은 형태 중복 방지
    lastHitAt[id] = i;

    out[id].push({
      index: i,
      date: candles[i].date,
      evidence: [
        { label: '고점 추세선 기울기(하루당 %)', value: round(su, 3) },
        { label: '저점 추세선 기울기(하루당 %)', value: round(sl, 3) },
        { label: '고점선 적합 오차(가격 대비 %)', value: round((upper.rmse / price) * 100, 2) },
        { label: '저점선 적합 오차(가격 대비 %)', value: round((lower.rmse / price) * 100, 2) },
        { label: '수렴 폭 (시작 → 끝)', value: round(widthStart) + ' → ' + round(widthEnd) },
        { label: '폭 축소 비율', value: round(widthEnd / widthStart) },
        { label: '돌파 방향', value: up ? '상향' : '하향' },
        { label: '돌파 기준선 값', value: round(level) },
        { label: '돌파일 종가', value: round(candles[i].close) },
      ],
      shape: {
        upper: [
          { date: candles[from].date, value: round(upper.at(from)) },
          { date: candles[i].date, value: round(upper.at(i)) },
        ],
        lower: [
          { date: candles[from].date, value: round(lower.at(from)) },
          { date: candles[i].date, value: round(lower.at(i)) },
        ],
        breakout: { date: candles[i].date, price: round(candles[i].close) },
      },
      ...windowRange(candles, from, i, 20),
      outcome: outcomeAt(candles, i),
    });
  }
  return out;
}

// ── 깃발형 (급등/급락 후 눌림 → 재돌파) ────────────────────────

function flags(stock) {
  const { candles } = stock;
  const out = { 'bull-flag': [], 'bear-flag': [] };
  const POLE = 15;        // 깃대 구간
  const FLAG = 15;        // 깃발(눌림) 구간 — 통상 1~3주로 본다
  const MIN_POLE = 12;    // 깃대로 인정할 최소 등락률(%)
  const lastAt = {};

  for (let i = POLE + FLAG; i < candles.length; i++) {
    const flagFrom = i - FLAG;
    const poleFrom = flagFrom - POLE;

    const poleMove = pct(candles[poleFrom].close, candles[flagFrom].close);
    const flagCandles = candles.slice(flagFrom, i);
    const fHigh = Math.max(...flagCandles.map((c) => c.high));
    const fLow = Math.min(...flagCandles.map((c) => c.low));
    const flagWidth = ((fHigh - fLow) / candles[flagFrom].close) * 100;
    const flagMove = pct(candles[flagFrom].close, candles[i - 1].close);

    for (const bull of [true, false]) {
      const id = bull ? 'bull-flag' : 'bear-flag';
      // 깃대: 짧은 기간 강한 한 방향 움직임
      if (bull ? poleMove < MIN_POLE : poleMove > -MIN_POLE) continue;
      // 깃발: 깃대 폭보다 훨씬 좁은 조정, 방향은 살짝 반대이거나 제자리
      if (flagWidth > Math.abs(poleMove) * 0.7) continue;
      if (bull ? (flagMove > 3 || flagMove < -Math.abs(poleMove) * 0.7)
               : (flagMove < -3 || flagMove > Math.abs(poleMove) * 0.7)) continue;
      // 재돌파
      const broke = bull ? candles[i].close > fHigh : candles[i].close < fLow;
      if (!broke) continue;
      if (lastAt[id] != null && i - lastAt[id] < 30) continue;
      lastAt[id] = i;

      out[id].push({
        index: i,
        date: candles[i].date,
        evidence: [
          { label: `깃대 ${POLE}거래일 등락률(%)`, value: round(poleMove) },
          { label: `깃발 ${FLAG}거래일 등락률(%)`, value: round(flagMove) },
          { label: '깃발 구간 고가/저가', value: round(fHigh) + ' / ' + round(fLow) },
          { label: '깃발 폭(%)', value: round(flagWidth) },
          { label: '깃발 폭 ÷ 깃대 크기', value: round(flagWidth / Math.abs(poleMove)) },
          { label: '돌파일 종가', value: round(candles[i].close) },
        ],
        shape: {
          pole: [
            { date: candles[poleFrom].date, value: round(candles[poleFrom].close) },
            { date: candles[flagFrom].date, value: round(candles[flagFrom].close) },
          ],
          upper: [
            { date: candles[flagFrom].date, value: round(fHigh) },
            { date: candles[i].date, value: round(fHigh) },
          ],
          lower: [
            { date: candles[flagFrom].date, value: round(fLow) },
            { date: candles[i].date, value: round(fLow) },
          ],
          breakout: { date: candles[i].date, price: round(candles[i].close) },
        },
        ...windowRange(candles, poleFrom, i, 20),
        outcome: outcomeAt(candles, i),
      });
    }
  }
  return out;
}

// ── 박스권 돌파 ──────────────────────────────────────────────

function rangeBreakout(stock) {
  const { candles } = stock;
  const out = { 'range-breakout-up': [], 'range-breakout-down': [] };
  const BOX = 40;
  const lastAt = {};

  for (let i = BOX; i < candles.length; i++) {
    const box = candles.slice(i - BOX, i);
    const hi = Math.max(...box.map((c) => c.high));
    const lo = Math.min(...box.map((c) => c.low));
    const widthPct = ((hi - lo) / lo) * 100;
    if (widthPct > 12) continue;                        // 박스라 부를 만큼 좁아야 한다

    // 박스 안에서 위아래를 여러 번 오갔는지 (한 방향 추세가 아님)
    const closesInBox = box.map((c) => c.close);
    const upper = lo + (hi - lo) * 0.8;
    const lower = lo + (hi - lo) * 0.2;
    const touchHigh = closesInBox.filter((v) => v >= upper).length;
    const touchLow = closesInBox.filter((v) => v <= lower).length;
    if (touchHigh < 3 || touchLow < 3) continue;

    for (const up of [true, false]) {
      const id = up ? 'range-breakout-up' : 'range-breakout-down';
      const broke = up ? candles[i].close > hi * 1.01 : candles[i].close < lo * 0.99;
      if (!broke) continue;
      if (lastAt[id] != null && i - lastAt[id] < 40) continue;
      lastAt[id] = i;

      out[id].push({
        index: i,
        date: candles[i].date,
        evidence: [
          { label: `박스 ${BOX}거래일 고가`, value: round(hi) },
          { label: '박스 저가', value: round(lo) },
          { label: '박스 폭(%)', value: round(widthPct) },
          { label: '상단권 종가 횟수', value: touchHigh },
          { label: '하단권 종가 횟수', value: touchLow },
          { label: '돌파일 종가', value: round(candles[i].close) },
          { label: '돌파일 거래량 ÷ 박스 평균', value: round(candles[i].volume / (box.reduce((s, c) => s + c.volume, 0) / BOX)) },
        ],
        shape: {
          upper: [{ date: candles[i - BOX].date, value: round(hi) }, { date: candles[i].date, value: round(hi) }],
          lower: [{ date: candles[i - BOX].date, value: round(lo) }, { date: candles[i].date, value: round(lo) }],
          breakout: { date: candles[i].date, price: round(candles[i].close) },
        },
        ...windowRange(candles, i - BOX, i, 20),
        outcome: outcomeAt(candles, i),
      });
    }
  }
  return out;
}

// ── 52주 신고가 / 신저가 ─────────────────────────────────────

function yearExtreme(stock, isHigh) {
  const { candles } = stock;
  const P = 252;
  const hits = [];
  let last = -999;

  for (let i = P; i < candles.length; i++) {
    const prev = candles.slice(i - P, i);
    const ref = isHigh ? Math.max(...prev.map((c) => c.high)) : Math.min(...prev.map((c) => c.low));
    const broke = isHigh ? candles[i].close > ref : candles[i].close < ref;
    if (!broke) continue;
    if (i - last <= 20) { last = i; continue; }   // 연속 갱신은 첫날만
    last = i;

    hits.push({
      index: i,
      date: candles[i].date,
      evidence: [
        { label: '당일 종가', value: round(candles[i].close) },
        { label: `직전 52주 ${isHigh ? '최고가' : '최저가'}`, value: round(ref) },
        { label: '돌파 폭(%)', value: round(Math.abs(pct(ref, candles[i].close))) },
        { label: '당일 거래량', value: candles[i].volume },
        { label: '직전 40거래일 등락률(%)', value: round(trendBefore(candles, i, 40)) },
      ],
      ...windowRange(candles, Math.max(0, i - 120), i, 20),
      outcome: outcomeAt(candles, i),
    });
  }
  return hits;
}

// ── 메타데이터 ──────────────────────────────────────────────

export const SHAPE_PATTERNS = {
  'head-and-shoulders': {
    name: '헤드앤숄더', lesson: 'head-and-shoulders', bias: 'down',
    summary: '왼쪽 어깨 - 머리 - 오른쪽 어깨 형태의 세 고점이 만들어진 뒤 넥라인이 무너지는 형태',
    rules: [
      '연속된 세 고점이 왼쪽어깨 < 머리 > 오른쪽어깨 (고점은 좌우 5봉보다 높은 국소 고점)',
      '머리가 양 어깨보다 각각 3% 이상 높음',
      '두 어깨의 높이 차이가 10% 이내',
      '두 저점(넥라인)의 높이 차이가 10% 이내 — 넥라인이 완만함',
      '머리~왼쪽어깨 간격과 머리~오른쪽어깨 간격의 비율이 0.5 ~ 2.0 (좌우 대칭)',
      '전체 폭 20 ~ 120 거래일',
      '오른쪽 어깨 이후 20거래일 안에 종가가 넥라인 아래로 이탈',
    ],
  },
  'inverse-head-and-shoulders': {
    name: '역헤드앤숄더', lesson: 'head-and-shoulders', bias: 'up',
    summary: '헤드앤숄더를 위아래로 뒤집은 형태. 저점 세 개 뒤 넥라인을 위로 뚫는다',
    rules: [
      '연속된 세 저점이 왼쪽어깨 > 머리 < 오른쪽어깨',
      '머리가 양 어깨보다 각각 3% 이상 낮음',
      '두 어깨의 깊이 차이가 10% 이내',
      '두 고점(넥라인)의 높이 차이가 10% 이내',
      '좌우 대칭 비율 0.5 ~ 2.0',
      '전체 폭 20 ~ 120 거래일',
      '오른쪽 어깨 이후 20거래일 안에 종가가 넥라인 위로 돌파',
    ],
  },
  'double-top': {
    name: '이중천장', lesson: 'double-patterns', bias: 'down',
    summary: '거의 같은 높이의 고점 두 개를 만든 뒤 사이 저점을 무너뜨리는 형태',
    rules: [
      '국소 고점 2개의 높이 차이가 5% 이내',
      '두 고점 사이 간격이 15 ~ 90 거래일',
      '두 고점 사이 저점(넥라인)이 고점 대비 10% 이상 아래',
      '패턴 시작 전 40거래일 등락률 +10% 이상 (상승 뒤에 나와야 반전)',
      '두 번째 고점 이후 30거래일 안에 종가가 넥라인 아래로 이탈',
    ],
  },
  'double-bottom': {
    name: '이중바닥', lesson: 'double-patterns', bias: 'up',
    summary: '거의 같은 깊이의 저점 두 개를 만든 뒤 사이 고점을 뚫는 형태',
    rules: [
      '국소 저점 2개의 깊이 차이가 5% 이내',
      '두 저점 사이 간격이 15 ~ 90 거래일',
      '두 저점 사이 고점(넥라인)이 저점 대비 10% 이상 위',
      '패턴 시작 전 40거래일 등락률 −10% 이하',
      '두 번째 저점 이후 30거래일 안에 종가가 넥라인 위로 돌파',
    ],
  },
  'triple-top': {
    name: '삼중천장', lesson: 'double-patterns', bias: 'down',
    summary: '이중천장에서 봉우리가 하나 더 늘어난 형태',
    rules: [
      '국소 고점 3개의 높이 차이가 5% 이내',
      '각 고점 사이 간격이 15 ~ 90 거래일',
      '가장 낮은 중간 저점을 넥라인으로 삼고, 고점 대비 10% 이상 아래',
      '패턴 시작 전 40거래일 등락률 +10% 이상',
      '마지막 고점 이후 30거래일 안에 넥라인 하향 이탈',
    ],
  },
  'triple-bottom': {
    name: '삼중바닥', lesson: 'double-patterns', bias: 'up',
    summary: '이중바닥에서 바닥이 하나 더 늘어난 형태',
    rules: [
      '국소 저점 3개의 깊이 차이가 5% 이내',
      '각 저점 사이 간격이 15 ~ 90 거래일',
      '가장 높은 중간 고점을 넥라인으로 삼고, 저점 대비 10% 이상 위',
      '패턴 시작 전 40거래일 등락률 −10% 이하',
      '마지막 저점 이후 30거래일 안에 넥라인 상향 돌파',
    ],
  },
  'ascending-triangle': {
    name: '상승 삼각수렴', lesson: 'triangle', bias: 'up',
    summary: '고점은 수평인데 저점이 계속 높아지며 위쪽 저항선을 압박하는 형태',
    rules: [
      '직전 60거래일 안에 국소 고점 3개 이상, 국소 저점 3개 이상',
      '고점 추세선 기울기가 하루당 ±0.05% 이내 (수평)',
      '저점 추세선 기울기가 하루당 +0.05% 초과 (우상향)',
      '두 추세선의 적합 오차가 가격의 3% 이내 (점들이 실제로 선 위에 놓여 있음)',
      '구간 끝의 폭이 시작 폭의 75% 이하 (실제로 좁아지는 중)',
      '종가가 고점 추세선을 0.5% 이상 상향 돌파',
    ],
  },
  'descending-triangle': {
    name: '하락 삼각수렴', lesson: 'triangle', bias: 'down',
    summary: '저점은 수평인데 고점이 계속 낮아지며 아래쪽 지지선을 압박하는 형태',
    rules: [
      '직전 60거래일 안에 국소 고점 3개 이상, 국소 저점 3개 이상',
      '고점 추세선 기울기가 하루당 −0.05% 미만 (우하향)',
      '저점 추세선 기울기가 하루당 ±0.05% 이내 (수평)',
      '두 추세선의 적합 오차가 가격의 3% 이내 (점들이 실제로 선 위에 놓여 있음)',
      '구간 끝의 폭이 시작 폭의 75% 이하',
      '종가가 저점 추세선을 0.5% 이상 하향 이탈',
    ],
  },
  'symmetric-triangle': {
    name: '대칭 삼각수렴', lesson: 'triangle', bias: 'none',
    summary: '고점은 낮아지고 저점은 높아지며 한 점으로 모이는 형태. 방향은 돌파가 결정한다',
    rules: [
      '직전 60거래일 안에 국소 고점 3개 이상, 국소 저점 3개 이상',
      '고점 추세선은 우하향, 저점 추세선은 우상향',
      '두 추세선의 적합 오차가 가격의 3% 이내 (점들이 실제로 선 위에 놓여 있음)',
      '구간 끝의 폭이 시작 폭의 75% 이하',
      '종가가 두 선 중 한쪽을 0.5% 이상 벗어남',
    ],
  },
  'rising-wedge': {
    name: '상승 쐐기', lesson: 'triangle', bias: 'down',
    summary: '고점·저점이 모두 오르지만 저점이 더 가파르게 올라 좁아지는 형태. 상승 중에 힘이 빠지는 신호로 본다',
    rules: [
      '고점·저점 추세선 기울기가 모두 하루당 +0.05% 초과',
      '폭이 실제로 좁아지는 중 (저점선이 고점선보다 가파르게 상승)',
      '두 추세선의 적합 오차가 가격의 3% 이내 (점들이 실제로 선 위에 놓여 있음)',
      '구간 끝의 폭이 시작 폭의 75% 이하',
      '종가가 저점 추세선을 0.5% 이상 하향 이탈',
    ],
  },
  'falling-wedge': {
    name: '하락 쐐기', lesson: 'triangle', bias: 'up',
    summary: '고점·저점이 모두 내리지만 고점이 더 가파르게 내려 좁아지는 형태',
    rules: [
      '고점·저점 추세선 기울기가 모두 하루당 −0.05% 미만',
      '폭이 실제로 좁아지는 중 (고점선이 저점선보다 가파르게 하락)',
      '두 추세선의 적합 오차가 가격의 3% 이내 (점들이 실제로 선 위에 놓여 있음)',
      '구간 끝의 폭이 시작 폭의 75% 이하',
      '종가가 고점 추세선을 0.5% 이상 상향 돌파',
    ],
  },
  'bull-flag': {
    name: '상승 깃발형', lesson: 'flag', bias: 'up',
    summary: '짧고 강한 급등(깃대) 뒤 좁게 눌린 구간(깃발)이 이어지다 다시 위로 뚫는 형태',
    rules: [
      '깃대: 직전 15거래일 등락률 +12% 이상',
      '깃발: 이어지는 15거래일(약 3주)의 고저 폭이 깃대 크기의 70% 이하',
      '깃발 구간 등락률이 +3% 이하 (쉬어가는 구간)이면서 깃대의 70% 넘게 반납하지 않음',
      '종가가 깃발 구간 고가를 상향 돌파',
    ],
  },
  'bear-flag': {
    name: '하락 깃발형', lesson: 'flag', bias: 'down',
    summary: '짧고 강한 급락 뒤 좁은 반등이 이어지다 다시 아래로 무너지는 형태',
    rules: [
      '깃대: 직전 15거래일 등락률 −12% 이하',
      '깃발: 이어지는 15거래일(약 3주)의 고저 폭이 깃대 크기의 70% 이하',
      '깃발 구간 등락률이 −3% 이상이면서 깃대의 70% 넘게 회복하지 않음',
      '종가가 깃발 구간 저가를 하향 이탈',
    ],
  },
  'range-breakout-up': {
    name: '박스권 상향 돌파', lesson: 'range', bias: 'up',
    summary: '오래 눌려 있던 좁은 가격대를 위로 벗어나는 지점',
    rules: [
      '직전 40거래일의 고저 폭이 12% 이내 (박스라 부를 만큼 좁음)',
      '박스 상단권(위 20%)에서 마감한 날이 3일 이상, 하단권에서도 3일 이상 (한 방향 추세가 아님)',
      '종가가 박스 고가를 1% 이상 상향 돌파',
    ],
  },
  'range-breakout-down': {
    name: '박스권 하향 이탈', lesson: 'range', bias: 'down',
    summary: '오래 눌려 있던 좁은 가격대를 아래로 벗어나는 지점',
    rules: [
      '직전 40거래일의 고저 폭이 12% 이내',
      '박스 상단권에서 마감한 날이 3일 이상, 하단권에서도 3일 이상',
      '종가가 박스 저가를 1% 이상 하향 이탈',
    ],
  },
  '52w-high': {
    name: '52주 신고가', lesson: 'extremes', bias: 'up',
    summary: '직전 1년 동안의 최고가를 넘어선 날',
    rules: [
      '종가 > 직전 252거래일(약 1년)의 최고가',
      '직전 20거래일 안에 다른 신고가 갱신이 없었음 (연속 갱신의 첫날만)',
    ],
  },
  '52w-low': {
    name: '52주 신저가', lesson: 'extremes', bias: 'down',
    summary: '직전 1년 동안의 최저가를 밑돈 날',
    rules: [
      '종가 < 직전 252거래일의 최저가',
      '직전 20거래일 안에 다른 신저가 갱신이 없었음',
    ],
  },
};

/** 여러 결과를 한 번에 만드는 탐지기들은 미리 계산해 나눠 담는다 */
export function detectShapePatterns(stock) {
  const conv = convergingShapes(stock);
  const flg = flags(stock);
  const rng = rangeBreakout(stock);

  return {
    'head-and-shoulders': headAndShoulders(stock, false),
    'inverse-head-and-shoulders': headAndShoulders(stock, true),
    'double-top': multiTopBottom(stock, 2, true),
    'double-bottom': multiTopBottom(stock, 2, false),
    'triple-top': multiTopBottom(stock, 3, true),
    'triple-bottom': multiTopBottom(stock, 3, false),
    ...conv,
    ...flg,
    ...rng,
    '52w-high': yearExtreme(stock, true),
    '52w-low': yearExtreme(stock, false),
  };
}

export const SHAPE_IDS = Object.keys(SHAPE_PATTERNS);
