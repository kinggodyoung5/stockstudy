import { inspectStock } from './data-quality.js';
import { OUTCOME_DAYS, outcomeAt } from './outcome.js';

export const STUDY_PATTERNS = [
  { id: 'golden-cross', name: '골든크로스', averages: true },
  { id: 'dead-cross', name: '데드크로스', averages: true },
  { id: 'bullish-engulfing', name: '상승 장악형' },
  { id: 'bearish-engulfing', name: '하락 장악형' },
];
export const PROMPTS = [
  ['observation', '관찰한 사실', '날짜·가격대·고점과 저점·평균선 위치 등 확인할 수 있는 사실'],
  ['interpretation', '해석과 조건', '그 사실을 어떻게 읽었으며 어떤 조건에서 그 설명이 성립하는가'],
  ['counter', '반대 증거 또는 모르는 점', '내 해석과 맞지 않는 부분, 이 차트만으로 확인할 수 없는 정보'],
  ['invalidation', '설명을 바꿀 조건', '어떤 가격대·종가·지표 변화가 나오면 해석을 수정할 것인가'],
];
const identity = (h) => `${h.ticker}@${h.confirmDate || h.date}`;
const order = (a, b) => identity(a).localeCompare(identity(b));

/** 수익률 검증 표본이 아닌, 결과가 다른 사례를 의도적으로 짝지은 비교 교재. */
export function comparisonPairs(meta, eligibleTickers) {
  if (!['up', 'down'].includes(meta.bias)) return [];
  const allowed = new Set(eligibleTickers), unique = new Map();
  for (const h of meta.hits || []) {
    const o = h.outcome;
    if (allowed.has(h.ticker) && o?.days === OUTCOME_DAYS && Number.isFinite(o.changePct) && o.changePct !== 0
      && o.fromDate === (h.confirmDate || h.date)) unique.set(identity(h), h);
  }
  const sign = meta.bias === 'up' ? 1 : -1;
  const withDirection = [...unique.values()].filter((h) => h.outcome.changePct * sign > 0).sort(order);
  const against = [...unique.values()].filter((h) => h.outcome.changePct * sign < 0).sort(order);
  const pairs = [];
  for (const a of withDirection) {
    if (!against.length) break;
    const i = against.findIndex((b) => b.ticker !== a.ticker);
    const b = against.splice(i < 0 ? 0 : i, 1)[0];
    const key = [identity(a), identity(b)].sort().join('|');
    const hash = [...key].reduce((n, c) => ((n * 31 + c.charCodeAt(0)) >>> 0), 0);
    pairs.push(hash % 2 ? [a, b] : [b, a]);
  }
  return pairs;
}

export function studyKey(meta, pair) {
  return ['v1', meta.provenance.rulesVersion, meta.provenance.sourceDigest, meta.pattern,
    ...pair.map(identity).sort()].join(':');
}

/** 차트와 계산용 이력을 모두 확인일에서 자른다. 공개 후에도 정확히 20봉만 덧붙인다. */
export function studyWindow(stock, hit, revealed = false) {
  if (stock.ticker !== hit.ticker || !inspectStock(stock).eligible) throw new Error('학습에 사용할 수 없는 종목입니다.');
  const cs = stock.candles, start = hit.confirmDate || hit.date;
  const i = cs.findIndex((c) => c.date === start);
  if (i < 0 || hit.outcome?.fromDate !== start || hit.outcome.days !== OUTCOME_DAYS
    || i + OUTCOME_DAYS >= cs.length) throw new Error('확인일 또는 20봉 자료가 일치하지 않습니다.');
  const actual = outcomeAt(cs, i);
  if (actual.toDate !== hit.outcome.toDate || actual.changePct !== hit.outcome.changePct) throw new Error('차트와 저장 결과가 다릅니다. 자료를 다시 생성하세요.');
  const end = i + (revealed ? OUTCOME_DAYS : 0);
  return { history: cs.slice(0, end + 1), view: cs.slice(Math.max(0, i - 99), end + 1), cutoff: start };
}

export function validDraft(draft) {
  return PROMPTS.every(([key]) => typeof draft?.[key] === 'string' && draft[key].trim().length >= 8 && draft[key].length <= 1000);
}

export function submitStudy(previous, drafts, now = Date.now()) {
  if (previous?.submittedAt) return previous; // 공개 후 최초 근거 덮어쓰기 금지
  if (drafts.length !== 2 || !drafts.every(validDraft)) throw new Error('두 사례의 네 항목을 각각 8자 이상 기록하세요.');
  return { submittedAt: now, drafts: drafts.map((d) => Object.fromEntries(PROMPTS.map(([k]) => [k, d[k].trim()]))), reflection: '' };
}

/**
 * 기록을 하나 더하거나 바꾼다. 다른 기록은 그대로 둔다.
 * 예전에는 최근 30쌍만 남기고 지금 기준에 맞지 않는 기록을 지웠다. 이제는 아무것도 지우지 않는다.
 * 저장 공간이 모자라면 저장 실패로 알리고, 내보내기로 백업하도록 안내한다.
 * 이미 기록이 있으면 최초 근거(submittedAt·drafts)는 바꾸지 않고 복기만 받는다.
 */
export function keepStudy(records, key, record) {
  const previous = records?.[key];
  const next = previous?.submittedAt && record?.submittedAt !== previous.submittedAt
    ? { ...previous, reflection: record.reflection, reflectionAt: record.reflectionAt }
    : record;
  return { ...records, [key]: next };
}

/** 해설을 본 뒤의 복기. 최초 근거는 건드리지 않는다. */
export function reflectStudy(record, text, now = Date.now()) {
  if (!record?.submittedAt) throw new Error('먼저 두 사례의 근거를 기록하세요.');
  const reflection = String(text || '').trim();
  if (reflection.length < 8) throw new Error('복기를 8자 이상 적어주세요. 글의 질을 자동 평가하는 기준은 아닙니다.');
  return { ...record, reflection: reflection.slice(0, 2000), reflectionAt: now };
}
