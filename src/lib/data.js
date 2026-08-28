/**
 * 정적 JSON 데이터 로더 (설명서 4.1)
 * 앱 시작 시 전체를 불러오지 않고, 필요한 종목 파일만 그때그때 fetch 한 뒤 메모리에 캐시한다.
 */

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

/** 전체 목록 (종목 + 지수) */
export async function loadIndex() {
  if (!indexCache) indexCache = await getJson('stocks/index.json');
  return indexCache;
}

/** 종목만 (지수 제외) — 선택 목록·퀴즈·탐지 대상 */
export async function loadStockList() {
  return (await loadIndex()).filter((r) => (r.type || 'stock') === 'stock');
}

/** 지수만 — 상대강도 비교 기준 */
export async function loadIndexList() {
  return (await loadIndex()).filter((r) => r.type === 'index');
}

/** 종목 하나의 전체 일봉 */
export async function loadStock(ticker) {
  if (!stockCache.has(ticker)) {
    stockCache.set(ticker, await getJson('stocks/' + fileOf(ticker) + '.json'));
  }
  return stockCache.get(ticker);
}

/** 시장에 맞는 기본 비교 지수 */
export const defaultBenchmark = (market) => (market === 'KR' ? '^KS11' : '^GSPC');

/** 미리 계산된 패턴 탐지 결과 */
export async function loadPattern(patternId) {
  if (!patternCache.has(patternId)) {
    patternCache.set(patternId, await getJson('patterns/' + patternId + '.json'));
  }
  return patternCache.get(patternId);
}

/** 전체 패턴 요약 (건수·승률·평균수익률) — 통계 탭에서 쓴다 */
let patternIndexCache = null;
export async function loadPatternIndex() {
  if (!patternIndexCache) patternIndexCache = await getJson('patterns/_index.json');
  return patternIndexCache;
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
