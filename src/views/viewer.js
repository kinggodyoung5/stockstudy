/**
 * 실제 과거 데이터 뷰어 (설명서 5.4)
 *
 * 지표를 켜고 끄고, 기간과 봉 단위를 바꾸고, 파라미터를 직접 조절해가며
 * "같은 구간이 설정에 따라 얼마나 다르게 보이는지"를 확인하는 곳이다.
 */

import { loadStockList, loadStock, defaultBenchmark } from '../lib/data.js';
import { createStockChart, createOscillatorPanel, syncTimeScales, COLORS } from '../lib/chart.js';
import { OSCILLATORS } from '../lib/oscillators.js';
import {
  supportResistance, fibonacci, dominantSwing, volumeProfile, resample, relativeStrength,
} from '../lib/indicators.js';
import { el, clear, overlayBar, fmt, signed, dirClass } from '../lib/ui.js';

let chart = null;
let panels = [];
let unsync = null;

export function destroyViewer() {
  if (unsync) { try { unsync(); } catch (_) {} unsync = null; }
  panels.forEach((p) => { try { p.destroy(); } catch (_) {} });
  panels = [];
  if (chart) { try { chart.destroy(); } catch (_) {} chart = null; }
}

const RANGES = [
  { id: '3m', label: '3개월', bars: 63 },
  { id: '6m', label: '6개월', bars: 126 },
  { id: '1y', label: '1년', bars: 252 },
  { id: '3y', label: '3년', bars: 756 },
  { id: 'all', label: '전체', bars: Infinity },
];

const UNITS = [
  { id: 'day', label: '일봉' },
  { id: 'week', label: '주봉' },
  { id: 'month', label: '월봉' },
];

export async function renderViewer(app) {
  destroyViewer();
  clear(app).append(el('p.loading', { text: '종목 목록을 불러오는 중…' }));

  const list = await loadStockList();

  const state = {
    ticker: list[0].ticker,
    range: '1y',
    unit: 'day',
    end: null,
    logScale: false,
    tools: { levels: false, fib: false, profile: false, rs: false },
    oscillators: { rsi: true, macd: false, stochastic: false, atr: false, adx: false, obv: false },
    params: {
      ma: { ma5: 5, ma20: 20, ma60: 60, ma120: 120, ma200: 200 },
      bb: { period: 20, mult: 2 },
    },
  };
  const overlays = {
    ma5: true, ma20: true, ma60: true, ma120: false, ma200: false,
    bollinger: false, ichimoku: false, volume: true,
  };

  const box = el('div.chart-box.tall');
  const profileBox = el('div.profile');
  const panelWrap = el('div.panels');
  const stats = el('div.stat-row');
  const levelList = el('div');
  const meta = el('div.row', { style: { margin: '10px 0 4px' } });

  // ── 컨트롤 ────────────────────────────────────────────
  const tickerSel = el('select');
  for (const row of list) tickerSel.append(el('option', { value: row.ticker, text: `${row.name} (${row.ticker})` }));
  tickerSel.value = state.ticker;
  tickerSel.addEventListener('change', () => { state.ticker = tickerSel.value; state.end = null; rebuild(); });

  const rangeBtns = {};
  const rangeRow = el('div.row');
  for (const r of RANGES) {
    const b = el('button.btn', { text: r.label, onclick: () => { state.range = r.id; rebuild(); } });
    rangeBtns[r.id] = b;
    rangeRow.append(b);
  }

  const unitBtns = {};
  const unitRow = el('div.row');
  for (const u of UNITS) {
    const b = el('button.btn', { text: u.label, onclick: () => { state.unit = u.id; rebuild(); } });
    unitBtns[u.id] = b;
    unitRow.append(b);
  }

  const endInput = el('input', { type: 'date' });
  endInput.addEventListener('change', () => { state.end = endInput.value || null; rebuild(); });

  const logToggle = (() => {
    const input = el('input', { type: 'checkbox' });
    input.addEventListener('change', () => {
      state.logScale = input.checked;
      if (chart) chart.setLogScale(state.logScale);
    });
    return el('label.toggle', null, [input, '로그 스케일']);
  })();

  const toolBar = el('div.row');
  const TOOL_LABELS = {
    levels: ['지지·저항선', COLORS.support],
    fib: ['피보나치 되돌림', COLORS.fib],
    profile: ['매물대', COLORS.bbMid],
    rs: ['상대강도 (지수 대비)', COLORS.ma200],
  };
  for (const [key, [label, color]] of Object.entries(TOOL_LABELS)) {
    const input = el('input', { type: 'checkbox' });
    input.addEventListener('change', () => { state.tools[key] = input.checked; rebuild(); });
    toolBar.append(el('label.toggle', null, [input, el('span.swatch', { style: { background: color } }), label]));
  }

  const oscBar = el('div.row');
  for (const [id, def] of Object.entries(OSCILLATORS)) {
    const input = el('input', { type: 'checkbox', checked: !!state.oscillators[id] });
    input.addEventListener('change', () => { state.oscillators[id] = input.checked; rebuild(); });
    oscBar.append(el('label.toggle', null, [input, def.name]));
  }

  // 지표 파라미터
  const paramRow = el('div.row.params');
  function numInput(label, get, set, min, max, step = 1) {
    const input = el('input.num-input', { type: 'number', min, max, step, value: get() });
    input.addEventListener('change', () => {
      const v = Number(input.value);
      if (!Number.isFinite(v) || v < min || v > max) { input.value = get(); return; }
      set(v);
      rebuild();
    });
    return el('label.param', null, [el('span', { text: label }), input]);
  }
  paramRow.append(
    numInput('단기 MA', () => state.params.ma.ma5, (v) => (state.params.ma.ma5 = v), 2, 60),
    numInput('중기 MA', () => state.params.ma.ma20, (v) => (state.params.ma.ma20 = v), 3, 120),
    numInput('장기 MA', () => state.params.ma.ma60, (v) => (state.params.ma.ma60 = v), 5, 250),
    numInput('볼린저 기간', () => state.params.bb.period, (v) => (state.params.bb.period = v), 5, 100),
    numInput('볼린저 배수 σ', () => state.params.bb.mult, (v) => (state.params.bb.mult = v), 0.5, 4, 0.5)
  );

  // ── 그리기 ────────────────────────────────────────────
  async function rebuild() {
    const stock = await loadStock(state.ticker);
    const all = resample(stock.candles, state.unit);

    let lastIdx = all.length - 1;
    if (state.end) while (lastIdx > 0 && all[lastIdx].date > state.end) lastIdx--;

    const r = RANGES.find((x) => x.id === state.range);
    // 주봉·월봉은 같은 기간이라도 봉 수가 훨씬 적다
    const div = state.unit === 'week' ? 5 : state.unit === 'month' ? 21 : 1;
    const bars = r.bars === Infinity ? Infinity : Math.max(20, Math.round(r.bars / div));
    const startIdx = bars === Infinity ? 0 : Math.max(0, lastIdx - bars + 1);
    const view = all.slice(startIdx, lastIdx + 1);

    for (const [id, b] of Object.entries(rangeBtns)) b.classList.toggle('primary', id === state.range);
    for (const [id, b] of Object.entries(unitBtns)) b.classList.toggle('primary', id === state.unit);
    endInput.min = all[0].date;
    endInput.max = all[all.length - 1].date;
    if (!state.end) endInput.value = all[lastIdx].date;

    // 차트는 매번 새로 만든다 — 오실레이터 패널 구성이 바뀌면 시간축 동기화도 다시 걸어야 한다
    destroyViewer();
    chart = createStockChart(box, { width: box.clientWidth, height: box.clientHeight, logScale: state.logScale });
    chart.setParams(state.params);
    chart.setOverlays(overlays);
    chart.setCandles(view);

    // 지지·저항선
    if (state.tools.levels) {
      const levels = supportResistance(view, { window: 5, tolerancePct: 1.5, minTouches: 2, maxLevels: 6 });
      chart.setPriceLines('levels', levels.map((l) => ({
        price: l.price,
        color: l.kind === 'support' ? COLORS.support : COLORS.resistance,
        title: `${l.kind === 'support' ? '지지' : '저항'} ${l.touches}회`,
      })));
      renderLevels(levels, stock.currency);
    } else {
      chart.setPriceLines('levels', []);
      clear(levelList);
    }

    // 피보나치 되돌림
    if (state.tools.fib) {
      const swing = dominantSwing(view, view.length);
      const fib = fibonacci(view, swing.fromIdx, swing.toIdx);
      chart.setPriceLines('fib', fib.levels.map((l) => ({
        price: l.price,
        color: COLORS.fib,
        style: l.ratio === 0 || l.ratio === 1 ? 0 : 2,
        title: l.label,
      })));
    } else {
      chart.setPriceLines('fib', []);
    }

    // 매물대
    clear(profileBox);
    profileBox.style.display = state.tools.profile ? '' : 'none';
    if (state.tools.profile) renderProfile(view, stock.currency);

    // 상대강도 (지수 대비)
    if (state.tools.rs) {
      const bench = await loadStock(defaultBenchmark(stock.market));
      const benchView = resample(bench.candles, state.unit);
      const rs = relativeStrength(view, benchView);
      chart.drawSegment(
        'rs',
        view.map((c, i) => ({ date: c.date, value: rs[i] })).filter((p) => p.value != null),
        COLORS.ma200
      );
    } else {
      chart.dropLine('rs');
    }

    chart.setMarkers([]);
    chart.fit();

    // 오실레이터 패널
    clear(panelWrap);
    const charts = [chart.chart];
    for (const [id, on] of Object.entries(state.oscillators)) {
      if (!on) continue;
      const def = OSCILLATORS[id];
      const head = el('div.panel-head', null, [
        el('span', { text: def.name }),
        el('a.small.muted', { href: `#/learn/${def.lesson}`, text: '설명 보기' }),
      ]);
      const pbox = el('div.osc-box', { style: { height: def.height + 'px' } });
      panelWrap.append(el('div.osc-wrap', null, [head, pbox]));
      const panel = createOscillatorPanel(pbox, def, view);
      panels.push(panel);
      panel.fit();
      charts.push(panel.chart);
    }
    if (charts.length > 1) unsync = syncTimeScales(charts);

    renderMeta(stock, view);
  }

  function renderMeta(stock, view) {
    const first = view[0];
    const last = view[view.length - 1];
    const change = ((last.close - first.close) / first.close) * 100;
    let hi = -Infinity;
    let lo = Infinity;
    let vol = 0;
    for (const c of view) { if (c.high > hi) hi = c.high; if (c.low < lo) lo = c.low; vol += c.volume; }

    // 최고점 대비 최대 낙폭
    let peak = view[0].high;
    let mdd = 0;
    for (const c of view) {
      if (c.high > peak) peak = c.high;
      const dd = ((c.low - peak) / peak) * 100;
      if (dd < mdd) mdd = dd;
    }

    const unitLabel = UNITS.find((u) => u.id === state.unit).label;
    clear(meta).append(
      el('strong', { style: { fontSize: '18px' }, text: stock.name }),
      el('span.muted.small', { text: `${stock.ticker} · ${first.date} ~ ${last.date} · ${view.length}${unitLabel[0]}봉` })
    );

    const stat = (label, value, cls) =>
      el('div.stat', null, [el('span', { text: label }), el('b', { class: cls || '', text: value })]);

    clear(stats).append(
      stat('구간 등락률', signed(change), dirClass(change)),
      stat('마지막 종가', fmt(last.close, stock.currency)),
      stat('구간 최고가', fmt(hi, stock.currency), 'up'),
      stat('구간 최저가', fmt(lo, stock.currency), 'down'),
      stat('최대 낙폭', signed(mdd), 'down'),
      stat('평균 거래량', Math.round(vol / view.length).toLocaleString('ko-KR'), 'muted')
    );
  }

  function renderLevels(levels, currency) {
    clear(levelList).append(
      el('h4', { style: { margin: '0 0 8px', fontSize: '13px', color: COLORS.support }, text: '자동으로 찾은 지지·저항 가격대' }),
      (() => {
        const dl = el('dl.kv');
        for (const l of levels) {
          dl.append(
            el('dt', null, [el('span', { class: l.kind === 'support' ? 'up' : 'down', text: l.kind === 'support' ? '지지' : '저항' }), ' ' + fmt(l.price, currency)]),
            el('dd.small.muted', { text: `${l.touches}회 반응 · 현재가 대비 ${signed(l.distancePct)} · 마지막 ${l.lastTouch}` })
          );
        }
        return dl;
      })(),
      el('p.small.muted', { style: { margin: '6px 0 0' }, text: '좌우 5봉보다 높은(낮은) 극점을 1.5% 이내로 묶어, 2회 이상 반응한 가격대만 남긴 것입니다.' })
    );
  }

  function renderProfile(view, currency) {
    const vp = volumeProfile(view, 26);
    const max = Math.max(...vp.rows.map((r) => r.volume));
    profileBox.append(el('div.profile-title', { text: '매물대' }));
    // 위쪽이 높은 가격이 되도록 뒤집어 그린다
    for (const row of [...vp.rows].reverse()) {
      const isPoc = row === vp.poc;
      profileBox.append(
        el('div.profile-row', { class: isPoc ? 'poc' : '', title: `${fmt(row.mid, currency)} · ${Math.round(row.volume).toLocaleString()}주` }, [
          el('div.profile-bar', { style: { width: (row.volume / max) * 100 + '%' } }),
          el('span.profile-label', { text: fmt(row.mid, currency) }),
        ])
      );
    }
    profileBox.append(el('div.profile-note', { text: `가장 두꺼운 구간(POC) ${fmt(vp.poc.mid, currency)}` }));
  }

  // ── 레이아웃 ──────────────────────────────────────────
  clear(app).append(
    el('h1.page-title', { text: '실제 과거 데이터 뷰어' }),
    el('p.page-sub', { text: '지표를 다 끈 상태에서 먼저 눈으로 판단해보고, 그다음 하나씩 켜서 확인하는 순서를 권합니다. 파라미터를 바꾸면 같은 구간에서도 신호가 달라진다는 점도 함께 확인해보세요.' }),

    el('div.panel', null, [
      el('div.row', null, [tickerSel, rangeRow, unitRow, el('span.spacer'), el('label.small.muted', null, ['기준일 ', endInput])]),
      el('div.row', { style: { marginTop: '12px' } }, [
        overlayBar(overlays, (next) => { Object.assign(overlays, next); if (chart) chart.setOverlays(overlays); }),
        logToggle,
      ]),
      el('div.row', { style: { marginTop: '8px' } }, [toolBar]),
      el('div.row', { style: { marginTop: '8px' } }, [oscBar]),
      el('details.param-details', null, [
        el('summary', { text: '지표 설정 직접 바꿔보기' }),
        el('p.small.muted', { style: { margin: '4px 0 10px' }, text: '기간을 바꾸면 같은 데이터에서도 교차 시점과 밴드 폭이 달라집니다. 지표의 값은 절대적인 것이 아니라 설정에 따라 달라지는 계산 결과라는 점을 확인해보세요.' }),
        paramRow,
      ]),
      meta,
      el('div.chart-with-profile', null, [el('div', { style: { minWidth: '0' } }, [box, panelWrap]), profileBox]),
      stats,
      levelList,
    ])
  );

  await rebuild();
}
