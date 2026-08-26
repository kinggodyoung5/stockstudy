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

/** 종목 목록 */
export async function loadIndex() {
  if (!indexCache) indexCache = await getJson('stocks/index.json');
  return indexCache;
}

/** 종목 하나의 전체 일봉 */
export async function loadStock(ticker) {
  if (!stockCache.has(ticker)) {
    stockCache.set(ticker, await getJson('stocks/' + ticker + '.json'));
  }
  return stockCache.get(ticker);
}

/** 미리 계산된 패턴 탐지 결과 */
export async function loadPattern(patternId) {
  if (!patternCache.has(patternId)) {
    patternCache.set(patternId, await getJson('patterns/' + patternId + '.json'));
  }
  return patternCache.get(patternId);
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
