import { candleProblems, inspectStock } from '../../src/lib/data-quality.js';

/**
 * v3 (2026-11-18): v2 가 단위 검증에 실패한 날에만 두 가지를 더 본다. v2 로 정해지는 날의 결과는 바뀌지 않는다.
 *   1. 거래량 배율을 Yahoo 분할 기록이 아니라 주변 일치 봉의 거래량 비율로 확인한다(비율이 0.1% 안에서 안정적일 때만).
 *      Naver 가 유상증자·주식배당 등으로 가격과 거래량을 함께 조정했지만 Yahoo 분할 기록에는 없는 경우다.
 *   2. 두 공급자가 모두 거래량 0이고 Naver 의 네 가격이 같은 봉은 거래정지로 보고 계산용 이력에서 뺀다.
 */
export const RECOVERY_POLICY = 'dual-source-local-scale-v3';
// 금융위원회 공지로 확인한 임시 휴장일. Naver 행 부재만으로 휴장일을 추정하지 않는다.
const CLOSED_SESSIONS = new Map([['2015-08-14', 'https://www.korea.kr/news/policyNewsView.do?newsId=148799089']]);
const PRICE = ['open', 'high', 'low', 'close'];
export const FIELDS = ['date', ...PRICE, 'volume'];
const median = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : null; };
// 공급자 정수 반올림/절삭 차이 허용. 가격을 이 경계로 클램핑하지 않는다.
const priceNear = (a, b) => Math.abs(a - b) <= Math.max(2, Math.abs(a) * 0.0001);
const volumeNear = (a, b) => Math.abs(a - b) <= Math.max(2, Math.abs(a) * 0.001);
const positive = (v) => Number.isFinite(v) && v > 0;

export function parseNaver(text) {
  // 실행(eval)하지 않는다. 응답은 작은따옴표 헤더를 가진 배열 리터럴이다.
  const rows = JSON.parse(text.replaceAll("'", '"'));
  if (!Array.isArray(rows) || JSON.stringify(rows[0]?.slice(0, 6)) !== JSON.stringify(['날짜', '시가', '고가', '저가', '종가', '거래량'])) throw new Error('Naver 응답 필드 불일치');
  return rows.slice(1).map((r) => {
    if (!Array.isArray(r) || r.length < 6 || !/^\d{8}$/.test(r[0])) throw new Error('Naver 행 형식 오류');
    return { date: `${r[0].slice(0, 4)}-${r[0].slice(4, 6)}-${r[0].slice(6)}`, open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] };
  });
}

export function parseYahoo(text, ticker) {
  const payload = JSON.parse(text);
  const result = payload.chart?.result?.[0];
  if (payload.chart?.error || result?.meta?.symbol !== ticker || !Array.isArray(result.timestamp)) throw new Error('Yahoo 응답/종목 불일치');
  const q = result.indicators?.quote?.[0];
  if (!q || [...PRICE, 'volume'].some((k) => !Array.isArray(q[k]) || q[k].length !== result.timestamp.length)) throw new Error('Yahoo 배열 길이 불일치');
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: result.meta.exchangeTimezoneName || 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
  const candles = result.timestamp.map((ts, i) => ({ date: date.format(new Date(ts * 1000)), ...Object.fromEntries([...PRICE, 'volume'].map((k) => [k, q[k][i]])) }));
  const splits = Object.values(result.events?.splits || {}).map((s) => {
    if (!positive(s.numerator) || !positive(s.denominator)) throw new Error('분할 비율 오류');
    return { date: date.format(new Date(s.date * 1000)), ratio: s.numerator / s.denominator };
  });
  if (result.meta.currency !== 'KRW') throw new Error('국내 원화 자료만 복구 가능');
  return { candles, splits, currency: result.meta.currency };
}

export function splitVolumeFactor(splits, date) {
  return splits.filter((s) => s.date > date).reduce((a, s) => a * s.ratio, 1);
}

function uniqueMap(cs) {
  const map = new Map();
  for (const c of cs) {
    if (map.has(c.date)) throw new Error('공급자 날짜 중복: ' + c.date);
    map.set(c.date, c);
  }
  return map;
}

function priceControl(y, n) {
  if (!y || !n || candleProblems(y).length || candleProblems(n).length || !positive(n.volume)) return null;
  const scale = median(PRICE.map((k) => y[k] / n[k]));
  if (!positive(scale) || !PRICE.every((k) => priceNear(y[k], n[k] * scale))) return null;
  return { date: n.date, priceFactor: scale, yVolume: y.volume, nVolume: n.volume };
}

/** v2 기준 봉: 가격 일치 + Yahoo 분할 기록으로 맞춘 거래량 일치 */
function control(y, n, splits) {
  const p = priceControl(y, n);
  if (!p) return null;
  const volumeFactor = splitVolumeFactor(splits, n.date);
  if (!volumeNear(y.volume, n.volume * volumeFactor)) return null;
  return { date: p.date, priceFactor: p.priceFactor, volumeFactor };
}

/** 주변 기준 봉 선택. 일반 구간은 앞뒤 각 5개, 양끝 8개 날짜 안에서는 한쪽 10개. */
function selectControls(anchors, i, d, total) {
  const candidates = anchors.filter((a) => a.date !== d && Math.abs(a.i - i) <= 60);
  const before = candidates.filter((a) => a.i < i).slice(-5);
  const after = candidates.filter((a) => a.i > i).slice(0, 5);
  const controls = [...before, ...after];
  const enough = controls.length >= 8 && before.length >= 3 && after.length >= 3;
  const edgeControls = i < 8 ? candidates.filter((a) => a.i > i).slice(0, 10)
    : i >= total - 8 ? candidates.filter((a) => a.i < i).slice(-10) : [];
  return enough ? controls : edgeControls;
}

/** 수익률/신호를 보지 않고 공급자끼리 일치하는 주변 OHLCV만으로 단위 변환을 확인한다. */
export function recoverStock(original, yahoo, naver) {
  const ym = uniqueMap(yahoo.candles), nm = uniqueMap(naver), om = uniqueMap(original.candles);
  const first = original.candles[0].date, last = original.candles.at(-1).date;
  const dates = [...new Set([...om.keys(), ...ym.keys(), ...nm.keys()])].filter((d) => d >= first && d <= last).sort();
  const anchors = dates.map((d, i) => ({ i, ...control(ym.get(d), nm.get(d), yahoo.splits) })).filter((a) => a.date);
  // v3: 가격만 일치한 기준 봉. 거래량 비율은 주변에서 따로 확인한다.
  const priceAnchors = dates.map((d, i) => ({ i, ...priceControl(ym.get(d), nm.get(d)) })).filter((a) => a.date)
    .map((a) => ({ ...a, volumeFactor: a.yVolume / a.nVolume }));
  const corrections = [], sourceRefresh = [], unresolved = [], omittedNonTrading = [], missingCandidates = [], removedNonTrading = [];
  const result = [];
  for (let i = 0; i < dates.length; i++) {
    const d = dates[i], old = om.get(d), y = ym.get(d), n = nm.get(d);
    const fresh = y && PRICE.every((k) => positive(y[k])) && Number.isFinite(y.volume) && y.volume >= 0
      ? { date: d, ...Object.fromEntries([...PRICE, 'volume'].map((k) => [k, Math.round(y[k])])) } : null;
    let base = fresh || old;
    if (fresh && old && [...PRICE, 'volume'].some((k) => fresh[k] !== old[k])) sourceRefresh.push({ date: d, before: old, after: fresh });
    if (base?.volume === 0 && (CLOSED_SESSIONS.has(d) || (n?.volume === 0 && n.open === 0 && n.high === 0 && n.low === 0))) {
      removedNonTrading.push({ date: d, before: base, original: old || null, naver: n || null,
        reason: CLOSED_SESSIONS.has(d) ? 'official-market-closure' : 'both-providers-non-trading', source: CLOSED_SESSIONS.get(d) || '보존된 Yahoo/Naver 원문' });
      continue;
    }
    // v3: 두 공급자 모두 거래량 0이고 가격이 한 값으로 고정된 봉 = 거래정지. 가격을 만들어 넣지 않고 계산에서 뺀다.
    if (base?.volume === 0 && PRICE.every((k) => base[k] === base.close) && n?.volume === 0 && positive(n.close)
      && PRICE.every((k) => n[k] === n.close)) {
      removedNonTrading.push({ date: d, before: base, original: old || null, naver: n, reason: 'both-providers-halt-flat', source: '보존된 Yahoo/Naver 원문' });
      continue;
    }
    if (!base && (!n || n.volume === 0)) { omittedNonTrading.push(d); continue; }
    if (!n || candleProblems(n).length || !positive(n.volume)) {
      if (base) result.push(base);
      if (!base || candleProblems(base).length) unresolved.push({ date: d, reason: '유효한 대조 봉 없음' });
      else if (base.volume === 0) unresolved.push({ date: d, reason: '거래량 0 봉의 무거래 여부 미확인' });
      continue;
    }
    // 데이터 양끝은 앞/뒤 한쪽에 8개 이상이 있는 경우만 허용한다.
    let selected = selectControls(anchors, i, d, dates.length);
    let scale = median(selected.map((a) => a.priceFactor));
    let volumeFactor = splitVolumeFactor(yahoo.splits, d);
    let volumeBasis = 'yahoo-split';
    let stable = selected.length >= 8 && positive(scale) && selected.every((a) => Math.abs(a.priceFactor / scale - 1) <= 0.0002 && Math.abs(a.volumeFactor / volumeFactor - 1) < 0.000001);
    if (!stable) {
      // v3: 주변 가격 일치 봉의 거래량 비율이 모두 0.1% 안이면 그 비율을 거래량 배율로 쓴다.
      const local = selectControls(priceAnchors, i, d, dates.length);
      const localScale = median(local.map((a) => a.priceFactor)), localVolume = median(local.map((a) => a.volumeFactor));
      if (local.length >= 8 && positive(localScale) && positive(localVolume)
        && local.every((a) => Math.abs(a.priceFactor / localScale - 1) <= 0.0002 && Math.abs(a.volumeFactor / localVolume - 1) <= 0.001)) {
        selected = local; scale = localScale; volumeFactor = localVolume; volumeBasis = 'local-volume-ratio'; stable = true;
      }
    }
    const replacement = scale == null ? null : { date: d, ...Object.fromEntries(PRICE.map((k) => [k, Math.round(n[k] * scale)])), volume: Math.round(n.volume * volumeFactor) };
    const mismatch = !base || (replacement && (PRICE.some((k) => !priceNear(base[k], replacement[k])) || !volumeNear(base.volume, replacement.volume)));
    if (mismatch || (base && candleProblems(base).length)) {
      // 거래량 0·OHLC가 모두 같은 채움 봉은 Naver 실거래 봉이 있을 때만 결측처럼 취급.
      const placeholder = base?.volume === 0 && PRICE.every((k) => base[k] === base.close);
      // 일반 봉은 2개 이상의 당일 가격도 일치해야 한다. 결측/채움 봉은 주변 단위 검증 필요.
      const matchingFields = base && replacement ? PRICE.filter((k) => priceNear(base[k], replacement[k])) : [];
      if (stable && (!base || placeholder || matchingFields.length >= 2) && !candleProblems(replacement).length) {
        corrections.push({ date: d, reason: !base ? 'missing-session' : placeholder ? 'zero-volume-placeholder' : 'cross-source-disagreement', before: base || null, after: replacement,
          original: old || null, naver: n, priceFactor: scale, volumeFactor, matchingFields,
          ...(volumeBasis === 'yahoo-split' ? {} : { volumeBasis }),
          controls: selected.map(({ i, yVolume, nVolume, ...a }) => a) });
        base = replacement;
      } else if (base && candleProblems(base).length) {
        unresolved.push({ date: d, reason: stable ? '당일 가격 일치 부족' : '주변 조정 단위 검증 부족' });
      } else if (!base) {
        missingCandidates.push({ date: d, reason: '결측 세션의 단위 검증 부족' });
      } else if (stable || placeholder) {
        unresolved.push({ date: d, reason: stable ? '공급자 가격 불일치: 당일 일치 필드 부족' : '채움 봉의 조정 단위 검증 부족' });
      }
    }
    if (base) {
      result.push(base);
    }
  }
  // 알려진 결측도 검사한다. OHLC만 정상인 불연속 이력을 20거래일 자료로 사용하지 않는다.
  const sourceConcerns = [...unresolved, ...missingCandidates];
  const candidate = { ...original, candles: result, dataQuality: { sourceConcerns } };
  return { candidate, corrections, sourceRefresh, unresolved, missingCandidates, omittedNonTrading, removedNonTrading,
    beforeQuality: inspectStock(original), afterQuality: inspectStock(candidate) };
}
