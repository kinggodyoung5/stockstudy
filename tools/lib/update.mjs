/**
 * 자료 날짜 갱신과 종목 추가 (로드맵 G2). 네트워크를 쓰지 않는 계산만 둔다. 원문 수집은 tools/update-data.mjs 가 한다.
 *
 * 덧붙이기(appendStock):
 *   - 저장된 마지막 날 이후, until 까지의 봉만 더한다. 진행 중일 수 있는 오늘 봉은 until 로 막는다.
 *   - 먼저 겹치는 기존 40봉을 새 응답으로 다시 만들어 저장된 값과 같은지 본다. 다르면 과거 가격이 바뀐 것(분할·권리락 등)이라 멈춘다.
 *   - 국내 종목은 2026-09-23 복구와 같은 recoverStock() 으로 Yahoo·Naver 를 대조한다. 새 구간에 출처 문제가 하나라도 있으면 덧붙이지 않는다.
 *   - 미국 종목·지수는 두 번째 공급자가 없어 Yahoo 하나로 받는다. 겹치는 봉 비교와 봉 정합성 검사만 한다.
 * 종목 추가(newStock):
 *   - 국내: Yahoo 봉을 원본으로 두고 recoverStock() 으로 대조한 결과를 쓴다. 미국: Yahoo 봉을 그대로 쓴다.
 * 덧붙인 내역은 종목 파일의 updates 에 남긴다. stripUpdates() 로 덧붙이기 전 파일을 그대로 되살릴 수 있다.
 */
import { candleProblems, inspectStock, expandStock } from '../../src/lib/data-quality.js';
import { FIELDS, recoverStock } from './recovery.mjs';

export const OVERLAP = 40;
const PRICE = ['open', 'high', 'low', 'close'];

/** 통화와 관계없이 Yahoo chart 응답을 읽는다. 값이 빠진 행은 버린다(휴장일 빈 행). */
export function parseYahooAny(text, ticker) {
  const payload = JSON.parse(text);
  const result = payload.chart?.result?.[0];
  if (payload.chart?.error || result?.meta?.symbol !== ticker || !Array.isArray(result.timestamp)) throw new Error('Yahoo 응답/종목 불일치: ' + ticker);
  const q = result.indicators?.quote?.[0];
  if (!q || [...PRICE, 'volume'].some((k) => !Array.isArray(q[k]) || q[k].length !== result.timestamp.length)) throw new Error('Yahoo 배열 길이 불일치');
  const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: result.meta.exchangeTimezoneName || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' });
  const candles = result.timestamp.map((ts, i) => ({ date: fmt.format(new Date(ts * 1000)), ...Object.fromEntries([...PRICE, 'volume'].map((k) => [k, q[k][i]])) }))
    .filter((c) => PRICE.every((k) => Number.isFinite(c[k])) && Number.isFinite(c.volume));
  const splits = Object.values(result.events?.splits || {}).map((s) => ({ date: fmt.format(new Date(s.date * 1000)), ratio: s.numerator / s.denominator }));
  return { candles, splits, currency: result.meta.currency };
}

/** 저장 자료의 소수 자릿수. 국내는 0, 미국은 fetch-data.ps1 의 규칙(최저가 10 미만 4자리, 100 미만 3자리, 그 외 2자리)과 같다. */
export function digitsFor(market, candles) {
  if (market === 'KR') return 0;
  const min = Math.min(...candles.map((c) => c.low));
  return min < 10 ? 4 : min < 100 ? 3 : 2;
}
/** 저장된 봉에서 실제로 쓰인 자릿수 */
export function digitsOf(candles) {
  let d = 0;
  for (const c of candles) for (const k of PRICE) { const s = String(c[k]); if (s.includes('.')) d = Math.max(d, s.split('.')[1].length); }
  return d;
}
const roundTo = (v, d) => Number(v.toFixed(d));
const roundCandle = (c, d) => ({ date: c.date, ...Object.fromEntries(PRICE.map((k) => [k, roundTo(c[k], d)])), volume: Math.round(c.volume) });

/** 덧붙이기 전 파일. updates 를 지우고 그 앞 봉만 남긴다. JSON 키 순서도 처음과 같다. */
export function stripUpdates(raw) {
  if (!raw.updates?.length) return raw;
  const { updates, ...rest } = raw;
  const baseTo = updates[0].baseTo, i = raw.fields.indexOf('date');
  return { ...rest, candles: rest.candles.filter((row) => row[i] <= baseTo) };
}

const sameRow = (a, b) => FIELDS.every((k) => a[k] === b[k]);
const near = (a, b, d) => Math.abs(a - b) <= Math.max(10 ** -d, Math.abs(a) * 0.0005);

/**
 * base: 펼친 종목(expandStock). yahoo: parseYahooAny 결과. naver: parseNaver 결과(국내 종목만). until: 마지막으로 더할 날.
 * 반환: { status: 'ok' | 'none' | 'stop', reason, added: [봉], detail }
 */
export function appendStock(base, yahoo, naver, until) {
  const last = base.candles.at(-1).date, overlap = base.candles.slice(-OVERLAP), from = overlap[0].date;
  const splits = yahoo.splits.filter((s) => s.date > from);
  if (splits.length) return { status: 'stop', reason: `겹치는 구간 뒤 분할 ${splits.map((s) => s.date).join(', ')}: 과거 가격 전체가 바뀌므로 사람이 판단`, added: [] };
  const ys = yahoo.candles.filter((c) => c.date >= from && c.date <= until);
  if (base.market === 'KR' && base.type === 'stock') {
    const ns = naver.filter((c) => c.date >= from && c.date <= until);
    const original = { ...base, candles: [...overlap, ...ys.filter((c) => c.date > last).map((c) => roundCandle(c, 0))] };
    const r = recoverStock(original, { candles: ys, splits: [] }, ns);
    const got = r.candidate.candles, old = got.filter((c) => c.date <= last), added = got.filter((c) => c.date > last);
    if (old.length !== overlap.length || old.some((c, k) => !sameRow(c, overlap[k]))) {
      const k = old.findIndex((c, j) => !overlap[j] || !sameRow(c, overlap[j]));
      return { status: 'stop', reason: `겹치는 기존 봉이 새 응답과 다름 (${(old[k] || overlap[k] || {}).date || '개수'}). 과거 조정이 바뀌었을 수 있음`, added: [] };
    }
    const concerns = r.afterQuality.sourceConcerns.filter((c) => c.date > last), issues = r.afterQuality.issues.filter((c) => c.date > last);
    if (concerns.length || issues.length) return { status: 'stop', reason: `새 구간 대조 실패: ${[...concerns.map((c) => `${c.date} ${c.reason}`), ...issues.map((c) => `${c.date} ${c.reasons.join('/')}`)].slice(0, 3).join('; ')}`, added: [] };
    return { status: added.length ? 'ok' : 'none', added,
      detail: { corrections: r.corrections.filter((c) => c.date > last).length, nonTradingRemoved: r.removedNonTrading.filter((c) => c.date > last).length } };
  }
  // 미국 종목·지수, 국내 지수: Yahoo 하나
  const d = digitsOf(base.candles), ym = new Map(ys.map((c) => [c.date, roundCandle(c, d)]));
  for (const c of overlap) {
    const y = ym.get(c.date);
    if (!y) return { status: 'stop', reason: `겹치는 기존 봉 ${c.date} 이 새 응답에 없음`, added: [] };
    if (!PRICE.every((k) => near(c[k], y[k], d))) return { status: 'stop', reason: `겹치는 기존 봉 ${c.date} 가격이 새 응답과 다름. 과거 조정이 바뀌었을 수 있음`, added: [] };
  }
  const added = ys.filter((c) => c.date > last).map((c) => roundCandle(c, d));
  const bad = added.filter((c) => candleProblems(c).length || (base.type === 'stock' && c.volume === 0));
  if (bad.length) return { status: 'stop', reason: `새 봉 정합성 오류: ${bad.slice(0, 3).map((c) => c.date).join(', ')}`, added: [] };
  return { status: added.length ? 'ok' : 'none', added, detail: {} };
}

/** 종목 추가. 반환: { stock(펼친 형태), quality, detail } */
export function newStock(meta, yahoo, naver, until) {
  const ys = yahoo.candles.filter((c) => c.date <= until);
  if (!ys.length) throw new Error('자료 없음: ' + meta.ticker);
  if (meta.market === 'KR') {
    const original = { ...meta, candles: ys.map((c) => roundCandle(c, 0)) };
    const r = recoverStock(original, { candles: ys, splits: yahoo.splits }, naver.filter((c) => c.date <= until));
    return { stock: r.candidate, quality: r.afterQuality,
      detail: { corrections: r.corrections.length, nonTradingRemoved: r.removedNonTrading.length, sourceConcerns: r.afterQuality.sourceConcerns.length } };
  }
  const d = digitsFor('US', ys), stock = { ...meta, candles: ys.map((c) => roundCandle(c, d)) };
  return { stock, quality: inspectStock(stock), detail: { digits: d } };
}

/** 저장 형식(format 2) */
export const packStock = (s, extra = {}) => ({ ...s, format: 2, fields: FIELDS, candles: s.candles.map((c) => FIELDS.map((k) => c[k])), ...extra });
export { expandStock };
