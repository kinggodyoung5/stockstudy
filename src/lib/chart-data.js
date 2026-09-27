import { candleProblems } from './data-quality.js';
/** 표시 구간과 계산 이력을 분리한다. 끝 날짜 이후 데이터는 계산에 넣지 않는다. */
export function historyThrough(view, history = view) {
  const end = view.at(-1)?.date;
  return end ? history.filter((c) => c.date <= end) : [];
}

export function invalidCandles(candles) {
  return candles.filter((c) => candleProblems(c).length > 0);
}

/** 모든 표시 날짜를 유지해야 가격/보조지표의 논리 시간축이 일치한다. */
export function alignedSeries(view, history, values, extra) {
  const indices = new Map(history.map((c, i) => [c.date, i]));
  return view.map((c) => {
    const i = indices.get(c.date);
    const value = values[i];
    return value == null || !Number.isFinite(value)
      ? { time: c.date }
      : { time: c.date, value, ...(extra ? extra(value, i) : {}) };
  });
}

/** 종가 고점 이후 종가 하락만 사용. 한 봉 안의 고가/저가 선후를 추정하지 않는다. */
export function closeDrawdown(candles) {
  let peak = -Infinity;
  let worst = 0;
  for (const c of candles) {
    if (!Number.isFinite(c.close) || c.close <= 0) continue;
    peak = Math.max(peak, c.close);
    worst = Math.min(worst, (c.close / peak - 1) * 100);
  }
  return worst;
}

/** 종목별 첫 사례 → 종목별 둘째 사례 순으로 만든 뒤 순환한다. */
export function pickCases(hits, count, offset = 0) {
  const buckets = new Map();
  for (const hit of hits) {
    if (!buckets.has(hit.ticker)) buckets.set(hit.ticker, []);
    buckets.get(hit.ticker).push(hit);
  }
  const ordered = [];
  for (let round = 0; ordered.length < hits.length; round++) {
    for (const bucket of buckets.values()) if (bucket[round]) ordered.push(bucket[round]);
  }
  return Array.from({ length: Math.min(count, ordered.length) }, (_, i) =>
    ordered[(offset + i) % ordered.length]);
}
