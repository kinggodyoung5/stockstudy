/**
 * 내 기준 점검 (#/rules, 로드맵 Z). 사용자가 정한 기준을 그날까지의 봉에 기계적으로 적용한다.
 *
 * 이 파일은 계산만 한다. 앱은 기준에 넣을 숫자를 정해 주지 않는다. 예시 기준은 출처를 밝힌 책의 체크리스트다.
 * 판정은 "내가 정한 ○○ 기준 n번에 해당"이라는 규칙의 결과이지 매수·매도 권유가 아니다.
 *
 * 기준 묶음(set): { name, groups: { entry, add, exitPart, exitAll } }
 *   각 무리는 기준(criterion)의 목록이다. 기준 = { label, conds: [{ type, params }] }, 조건을 모두 만족하면 걸린다.
 *   무리 안에서 기준 하나라도 걸리면 그 무리에 해당한다.
 * 보유 판정의 우선순위: 전부 정리 > 일부 정리 > 보유 > 추가 검토. 정리 기준이 걸리면 추가 기준은 보지 않는다.
 *
 * 모든 조건은 i 일 종가까지의 봉만 쓴다. 주봉 조건은 i 일이 속한 주를 빼고, 이미 끝난 주만 쓴다.
 */
import { closes, sma, resample } from './indicators.js';
import { rsi, macd, atr } from './oscillators.js';

export const RULES_KEY = 'rules:v1';
export const HOLDINGS_KEY = 'holdings:v1';
export const RULES_LOG_KEY = 'rules-log:v1';

export const GROUPS = {
  entry: { title: '새로 진입', note: '보유하지 않은 종목에 쓰는 기준. 규칙 실험실에서 진입 시점으로 쓴다.' },
  add: { title: '추가 검토', note: '보유 중이고 정리 기준에 걸리지 않을 때만 본다.' },
  exitPart: { title: '일부 정리', note: '전부 정리 기준에 걸리지 않을 때 본다.' },
  exitAll: { title: '전부 정리', note: '가장 먼저 본다. 규칙 실험실에서 나가는 시점으로 쓴다.' },
};
export const STATES = { exitAll: '전부 정리 기준에 해당', exitPart: '일부 정리 기준에 해당', hold: '정리·추가 기준 어디에도 해당하지 않음 (보유)', add: '추가 검토 기준에 해당' };

const SIDE = { above: '위', below: '아래' }, DIR = { up: '높아짐', down: '낮아짐' }, CMP = { gte: '이상', lte: '이하' };
const n = (v, d = 2) => (v == null || !Number.isFinite(v) ? '—' : Number(v).toLocaleString('ko-KR', { maximumFractionDigits: d }));

/**
 * 조건 목록. params 의 각 항목: { k, label, kind: 'int' | 'num' | 'pick', min, max, options }
 * position: true 인 조건은 보유 정보(매수일·매수가·무효 가격)가 있어야 계산할 수 있다.
 */
export const CONDITIONS = {
  'close-ma': { label: '종가와 이동평균', params: [{ k: 'period', label: '기간(일)', kind: 'int', min: 2, max: 250 }, { k: 'side', label: '위치', kind: 'pick', options: SIDE }],
    text: (p) => `종가가 ${p.period}일 평균 ${SIDE[p.side]}` },
  'ma-ma': { label: '평균선끼리', params: [{ k: 'short', label: '짧은 기간(일)', kind: 'int', min: 2, max: 250 }, { k: 'long', label: '긴 기간(일)', kind: 'int', min: 3, max: 250 }, { k: 'side', label: '짧은 선의 위치', kind: 'pick', options: SIDE }],
    text: (p) => `${p.short}일 평균이 ${p.long}일 평균 ${SIDE[p.side]}` },
  'ma-slope': { label: '평균선 기울기', params: [{ k: 'period', label: '기간(일)', kind: 'int', min: 2, max: 250 }, { k: 'lookback', label: '며칠 전과 비교', kind: 'int', min: 1, max: 120 }, { k: 'dir', label: '방향', kind: 'pick', options: DIR }],
    text: (p) => `${p.period}일 평균이 ${p.lookback}거래일 전보다 ${DIR[p.dir]}` },
  'weekly-ma': { label: '주봉 종가와 주봉 평균', params: [{ k: 'weeks', label: '기간(주)', kind: 'int', min: 2, max: 60 }, { k: 'side', label: '위치', kind: 'pick', options: SIDE }],
    text: (p) => `끝난 주의 주봉 종가가 ${p.weeks}주 평균 ${SIDE[p.side]}` },
  'weekly-slope': { label: '주봉 평균 기울기', params: [{ k: 'weeks', label: '기간(주)', kind: 'int', min: 2, max: 60 }, { k: 'lookback', label: '몇 주 전과 비교', kind: 'int', min: 1, max: 26 }, { k: 'dir', label: '방향', kind: 'pick', options: DIR }],
    text: (p) => `${p.weeks}주 평균이 ${p.lookback}주 전보다 ${DIR[p.dir]} (끝난 주 기준)` },
  rsi: { label: 'RSI(14)', params: [{ k: 'cmp', label: '비교', kind: 'pick', options: CMP }, { k: 'value', label: '값', kind: 'num', min: 0, max: 100 }],
    text: (p) => `RSI(14)가 ${p.value} ${CMP[p.cmp]}` },
  macd: { label: 'MACD(12,26,9)', params: [{ k: 'kind', label: '무엇을', kind: 'pick', options: { 'signal-above': 'MACD선이 시그널선 위', 'signal-below': 'MACD선이 시그널선 아래', 'zero-above': 'MACD선이 0 위', 'zero-below': 'MACD선이 0 아래' } }],
    text: (p) => ({ 'signal-above': 'MACD선이 시그널선 위', 'signal-below': 'MACD선이 시그널선 아래', 'zero-above': 'MACD선이 0 위', 'zero-below': 'MACD선이 0 아래' })[p.kind] },
  breakout: { label: '직전 최고가 돌파', params: [{ k: 'period', label: '직전 몇 봉', kind: 'int', min: 5, max: 260 }],
    text: (p) => `종가가 직전 ${p.period}봉 최고 고가보다 높음 (오늘 제외)` },
  breakdown: { label: '직전 최저가 이탈', params: [{ k: 'period', label: '직전 몇 봉', kind: 'int', min: 5, max: 260 }],
    text: (p) => `종가가 직전 ${p.period}봉 최저 저가보다 낮음 (오늘 제외)` },
  'from-high': { label: '최고 종가에서 떨어진 정도', params: [{ k: 'period', label: '최근 몇 봉', kind: 'int', min: 5, max: 260 }, { k: 'cmp', label: '비교', kind: 'pick', options: { lte: '이내', gte: '이상 내림' } }, { k: 'pct', label: '%', kind: 'num', min: 0, max: 100 }],
    text: (p) => `종가가 최근 ${p.period}봉 최고 종가보다 ${p.pct}% ${p.cmp === 'lte' ? '이내로 아래' : '이상 아래'}` },
  'from-low': { label: '최저 종가에서 오른 정도', params: [{ k: 'period', label: '최근 몇 봉', kind: 'int', min: 5, max: 260 }, { k: 'pct', label: '% 이상', kind: 'num', min: 0, max: 1000 }],
    text: (p) => `종가가 최근 ${p.period}봉 최저 종가보다 ${p.pct}% 이상 위` },
  volume: { label: '거래량 배수', params: [{ k: 'ratio', label: '직전 20봉 평균의 몇 배 이상', kind: 'num', min: 0, max: 100 }],
    text: (p) => `거래량이 직전 20봉 평균의 ${p.ratio}배 이상` },
  'entry-return': { label: '매수가 대비 수익률', position: true, params: [{ k: 'cmp', label: '비교', kind: 'pick', options: CMP }, { k: 'pct', label: '% (손실은 음수)', kind: 'num', min: -100, max: 1000 }],
    text: (p) => `종가 기준 매수가 대비 ${p.pct}% ${CMP[p.cmp]}` },
  'stop-price': { label: '무효 가격 이탈', position: true, holdingOnly: true, params: [],
    text: () => '종가가 내가 정한 무효 가격보다 낮음' },
  'atr-trail': { label: 'ATR 추적 정리선', position: true, params: [{ k: 'mult', label: 'ATR(14)의 몇 배', kind: 'num', min: 0.5, max: 10 }],
    text: (p) => `종가가 매수 뒤 최고 종가 − ATR(14) × ${p.mult} 보다 낮음` },
  'held-days': { label: '보유 기간', position: true, params: [{ k: 'days', label: '거래일 이상', kind: 'int', min: 1, max: 2000 }],
    text: (p) => `매수 뒤 ${p.days}거래일 이상 지남` },
};

/** 한 종목의 계산 준비물. 필요한 지표만 처음 쓸 때 계산해 둔다. */
export function rulesContext(candles) {
  const c = closes(candles), memo = new Map();
  const get = (key, make) => { if (!memo.has(key)) memo.set(key, make()); return memo.get(key); };
  const weekly = () => get('weekly', () => {
    // 일봉 i 가 속한 주보다 앞의 끝난 주까지 몇 개인지: done[i]
    const weeks = resample(candles, 'week'), keyOf = (d) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - (x.getUTCDay() + 6) % 7); return x.toISOString().slice(0, 10); };
    const wkeys = weeks.map((w) => keyOf(w.date)), done = new Array(candles.length);
    let w = 0;
    for (let i = 0; i < candles.length; i++) { const k = keyOf(candles[i].date); while (w < wkeys.length && wkeys[w] < k) w++; done[i] = w; }
    return { closes: weeks.map((x) => x.close), done };
  });
  return {
    candles, c,
    sma: (p) => get('sma:' + p, () => sma(c, p)),
    rsi: () => get('rsi', () => rsi(c)),
    macd: () => get('macd', () => macd(c)),
    atr: () => get('atr', () => atr(candles)),
    volAvg: () => get('vol20', () => { const v = candles.map((x) => x.volume), out = new Array(v.length).fill(null); let s = 0; for (let i = 0; i < v.length; i++) { if (i >= 1) s += v[i - 1]; if (i >= 21) s -= v[i - 21]; if (i >= 20) out[i] = s / 20; } return out; }),
    weekly,
    weeklySma: (p) => get('wsma:' + p, () => sma(weekly().closes, p)),
  };
}

const maxOf = (a, from, to, f) => { let m = -Infinity; for (let k = from; k <= to; k++) m = Math.max(m, f(a[k])); return m; };
const minOf = (a, from, to, f) => { let m = Infinity; for (let k = from; k <= to; k++) m = Math.min(m, f(a[k])); return m; };

/**
 * 조건 하나. 반환: { hit: true | false | null, value } — null 은 계산할 수 없음(이력 부족, 보유 정보 없음).
 * position: { entryIndex, entryPrice, stop } (보유 판정·실험실에서만)
 */
export function evalCondition(ctx, i, cond, position = null) {
  const def = CONDITIONS[cond.type], p = cond.params || {}, cs = ctx.candles, close = cs[i].close;
  if (!def) return { hit: null, value: '알 수 없는 조건' };
  if (def.position && !position) return { hit: null, value: '보유 정보가 있어야 계산할 수 있음' };
  const none = (why = '이력 부족') => ({ hit: null, value: why });
  switch (cond.type) {
    case 'close-ma': { const m = ctx.sma(p.period)[i]; if (m == null) return none(); return { hit: p.side === 'above' ? close > m : close < m, value: `종가 ${n(close)} · ${p.period}일 평균 ${n(m)}` }; }
    case 'ma-ma': { const a = ctx.sma(p.short)[i], b = ctx.sma(p.long)[i]; if (a == null || b == null) return none(); return { hit: p.side === 'above' ? a > b : a < b, value: `${p.short}일 ${n(a)} · ${p.long}일 ${n(b)}` }; }
    case 'ma-slope': { const m = ctx.sma(p.period), a = m[i - p.lookback], b = m[i]; if (a == null || b == null) return none(); return { hit: p.dir === 'up' ? b > a : b < a, value: `${p.period}일 평균 ${n(a)} → ${n(b)}` }; }
    case 'weekly-ma': case 'weekly-slope': {
      const w = ctx.weekly(), k = w.done[i] - 1, m = ctx.weeklySma(p.weeks);
      if (k < 0 || m[k] == null) return none();
      if (cond.type === 'weekly-ma') return { hit: p.side === 'above' ? w.closes[k] > m[k] : w.closes[k] < m[k], value: `끝난 주 종가 ${n(w.closes[k])} · ${p.weeks}주 평균 ${n(m[k])}` };
      const a = m[k - p.lookback]; if (a == null) return none();
      return { hit: p.dir === 'up' ? m[k] > a : m[k] < a, value: `${p.weeks}주 평균 ${n(a)} → ${n(m[k])}` };
    }
    case 'rsi': { const v = ctx.rsi()[i]; if (v == null) return none(); return { hit: p.cmp === 'gte' ? v >= p.value : v <= p.value, value: `RSI ${n(v)}` }; }
    case 'macd': {
      const m = ctx.macd(), line = m.line[i], sig = m.signal[i]; if (line == null || sig == null) return none();
      const hit = { 'signal-above': line > sig, 'signal-below': line < sig, 'zero-above': line > 0, 'zero-below': line < 0 }[p.kind];
      return { hit, value: `MACD선 ${n(line)} · 시그널 ${n(sig)}` };
    }
    case 'breakout': case 'breakdown': {
      if (i < p.period) return none();
      const lvl = cond.type === 'breakout' ? maxOf(cs, i - p.period, i - 1, (x) => x.high) : minOf(cs, i - p.period, i - 1, (x) => x.low);
      return { hit: cond.type === 'breakout' ? close > lvl : close < lvl, value: `종가 ${n(close)} · 직전 ${p.period}봉 ${cond.type === 'breakout' ? '최고 고가' : '최저 저가'} ${n(lvl)}` };
    }
    case 'from-high': {
      if (i < p.period - 1) return none();
      const hi = maxOf(cs, i - p.period + 1, i, (x) => x.close), drop = (1 - close / hi) * 100;
      return { hit: p.cmp === 'lte' ? drop <= p.pct : drop >= p.pct, value: `최고 종가 ${n(hi)}에서 ${n(drop)}% 아래` };
    }
    case 'from-low': {
      if (i < p.period - 1) return none();
      const lo = minOf(cs, i - p.period + 1, i, (x) => x.close), up = (close / lo - 1) * 100;
      return { hit: up >= p.pct, value: `최저 종가 ${n(lo)}에서 ${n(up)}% 위` };
    }
    case 'volume': { const a = ctx.volAvg()[i]; if (!a) return none(); const r = cs[i].volume / a; return { hit: r >= p.ratio, value: `거래량 ${n(r)}배` }; }
    case 'entry-return': { const r = (close / position.entryPrice - 1) * 100; return { hit: p.cmp === 'gte' ? r >= p.pct : r <= p.pct, value: `매수가 ${n(position.entryPrice)} 대비 ${n(r)}%` }; }
    case 'stop-price': { if (!(position.stop > 0)) return none('무효 가격을 적지 않음'); return { hit: close < position.stop, value: `종가 ${n(close)} · 무효 가격 ${n(position.stop)}` }; }
    case 'atr-trail': {
      const a = ctx.atr()[i]; if (a == null || i < position.entryIndex) return none();
      const hi = maxOf(cs, position.entryIndex, i, (x) => x.close), line = hi - a * p.mult;
      return { hit: close < line, value: `매수 뒤 최고 종가 ${n(hi)} − ATR ${n(a)} × ${p.mult} = ${n(line)} · 종가 ${n(close)}` };
    }
    case 'held-days': { const d = i - position.entryIndex; return { hit: d >= p.days, value: `${d}거래일 보유` }; }
    default: return none('알 수 없는 조건');
  }
}

/** 기준 하나: 조건을 모두 만족하면 hit. 계산할 수 없는 조건이 있으면 hit 은 false, usable 은 false. */
export function evalCriterion(ctx, i, crit, position = null) {
  const results = crit.conds.map((c) => ({ ...evalCondition(ctx, i, c, position), text: CONDITIONS[c.type]?.text(c.params || {}) || c.type }));
  const usable = results.every((r) => r.hit !== null);
  return { label: crit.label, results, usable, hit: usable && results.length > 0 && results.every((r) => r.hit) };
}

/** 무리 하나의 모든 기준 */
export function evalGroup(ctx, i, set, group, position = null) {
  return (set.groups[group] || []).map((crit, k) => ({ index: k + 1, ...evalCriterion(ctx, i, crit, position) }));
}

/**
 * 보유 판정. 반환: { state, decisive: { group, index }, groups: { exitAll, exitPart, add } }
 * 우선순위: 전부 정리 > 일부 정리 > 보유 > 추가 검토.
 */
export function judgeHolding(ctx, i, set, position) {
  const groups = {};
  for (const g of ['exitAll', 'exitPart']) {
    groups[g] = evalGroup(ctx, i, set, g, position);
    const hit = groups[g].find((r) => r.hit);
    if (hit) return { state: g, decisive: { group: g, index: hit.index }, groups };
  }
  groups.add = evalGroup(ctx, i, set, 'add', position);
  const add = groups.add.find((r) => r.hit);
  return add ? { state: 'add', decisive: { group: 'add', index: add.index }, groups } : { state: 'hold', decisive: null, groups };
}

/** 기준 묶음 검사. 비어 있거나 범위를 벗어난 값이 있으면 그 이유 목록을 돌려준다. */
export function setErrors(set) {
  const out = [];
  if (!set || typeof set.name !== 'string' || !set.name.trim()) out.push('기준 묶음 이름을 적으세요.');
  for (const [g, list] of Object.entries(set?.groups || {})) {
    if (!GROUPS[g]) { out.push('알 수 없는 무리: ' + g); continue; }
    list.forEach((crit, k) => {
      if (!crit.conds?.length) out.push(`${GROUPS[g].title} ${k + 1}번: 조건이 없습니다.`);
      for (const c of crit.conds || []) {
        const def = CONDITIONS[c.type];
        if (!def) { out.push(`${GROUPS[g].title} ${k + 1}번: 알 수 없는 조건`); continue; }
        if (g === 'entry' && def.position) out.push(`${GROUPS[g].title} ${k + 1}번: 진입 기준에는 보유 정보가 필요한 조건(${def.label})을 쓸 수 없습니다.`);
        for (const q of def.params) {
          const v = c.params?.[q.k];
          if (q.kind === 'pick' ? !(v in q.options) : !(Number.isFinite(v) && v >= q.min && v <= q.max && (q.kind !== 'int' || Number.isInteger(v))))
            out.push(`${GROUPS[g].title} ${k + 1}번 ${def.label}: ‘${q.label}’ 값을 확인하세요.`);
        }
        if (c.type === 'ma-ma' && c.params.short >= c.params.long) out.push(`${GROUPS[g].title} ${k + 1}번: 짧은 기간이 긴 기간보다 짧아야 합니다.`);
      }
    });
  }
  return out;
}

export const emptySet = (name = '내 기준') => ({ name, groups: { entry: [], add: [], exitPart: [], exitAll: [] } });

/**
 * 출처를 밝힌 예시. 앱이 권하는 기준이 아니다. 불러온 뒤 내 기준으로 고쳐 쓴다.
 * 숫자는 출처의 설명을 옮긴 것이며, 원문에서 다시 확인해야 한다.
 */
export const EXAMPLES = [
  { id: 'minervini', name: '예시: 미너비니 추세 판정표', source: '마크 미너비니의 추세 판정표(Trend Template)를 설명한 2차 자료(ChartMill, MarketInOut). 원문 확인 필요.',
    groups: { entry: [{ label: '추세 판정표 조건 모두', conds: [
      { type: 'close-ma', params: { period: 150, side: 'above' } }, { type: 'close-ma', params: { period: 200, side: 'above' } },
      { type: 'ma-ma', params: { short: 150, long: 200, side: 'above' } }, { type: 'ma-slope', params: { period: 200, lookback: 21, dir: 'up' } },
      { type: 'ma-ma', params: { short: 50, long: 150, side: 'above' } }, { type: 'close-ma', params: { period: 50, side: 'above' } },
      { type: 'from-low', params: { period: 252, pct: 30 } }, { type: 'from-high', params: { period: 252, cmp: 'lte', pct: 25 } },
    ] }], add: [], exitPart: [], exitAll: [] } },
  { id: 'weinstein', name: '예시: 와인스타인 국면 (30주 평균)', source: '스탠 와인스타인의 국면 분석을 설명한 2차 자료(LuxAlgo, ChartMill). 30주 평균선 위·아래와 기울기로 국면을 나눈다. 원문 확인 필요.',
    groups: { entry: [{ label: '2국면: 오르는 30주선 위', conds: [{ type: 'weekly-ma', params: { weeks: 30, side: 'above' } }, { type: 'weekly-slope', params: { weeks: 30, lookback: 4, dir: 'up' } }] }],
      add: [], exitPart: [], exitAll: [{ label: '30주선 아래로 내려옴', conds: [{ type: 'weekly-ma', params: { weeks: 30, side: 'below' } }] }] } },
];
