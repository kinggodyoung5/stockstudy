import { detectStock, ALL_PATTERNS, ALL_PATTERN_IDS, groupOf } from './engine.js';
import { inspectStock, QUALITY_POLICY } from './data-quality.js';
import { OUTCOME_DAYS } from './outcome.js';
import { summarize, baseline, baselineBy, profileOf, assignBuckets, periodAxis, AXES } from './stats.js';
import { atrPercent } from './oscillators.js';

import { RULES_VERSION } from './rules-version.js';
export { RULES_VERSION };
const order = (a, b) => a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker);

export function sampleHits(hits, max = 150) {
  const sorted = [...hits].sort(order);
  if (sorted.length <= max) return sorted;
  const groups = new Map();
  for (const h of sorted) {
    if (!groups.has(h.ticker)) groups.set(h.ticker, []);
    groups.get(h.ticker).push(h);
  }
  const buckets = [...groups.values()];
  const quota = buckets.map(() => 0);
  for (let remaining = max; remaining > 0;) {
    for (let i = 0; i < buckets.length && remaining > 0; i++) {
      if (quota[i] < buckets[i].length) { quota[i]++; remaining--; }
    }
  }
  return buckets.flatMap((b, i) => Array.from({ length: quota[i] }, (_, k) =>
    b[Math.floor((k + 0.5) * b.length / quota[i])])).sort(order);
}

export function observationCounts(hits) {
  const complete = hits.filter((h) => h.outcome?.days === OUTCOME_DAYS && Number.isFinite(h.outcome.changePct)).length;
  const partial = hits.filter((h) => h.outcome && h.outcome.days < OUTCOME_DAYS).length;
  return { complete, partial, pending: hits.length - complete - partial };
}

/** 원자료 불변, 검출과 기준선의 모집단 동일. DOM/파일시스템과 분리된 단일 생성 경로. */
export function buildSnapshot(stocks, { generatedAt, sourceDigest, sourceManifest, onProgress = () => {} }) {
  const reports = stocks.map(inspectStock);
  const eligible = stocks.filter((_, i) => reports[i].eligible);
  if (!eligible.length) throw new Error('정합성 검사를 통과한 종목이 없습니다. 기존 결과를 덮어쓰지 않습니다.');
  const quality = { policy: QUALITY_POLICY, totalStocks: stocks.length, eligibleStocks: eligible.length,
    quarantinedStocks: stocks.length - eligible.length,
    invalidCandles: reports.reduce((n, r) => n + r.issues.length, 0),
    sourceConcerns: reports.reduce((n, r) => n + r.sourceConcerns.length, 0),
    recovery: { stocks: stocks.filter((s) => s.provenance?.recoveryRun).length,
      corrections: stocks.reduce((n, s) => n + (s.provenance?.corrections || 0), 0),
      nonTradingRemoved: stocks.reduce((n, s) => n + (s.provenance?.nonTradingRemoved || 0), 0) },
    excludedTickers: reports.filter((r) => !r.eligible).map((r) => r.ticker),
    note: '정합성 오류 또는 미해결 출처·결측 문제가 있는 종목은 전체 이력을 사례·집계·기준선에서 제외합니다. 복구 전 원본과 공급자 응답은 보존합니다. 검사 통과는 가격·조정 방식의 정확성 인증이 아니며 제외로 표본 구성 편향이 생길 수 있습니다.' };
  const provenance = { rulesVersion: RULES_VERSION, sourceDigest, qualityPolicy: QUALITY_POLICY,
    outcomePolicy: 'complete-20-bars-only', profilePolicy: 'latest-252-bars-descriptive-not-point-in-time',
    sourceAdjustment: 'Yahoo quote OHLCV 기준. 복구 이력이 있는 국내 종목은 보존된 Yahoo/Naver 응답과 주변 조정 단위를 대조했다. 개별 복구 근거는 종목 provenance 및 data/recovery 보고서 참조. 전체 가격·기업행동·거래일 완전성 인증은 아니며 미국 종목·비교 지수는 이번 교차 대조 대상이 아니다.' };
  const merged = Object.fromEntries(ALL_PATTERN_IDS.map((id) => [id, []]));
  for (const s of eligible) {
    const found = detectStock(s);
    for (const id of ALL_PATTERN_IDS) merged[id].push(...found[id]);
    onProgress(s.ticker);
  }
  const base = baseline(eligible, OUTCOME_DAYS);
  const profiles = assignBuckets(eligible.map((s) => profileOf(s, atrPercent(s.candles, 14))));
  const profileMap = new Map(profiles.map((p) => [p.ticker, p]));
  const years = new Set(eligible.flatMap((s) => s.candles.map((c) => c.date.slice(0, 4))));
  const axes = { ...AXES, period: periodAxis(years) };
  const axisBaselines = {};
  for (const [axis, def] of Object.entries(axes)) {
    axisBaselines[axis] = def.byDate
      ? baselineBy(eligible, OUTCOME_DAYS, (c) => c.date.slice(0, 4))
      : Object.fromEntries(def.keys.map((key) => [key,
        baseline(eligible.filter((s) => profileMap.get(s.ticker)[axis] === key), OUTCOME_DAYS)]));
  }
  const payloads = {};
  for (const id of ALL_PATTERN_IDS) {
    const meta = ALL_PATTERNS[id];
    const hits = merged[id].sort(order);
    const stats = summarize(hits);
    const byAxis = {};
    for (const [axis, def] of Object.entries(axes)) {
      byAxis[axis] = Object.fromEntries(def.keys.map((key) => {
        // 연도는 신호일이 아니라 성과 측정 시작일 기준. 연말 확인 지연에 유의.
        const sub = hits.filter((h) => (def.byDate ? (h.outcome?.fromDate || h.confirmDate || h.date).slice(0, 4) : profileMap.get(h.ticker)[axis]) === key);
        return [key, sub.length ? { count: sub.length, observation: observationCounts(sub), stats: summarize(sub) } : null];
      }));
    }
    const kept = sampleHits(hits);
    payloads[id] = { pattern: id, name: meta.name, lesson: meta.lesson, group: groupOf(id), bias: meta.bias || 'none',
      summary: meta.summary, rules: meta.rules, confirm: meta.confirm || null,
      outcomeDays: OUTCOME_DAYS, baseline: base, generatedAt, provenance, quality,
      count: hits.length, observation: observationCounts(hits), sampled: kept.length < hits.length, stats, byAxis, hits: kept };
  }
  const patterns = Object.values(payloads).map(({ hits, rules, confirm, baseline, outcomeDays, generatedAt, provenance, quality, sampled, ...row }) => row);
  const index = { generatedAt, provenance, quality, outcomeDays: OUTCOME_DAYS,
    tickers: eligible.length, tickerNames: eligible.map((s) => s.name), eligibleTickers: eligible.map((s) => s.ticker),
    from: eligible.map((s) => s.candles[0].date).sort()[0], to: eligible.map((s) => s.candles.at(-1).date).sort().at(-1),
    totalHits: patterns.reduce((n, r) => n + r.count, 0), baseline: base, axes, axisBaselines, profiles, patterns };
  return { payloads, index, qualityReport: { generatedAt, provenance, ...quality, sourceManifest, stocks: reports } };
}
