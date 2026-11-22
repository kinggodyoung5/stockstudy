/**
 * 내 기준 점검 (#/rules/{sets|lab|check|log}). 학습 영역과 나눈 개인용 도구다.
 * 내가 정한 기준을 저장된 일봉에 기계적으로 적용한다. 결과는 "내가 정한 ○○ 기준 n번에 해당"이라는 규칙의 판정이다.
 * 앱은 기준에 넣을 숫자를 정해 주지 않는다. 학습 점수·기록과 섞지 않는다.
 */
import { loadStock, loadStockList, loadEligibleStockList, loadPatternIndex } from '../lib/data.js';
import { CONDITIONS, GROUPS, STATES, EXAMPLES, RULES_KEY, HOLDINGS_KEY, RULES_LOG_KEY, emptySet, setErrors, rulesContext, judgeHolding, evalCriterion } from '../lib/rules.js';
import { runLab, LAB_MIN_SAMPLE } from '../lib/rule-lab.js';
import { ACTIONS, EXPECTED, normalizeRules, normalizeHoldings, normalizeLog, saveSet, countAfterView, totalAfterViews, holdingError, logEntry, setAction, compareLog } from '../lib/rule-store.js';
import { inspectStock } from '../lib/data-quality.js';
import { el, clear } from '../lib/ui.js';
import * as storage from '../lib/storage.js';

let generation = 0;
export function destroyRules() { generation++; }

const n = (v, d = 2) => (v == null || !Number.isFinite(v) ? '—' : Number(v).toLocaleString('ko-KR', { maximumFractionDigits: d }));
const pct = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${n(v)}%`);
const TABS = { sets: '기준 만들기', lab: '규칙 실험실', check: '보유 점검', log: '판정 기록' };
const ORDER = ['exitAll', 'exitPart', 'add', 'entry'];
const LAB_DEFAULT = { fee: 0, tax: 0, slip: 0, split: '2022-01-01', market: 'all' };
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const today = () => new Date().toISOString().slice(0, 10);

function persist(key, value, note) {
  if (storage.save(key, value)) return true;
  if (note) { note.textContent = '저장하지 못했습니다. 브라우저 저장이 막혀 있거나 공간이 부족할 수 있습니다.'; note.className = 'small warn'; }
  return false;
}
const defaultParams = (type) => Object.fromEntries(CONDITIONS[type].params.map((q) => [q.k, q.kind === 'pick' ? Object.keys(q.options)[0] : '']));

export async function renderRules(app, params = []) {
  destroyRules();
  const token = generation, tab = TABS[params[0]] ? params[0] : 'sets';
  const [patternIndex, all] = await Promise.all([loadPatternIndex(), loadStockList()]);
  if (token !== generation || !app.isConnected) return;
  const dataEnd = patternIndex.to, stale = daysBetween(dataEnd, today());
  const note = el('p.small.muted', { 'aria-live': 'polite' });
  const body = el('div');
  clear(app).append(
    el('h1.page-title', { text: '내 기준 점검' }),
    el('p.page-sub', { text: '내가 정한 기준을 저장된 일봉에 기계적으로 적용해 봅니다. 결과는 “내가 정한 정리 기준 2번에 해당합니다”처럼 규칙의 판정입니다. 앱은 기준에 넣을 숫자를 정해 주지 않고, 학습 기록과도 섞지 않습니다.' }),
    el('div.panel.caution', null, [el('ul', null, [
      el('li', { text: `자료는 ${dataEnd} 종가까지입니다${stale > 3 ? ` (${stale}일 전). 오늘 시세가 아닙니다` : ''}. 새 자료는 tools/update-data.mjs 로 받아야 합니다.` }),
      el('li', { text: '종목 목록에 상장폐지된 회사가 없어 과거 결과가 실제보다 좋게 나올 수 있습니다(살아남은 종목만 남는 편향).' }),
      el('li', { text: '기준을 고쳐 가며 과거 성과를 올리면 우연에 맞춘 규칙이 됩니다. 실험실은 앞 구간과 뒤 구간을 나누고, 고친 횟수와 뒤 구간을 본 횟수를 보여줍니다.' }),
    ])]),
    el('nav.row', { 'aria-label': '내 기준 점검', style: { margin: '12px 0' } }, Object.entries(TABS).map(([k, t]) =>
      el('a.btn', { href: '#/rules/' + k, text: t, 'aria-current': k === tab ? 'page' : null, class: k === tab ? 'primary' : '' }))),
    body, note);

  let rules = normalizeRules(storage.load(RULES_KEY, null));
  const saveRules = () => persist(RULES_KEY, rules, note);
  const setList = () => Object.entries(rules.sets).sort((a, b) => a[1].createdAt - b[1].createdAt);
  const setPicker = (onChange) => {
    const sel = el('select', { 'aria-label': '기준 묶음' }, setList().map(([id, s]) => el('option', { value: id, text: `${s.name} (판 ${s.revision})` })));
    if (rules.active && rules.sets[rules.active]) sel.value = rules.active;
    sel.addEventListener('change', () => { rules = { ...rules, active: sel.value }; saveRules(); onChange?.(sel.value); });
    return sel;
  };
  const noSets = () => el('p', null, ['아직 저장한 기준 묶음이 없습니다. ', el('a', { href: '#/rules/sets', text: '기준 만들기' }), '에서 먼저 만드세요.']);

  /* ───────────── 기준 만들기 ───────────── */
  function renderSets() {
    let id = rules.active && rules.sets[rules.active] ? rules.active : null;
    let draft = id ? structuredClone({ name: rules.sets[id].name, groups: rules.sets[id].groups }) : emptySet();
    const editor = el('div'), errors = el('div', { 'aria-live': 'polite' });
    const top = el('div.row');
    function header() {
      clear(top).append(...[
        setList().length ? setPicker((v) => { id = v; draft = structuredClone({ name: rules.sets[v].name, groups: rules.sets[v].groups }); draw(); }) : null,
        el('button.btn', { type: 'button', text: '새 기준 묶음', onclick: () => { id = null; draft = emptySet(); draw(); } }),
        el('label', { text: '예시 불러오기 ' }, [el('select', { onchange: (e) => {
          const ex = EXAMPLES.find((x) => x.id === e.target.value); if (!ex) return;
          id = null; draft = structuredClone({ name: ex.name, groups: ex.groups }); draft.source = ex.source; draw(); e.target.value = '';
        } }, [el('option', { value: '', text: '고르기' }), ...EXAMPLES.map((x) => el('option', { value: x.id, text: x.name }))])]),
      ].filter(Boolean));
    }
    function paramInput(c, q) {
      const v = c.params[q.k];
      if (q.kind === 'pick') {
        const s = el('select', { 'aria-label': q.label, onchange: () => { c.params[q.k] = s.value; } }, Object.entries(q.options).map(([k, t]) => el('option', { value: k, text: t })));
        s.value = v; return el('label', null, [q.label + ' ', s]);
      }
      const i = el('input', { type: 'number', step: q.kind === 'int' ? '1' : 'any', min: q.min, max: q.max, value: v === '' ? '' : v, style: { width: '6.5em' }, 'aria-label': q.label,
        oninput: () => { c.params[q.k] = i.value === '' ? '' : Number(i.value); } });
      return el('label', null, [q.label + ' ', i]);
    }
    function condRow(crit, c, k) {
      const type = el('select', { 'aria-label': '조건 종류', onchange: () => { c.type = type.value; c.params = defaultParams(c.type); draw(); } },
        Object.entries(CONDITIONS).map(([t, d]) => el('option', { value: t, text: d.label + (d.position ? ' (보유 정보 필요)' : '') })));
      type.value = c.type;
      return el('div.row.rule-cond', null, [type, ...CONDITIONS[c.type].params.map((q) => paramInput(c, q)),
        el('button.btn', { type: 'button', text: '조건 빼기', onclick: () => { crit.conds.splice(k, 1); draw(); } })]);
    }
    function draw() {
      header();
      const name = el('input', { type: 'text', value: draft.name, maxlength: 60, 'aria-label': '기준 묶음 이름', oninput: () => { draft.name = name.value; } });
      const saved = id ? rules.sets[id] : null;
      clear(editor).append(...[
        el('label', null, ['기준 묶음 이름 ', name]),
        draft.source ? el('p.small.warn', { text: `출처: ${draft.source} 앱이 권하는 기준이 아닙니다. 저장하면 내 기준이 됩니다.` }) : null,
        saved ? el('p.small.muted', { text: `판 ${saved.revision} · 고친 횟수 ${saved.revision - 1}번 · 실험실에서 뒤 구간을 본 횟수 ${totalAfterViews(saved)}번` }) : null,
        ...ORDER.map((g) => el('section.panel', null, [
          el('h2', { text: GROUPS[g].title }), el('p.small.muted', { text: GROUPS[g].note + ' 기준 하나는 조건을 모두 만족해야 걸리고, 무리 안의 기준 하나라도 걸리면 이 무리에 해당합니다.' }),
          ...draft.groups[g].map((crit, k) => el('div.rule-crit', null, [
            el('div.row', null, [el('b', { text: `${GROUPS[g].title} ${k + 1}번` }),
              el('input', { type: 'text', value: crit.label || '', maxlength: 80, placeholder: '기준 이름 (선택)', 'aria-label': '기준 이름', oninput: (e) => { crit.label = e.target.value; } }),
              el('button.btn', { type: 'button', text: '기준 빼기', onclick: () => { draft.groups[g].splice(k, 1); draw(); } })]),
            ...crit.conds.map((c, j) => condRow(crit, c, j)),
            el('button.btn', { type: 'button', text: '조건 더하기', onclick: () => { crit.conds.push({ type: 'close-ma', params: defaultParams('close-ma') }); draw(); } }),
          ])),
          el('button.btn', { type: 'button', text: '기준 더하기', onclick: () => { draft.groups[g].push({ conds: [{ type: 'close-ma', params: defaultParams('close-ma') }] }); draw(); } }),
        ])),
        el('div.row', null, [el('button.btn.primary', { type: 'button', text: '저장', onclick: () => {
          const e = setErrors(draft);
          clear(errors);
          if (e.length) { errors.append(el('ul.warn', null, e.map((x) => el('li', { text: x })))); return; }
          id = id || 's' + Date.now();
          rules = saveSet(rules, id, draft); saveRules();
          delete draft.source;
          note.textContent = `저장했습니다. 판 ${rules.sets[id].revision}.`; note.className = 'small muted';
          draw();
        } })]),
        errors,
      ].filter(Boolean));
    }
    clear(body).append(top, editor);
    draw();
  }

  /* ───────────── 규칙 실험실 ───────────── */
  function renderLab() {
    if (!setList().length) { clear(body).append(noSets()); return; }
    const opts = { ...LAB_DEFAULT };
    const out = el('div', { 'aria-live': 'polite' });
    const field = (k, label, attrs = {}) => el('label', null, [label + ' ', el('input', { type: 'number', step: 'any', min: 0, value: opts[k], style: { width: '6em' }, oninput: (e) => { opts[k] = Number(e.target.value) || 0; }, ...attrs })]);
    const market = el('select', { 'aria-label': '시장', onchange: () => { opts.market = market.value; } }, [['all', '전체'], ['KR', '국내'], ['US', '미국']].map(([v, t]) => el('option', { value: v, text: t })));
    const split = el('input', { type: 'date', value: opts.split, min: '2016-01-01', max: dataEnd, oninput: () => { opts.split = split.value; } });
    const run = el('button.btn.primary', { type: 'button', text: '과거 자료에 돌려 보기' });
    clear(body).append(
      el('div.row', null, [el('label', null, ['기준 묶음 ', setPicker()]), el('label', null, ['시장 ', market])]),
      el('div.row', null, [field('fee', '수수료 % (한 번 거래마다)'), field('tax', '세금 % (팔 때)'), field('slip', '밀리는 손실 % (한 번 거래마다)'), el('label', null, ['앞·뒤 나누는 날 ', split])]),
      el('p.small.muted', { text: '수수료·세율은 바뀝니다. 넣은 값과 확인한 날짜를 기준 이름에 적어 두세요. 앱은 값을 정해 주지 않습니다(기본 0).' }),
      el('details.rulebox', null, [el('summary', { text: '이 실험의 가정' }), el('ul', null, [
        '진입 기준과 전부 정리 기준만 씁니다. 추가 검토·일부 정리 기준은 쓰지 않습니다.',
        '그날 종가로 판정하고 다음 거래일 시가에 사고팝니다. 시가가 크게 벌어져도(갭) 그 가격으로 계산합니다.',
        '한 종목에 한 번에 하나, 같은 금액으로 봅니다. 거래끼리 시기가 겹칩니다.',
        '‘무효 가격 이탈’은 보유 점검에서만 계산합니다. 실험실에서는 ‘매수가 대비 수익률’이나 ‘ATR 추적 정리선’을 쓰세요.',
        `자료 끝까지 정리되지 않은 거래는 결과에서 빼고 따로 셉니다. 표본이 ${LAB_MIN_SAMPLE}개보다 적으면 비율과 구간을 숫자로 쓰지 않습니다.`,
      ].map((x) => el('li', { text: x })))]),
      el('div.row', null, [run]), out);
    run.addEventListener('click', async () => {
      const id = rules.active && rules.sets[rules.active] ? rules.active : setList()[0][0], set = rules.sets[id];
      if (!set.groups.entry.length || !set.groups.exitAll.length) { clear(out).append(el('p.warn', { text: '진입 기준과 전부 정리 기준이 하나 이상 있어야 돌려 볼 수 있습니다.' })); return; }
      run.disabled = true;
      const list = (await loadEligibleStockList()).filter((s) => opts.market === 'all' || s.market === opts.market);
      const stocks = [];
      for (const [k, s] of list.entries()) {
        clear(out).append(el('p.loading', { text: `종목 자료를 읽는 중… ${k + 1}/${list.length}` }));
        const st = await loadStock(s.ticker);
        if (token !== generation) return;
        stocks.push({ ticker: s.ticker, candles: st.candles });
      }
      clear(out).append(el('p.loading', { text: '계산하는 중…' }));
      await new Promise((r) => setTimeout(r, 20));
      const lab = runLab(stocks, set, opts);
      run.disabled = false;
      showLab(out, id, set, lab, stocks.length, { ...opts });
    });
  }
  function summaryTable(s) {
    if (!s.n) return el('p', { text: '이 구간에는 거래가 없습니다.' });
    const rows = [['거래 수', `${s.n}번 (${s.tickers}종목)`], ['이익으로 끝난 비율', s.winShare == null ? `표본 ${LAB_MIN_SAMPLE}개 미만: 숫자로 쓰지 않음` : `${n(s.winShare, 1)}%`],
      ['평균 손익', pct(s.mean) + (s.ci ? ` (95% 구간 ${pct(s.ci[0])} ~ ${pct(s.ci[1])}, 겹치는 거래가 있어 실제로는 더 넓음)` : '')],
      ['가운데 값', pct(s.median)], ['아래 10% · 위 10%', `${pct(s.p10)} · ${pct(s.p90)}`], ['가장 나쁜 · 가장 좋은', `${pct(s.worst)} · ${pct(s.best)}`], ['평균 보유', `${n(s.avgDays, 1)}거래일`]];
    return el('div.table-wrap', null, [el('table.lesson-table', null, rows.map(([a, b]) => el('tr', null, [el('th', { text: a }), el('td', { text: b })])))]);
  }
  function showLab(out, id, set, lab, count, opts) {
    const after = el('div');
    const views = totalAfterViews(rules.sets[id]);
    const openAfter = el('button.btn', { type: 'button', text: '뒤 구간 결과 보기 (본 횟수가 기록됩니다)', onclick: () => {
      rules = countAfterView(rules, id); saveRules(); openAfter.remove();
      clear(after).append(el('h3', { text: `뒤 구간 (진입일 ${opts.split}부터)` }), summaryTable(lab.segments.after),
        el('p.small.warn', { text: `이 기준 묶음(판 ${rules.sets[id].revision})의 뒤 구간을 지금까지 ${totalAfterViews(rules.sets[id])}번 봤습니다. 뒤 구간을 본 뒤 기준을 고치면, 뒤 구간도 앞 구간처럼 맞춰 본 결과가 됩니다.` }));
    } });
    clear(out).append(...[
      el('p.small.muted', { text: `${set.name} · 판 ${set.revision} (고친 횟수 ${set.revision - 1}번) · ${count}종목 · 정리되지 않은 거래 ${lab.open.length}개는 제외 · 비용: 수수료 ${n(opts.fee)}%, 세금 ${n(opts.tax)}%, 밀리는 손실 ${n(opts.slip)}%` }),
      el('h3', { text: `앞 구간 (진입일 ${opts.split} 전, 기준을 정하는 데 쓰는 구간)` }), summaryTable(lab.segments.before),
      views ? el('p.small.warn', { text: `이 판의 뒤 구간을 이미 ${views}번 봤습니다.` }) : null,
      openAfter, after,
      el('details', null, [el('summary', { text: '앞 구간 거래 목록 (최근 50개)' }), el('div.table-wrap', null, [el('table.lesson-table', null, [
        el('tr', null, ['종목', '진입 기준 판정일', '산 날', '판 날', '손익', '보유'].map((t) => el('th', { text: t }))),
        ...lab.trades.filter((t) => t.entryDate < opts.split).slice(-50).reverse().map((t) => el('tr', null, [t.ticker, t.signalDate, `${t.entryDate} ${n(t.entryPrice)}`, `${t.exitDate} ${n(t.exitPrice)}`, pct(t.ret), `${t.days}일`].map((x) => el('td', { text: x })))),
      ])])]),
    ].filter(Boolean));
  }

  /* ───────────── 보유 점검 ───────────── */
  async function renderCheck() {
    if (!setList().length) { clear(body).append(noSets()); return; }
    let holdings = normalizeHoldings(storage.load(HOLDINGS_KEY, null));
    const allowed = new Set(patternIndex.eligibleTickers);
    const form = { ticker: '', entryDate: '', entryPrice: '', qty: '', stop: '', note: '' };
    const out = el('div', { 'aria-live': 'polite' }), list = el('div'), formErr = el('p.small.warn', { 'aria-live': 'polite' });
    const tickerSel = el('select', { 'aria-label': '종목', onchange: () => { form.ticker = tickerSel.value; } },
      [el('option', { value: '', text: '종목 고르기' }), ...all.sort((a, b) => a.name.localeCompare(b.name, 'ko')).map((s) => el('option', { value: s.ticker, text: `${s.name} (${s.ticker})${allowed.has(s.ticker) ? '' : ' · 자료 검사 실패'}` }))]);
    const input = (k, label, type = 'number') => el('label', null, [label + ' ', el('input', { type, step: 'any', style: { width: type === 'date' ? 'auto' : '8em' }, oninput: (e) => { form[k] = e.target.value; } })]);
    function drawList() {
      clear(list).append(holdings.items.length ? el('div.table-wrap', null, [el('table.lesson-table', null, [
        el('tr', null, ['종목', '매수일', '매수가', '수량', '무효 가격', ''].map((t) => el('th', { text: t }))),
        ...holdings.items.map((h) => el('tr', null, [
          el('td', { text: (all.find((s) => s.ticker === h.ticker)?.name || h.ticker) }), el('td', { text: h.entryDate }), el('td', { text: n(h.entryPrice) }),
          el('td', { text: h.qty == null ? '—' : n(h.qty, 4) }), el('td', { text: h.stop == null ? '—' : n(h.stop) }),
          el('td', null, [el('button.btn', { type: 'button', text: '점검', onclick: () => check(h) }), ' ',
            el('button.btn', { type: 'button', text: '목록에서 빼기', onclick: () => { if (!confirm('이 보유 항목을 목록에서 뺄까요? 판정 기록은 남습니다.')) return; holdings = { ...holdings, items: holdings.items.filter((x) => x.id !== h.id) }; persist(HOLDINGS_KEY, holdings, note); drawList(); } })]),
        ]))])]) : el('p.small.muted', { text: '아직 넣은 보유 종목이 없습니다.' }));
    }
    async function check(h) {
      clear(out).append(el('p.loading', { text: '판정하는 중…' }));
      const id = rules.active && rules.sets[rules.active] ? rules.active : setList()[0][0], set = rules.sets[id];
      const stock = await loadStock(h.ticker);
      if (token !== generation) return;
      if (!allowed.has(h.ticker) || !inspectStock(stock).eligible) { clear(out).append(el('p.warn', { text: '이 종목은 자료 검사(두 공급자 대조 등)를 통과하지 못해 판정하지 않습니다.' })); return; }
      const cs = stock.candles, i = cs.length - 1, entryIndex = cs.findIndex((c) => c.date >= h.entryDate);
      if (entryIndex < 0) { clear(out).append(el('p.warn', { text: `매수일 ${h.entryDate}이 저장된 자료(${cs[i].date}까지)보다 뒤라 판정할 수 없습니다.` })); return; }
      const ctx = rulesContext(cs), pos = { entryIndex, entryPrice: h.entryPrice, stop: h.stop };
      const j = judgeHolding(ctx, i, set, pos), close = cs[i].close;
      const head = j.state === 'hold' ? STATES.hold : `내가 정한 ${GROUPS[j.decisive.group].title} 기준 ${j.decisive.index}번에 해당합니다.`;
      const crit = j.decisive ? set.groups[j.decisive.group][j.decisive.index - 1] : null;
      clear(out).append(...[
        el('h2', { text: `${stock.name} · ${cs[i].date} 종가 ${n(close)}` }),
        el('p.rule-verdict', null, [el('b', { text: head })]),
        cs[i].date < dataEnd ? el('p.small.warn', { text: `이 종목 자료는 ${cs[i].date}까지입니다. 그 뒤의 움직임은 판정에 들어 있지 않습니다.` }) : null,
        el('p.small', { text: `매수가 대비 ${pct((close / h.entryPrice - 1) * 100)} · 보유 ${i - entryIndex}거래일${h.stop ? (close < h.stop ? ` · 종가가 무효 가격 ${n(h.stop)} 아래에 있음` : ` · 무효 가격 ${n(h.stop)}까지 ${pct((h.stop / close - 1) * 100)}`) : ''}${h.stop && h.qty ? ` · 매수가에서 무효 가격까지 손익 ${n((h.stop - h.entryPrice) * h.qty)}` : ''}` }),
        ...['exitAll', 'exitPart', 'add'].filter((g) => j.groups[g]).map((g) => groupBox(g, j.groups[g])),
        j.state !== 'add' && !j.groups.add ? el('p.small.muted', { text: '정리 기준에 걸려 추가 검토 기준은 보지 않았습니다.' }) : null,
        crit ? pastBox(ctx, i, crit) : null,
        el('div.row', null, [el('button.btn.primary', { type: 'button', text: '이 판정 기록하기', onclick: (e) => {
          let log = normalizeLog(storage.load(RULES_LOG_KEY, null));
          if (log.entries.some((x) => x.holdingId === h.id && x.dataDate === cs[i].date && x.setId === id && x.revision === set.revision)) { e.target.textContent = '이미 같은 날·같은 판으로 기록했습니다'; e.target.disabled = true; return; }
          log = { ...log, entries: [...log.entries, logEntry(j, { holding: h, set, setId: id, dataDate: cs[i].date, close })] };
          if (persist(RULES_LOG_KEY, log, note)) { e.target.textContent = '기록했습니다. ‘판정 기록’에서 실제로 한 행동을 적으세요.'; e.target.disabled = true; }
        } })]),
      ].filter(Boolean));
    }
    function groupBox(g, rows) {
      return el('section.panel', null, [el('h3', { text: GROUPS[g].title }), rows.length ? el('ul', null, rows.map((r) => el('li', null, [
        el('b', { text: `${r.index}번${r.label ? ' ' + r.label : ''}: ${r.hit ? '해당' : r.usable ? '해당하지 않음' : '계산할 수 없는 조건이 있음'}` }),
        el('ul', null, r.results.map((x) => el('li.small', { text: `${x.hit === true ? '○' : x.hit === false ? '×' : '?'} ${x.text} — ${x.value}` }))),
      ]))) : el('p.small.muted', { text: '이 무리에 기준이 없습니다.' })]);
    }
    function pastBox(ctx, i, crit) {
      if (crit.conds.some((c) => CONDITIONS[c.type].position)) return el('p.small.muted', { text: '이 기준에는 보유 정보가 필요한 조건이 있어 과거 같은 날을 세지 않았습니다.' });
      const ch = [];
      for (let k = 1; k + 20 <= i; k++) if (evalCriterion(ctx, k, crit).hit) ch.push((ctx.candles[k + 20].close / ctx.candles[k].close - 1) * 100);
      const s = [...ch].sort((a, b) => a - b), med = s[Math.floor(s.length / 2)];
      return el('p.small', { text: s.length >= LAB_MIN_SAMPLE
        ? `이 종목에서 같은 기준이 걸린 날 ${s.length}일(이어진 날 포함) 뒤 20거래일 종가 변화: 가운데 값 ${pct(med)}, 오른 비율 ${n(s.filter((x) => x > 0).length / s.length * 100, 1)}%. 손절·익절 없이 종가만 잰 값입니다.`
        : `이 종목에서 같은 기준이 걸린 날은 ${s.length}일입니다. ${LAB_MIN_SAMPLE}일보다 적어 비율을 숫자로 쓰지 않습니다.` });
    }
    clear(body).append(
      el('div.row', null, [el('label', null, ['판정에 쓸 기준 묶음 ', setPicker()])]),
      el('section.panel', null, [el('h2', { text: '보유 종목 넣기' }),
        el('div.row', null, [tickerSel, input('entryDate', '매수일', 'date'), input('entryPrice', '매수가'), input('qty', '수량 (선택)'), input('stop', '처음 정한 무효 가격 (선택)')]),
        el('button.btn', { type: 'button', text: '넣기', onclick: () => {
          const h = { id: 'h' + Date.now(), ticker: form.ticker, entryDate: form.entryDate, entryPrice: Number(form.entryPrice),
            qty: form.qty === '' ? null : Number(form.qty), stop: form.stop === '' ? null : Number(form.stop), createdAt: Date.now() };
          const e = holdingError(h); formErr.textContent = e || '';
          if (e) return;
          holdings = { ...holdings, items: [...holdings.items, h] }; persist(HOLDINGS_KEY, holdings, note); drawList();
        } }), formErr]),
      list, out);
    drawList();
  }

  /* ───────────── 판정 기록 ───────────── */
  async function renderLog() {
    let log = normalizeLog(storage.load(RULES_LOG_KEY, null));
    if (!log.entries.length) { clear(body).append(el('p', { text: '아직 기록한 판정이 없습니다. ‘보유 점검’에서 판정한 뒤 기록하세요.' })); return; }
    const latest = {};
    for (const t of new Set(log.entries.map((e) => e.ticker))) { const s = await loadStock(t); latest[t] = { date: s.candles.at(-1).date, close: s.candles.at(-1).close }; }
    if (token !== generation) return;
    function draw() {
      const c = compareLog(log, latest);
      clear(body).append(
        el('p', { text: c.answered ? `실제로 한 행동을 적은 판정 ${c.answered}개 중 ${c.agreed}개가 기준의 판정과 같았습니다.` : '아직 실제로 한 행동을 적은 판정이 없습니다.' }),
        el('p.small.muted', { text: '판정 뒤 가격 변화는 기록한 날 종가에서 저장된 마지막 종가까지입니다. 기준대로 했다면 어땠을지와 실제로 한 것을 견주는 자료이고, 한두 번의 결과로 기준의 좋고 나쁨을 정하지 않습니다.' }),
        el('div.table-wrap', null, [el('table.lesson-table', null, [
          el('tr', null, ['자료 날짜', '종목', '기준 (판)', '판정', '내가 한 행동', '그 뒤 변화'].map((t) => el('th', { text: t }))),
          ...c.rows.slice().reverse().map((r) => el('tr', null, [
            el('td', { text: r.dataDate }), el('td', { text: all.find((s) => s.ticker === r.ticker)?.name || r.ticker }), el('td', { text: `${r.setName} (${r.revision})` }),
            el('td', { text: r.decisive ? `${GROUPS[r.decisive.group].title} ${r.decisive.index}번` : '보유' }),
            el('td', null, r.action ? [`${ACTIONS[r.action.kind]}${r.agree ? ' (판정과 같음)' : ' (판정과 다름)'}`, r.action.note ? el('div.small.muted', { text: r.action.note }) : null].filter(Boolean) : [actionForm(r)]),
            el('td', { text: r.change == null ? '아직 새 자료 없음' : `${pct(r.change)} (${r.lastDate}까지)` }),
          ])),
        ])]));
    }
    function actionForm(r) {
      const sel = el('select', { 'aria-label': '실제로 한 행동' }, [el('option', { value: '', text: '고르기' }), ...Object.entries(ACTIONS).map(([k, t]) => el('option', { value: k, text: t }))]);
      const memo = el('input', { type: 'text', maxlength: 500, placeholder: '이유 (선택)', 'aria-label': '이유' });
      return el('div', null, [sel, memo, el('button.btn', { type: 'button', text: '적기 (한 번만)', onclick: () => {
        if (!sel.value) return;
        log = setAction(log, r.id, sel.value, memo.value); persist(RULES_LOG_KEY, log, note); draw();
      } }), el('div.small.muted', { text: `기준대로라면: ${ACTIONS[EXPECTED[r.state]]}` })]);
    }
    draw();
  }

  if (tab === 'sets') renderSets();
  else if (tab === 'lab') renderLab();
  else if (tab === 'check') await renderCheck();
  else await renderLog();
}
