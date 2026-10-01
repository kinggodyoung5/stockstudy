/**
 * 정적 JSON 데이터 로더 (설명서 4.1)
 * 앱 시작 시 전체를 불러오지 않고, 필요한 종목 파일만 그때그때 fetch 한 뒤 메모리에 캐시한다.
 */

import { expandStock } from './data-quality.js';
import { RULES_VERSION } from './rules-version.js';
import { COURSE_VERSION } from './chart-course.js';
const BASE = new URL('../../data/', import.meta.url);

const stockCache = new Map();
const patternCache = new Map();
let indexCache = null;

async function getJson(path) {
  const res = await fetch(new URL(path, BASE));
  if (!res.ok) throw new Error(path + ' 을(를) 불러오지 못했습니다 (HTTP ' + res.status + ')');
  return res.json();
}

/** '^KS11' 같은 지수 심볼은 파일명에서 ^ 를 _ 로 바꿔 저장한다 */
const fileOf = (ticker) => ticker.replace(/\^/g, '_');

/**
 * 저장 형식을 앱이 쓰는 형태로 되돌린다.
 *
 * format 2 는 캔들을 배열로 저장한다 — 키 이름이 캔들마다 반복되지 않아 용량이 절반이다.
 * 종목을 계속 늘릴 계획이라 이 차이가 그대로 저장소 용량이 되기 때문에 이렇게 저장하고,
 * 불러오는 이 시점에서 {date, open, high, low, close, volume} 객체로 펼친다.
 * 그래서 지표·탐지·차트 코드는 형식이 바뀐 걸 알 필요가 없다.
 *
 * format 이 없는 예전 파일(객체 배열)도 그대로 통과시킨다.
 */
const expand = expandStock;

/** 전체 목록 (종목 + 지수) */
export async function loadIndex() {
  if (!indexCache) indexCache = await getJson('stocks/index.json');
  return indexCache;
}

/** 종목만 (지수 제외) — 선택 목록·퀴즈·탐지 대상 */
export async function loadStockList() {
  return (await loadIndex()).filter((r) => (r.type || 'stock') === 'stock');
}

/** 학습·예측 문제는 생성 시 정합성을 통과한 종목만 출제한다. 뷰어 목록은 보존한다. */
export async function loadEligibleStockList() {
  const index = await loadPatternIndex();
  const allowed = new Set(index.eligibleTickers);
  return (await loadStockList()).filter((r) => allowed.has(r.ticker));
}

export function assertSnapshotVersion(payload, index = null) {
  if (payload.provenance?.rulesVersion !== RULES_VERSION
    || (index && (payload.provenance.sourceDigest !== index.provenance.sourceDigest || payload.generatedAt !== index.generatedAt))) {
    throw new Error('규칙과 저장 데이터 버전이 다릅니다. node tools/build-patterns.mjs 로 전부 재생성한 뒤 새로고침하세요.');
  }
}

/** 지수만 — 상대강도 비교 기준 */
export async function loadIndexList() {
  return (await loadIndex()).filter((r) => r.type === 'index');
}

/** 종목 하나의 전체 일봉 */
export async function loadStock(ticker) {
  if (!stockCache.has(ticker)) {
    stockCache.set(ticker, expand(await getJson('stocks/' + fileOf(ticker) + '.json')));
  }
  return stockCache.get(ticker);
}

/** 시장에 맞는 기본 비교 지수 */
export const defaultBenchmark = (market, ticker = '') => (market === 'KR' ? (ticker.endsWith('.KQ') ? '^KQ11' : '^KS11') : '^GSPC');

/** 미리 계산된 패턴 탐지 결과 */
export async function loadPattern(patternId) {
  if (!patternCache.has(patternId)) {
    const index = await loadPatternIndex();
    const payload = await getJson('patterns/' + patternId + '.json');
    assertSnapshotVersion(payload, index);
    patternCache.set(patternId, payload);
  }
  return patternCache.get(patternId);
}

/** 전체 패턴 요약 (건수·승률·평균수익률) — 통계 탭에서 쓴다 */
let patternIndexCache = null;
export async function loadPatternIndex() {
  if (!patternIndexCache) {
    const payload = await getJson('patterns/_index.json');
    assertSnapshotVersion(payload);
    patternIndexCache = payload;
  }
  return patternIndexCache;
}

export async function loadChartCourse() {
  const [course, index] = await Promise.all([getJson('chart-course.json'), loadPatternIndex()]);
  if (course.version !== COURSE_VERSION || course.provenance?.sourceDigest !== index.provenance.sourceDigest
    || course.provenance?.rulesVersion !== RULES_VERSION) throw new Error('입문 교재 버전이 다릅니다. node tools/build-course.mjs 로 재생성하세요.');
  return course;
}

/** 날짜 문자열로 캔들 인덱스 찾기 (없으면 -1) */
export function indexOfDate(candles, date) {
  let lo = 0;
  let hi = candles.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].date === date) return mid;
    if (candles[mid].date < date) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/** 날짜 구간으로 캔들 자르기 (양끝 포함) */
export function sliceByDate(candles, fromDate, toDate) {
  const out = [];
  for (const c of candles) {
    if (fromDate && c.date < fromDate) continue;
    if (toDate && c.date > toDate) continue;
    out.push(c);
  }
  return out;
}
