/**
 * 실제 과거 데이터 뷰어 탭 (설명서 5.4)
 * 종목·기간을 고르고 지표를 켰다 껐다 하면서 "지표가 있을 때와 없을 때의 차이"를 직접 비교한다.
 */

import { loadIndex, loadStock, sliceByDate } from '../lib/data.js';
import { createStockChart } from '../lib/chart.js';
import { el, clear, overlayBar, fmt, signed, dirClass } from '../lib/ui.js';

let chart = null;

export function destroyViewer() {
  if (chart) { try { chart.destroy(); } catch (_) {} chart = null; }
}

const RANGES = [
  { id: '3m', label: '3개월', days: 63 },
  { id: '6m', label: '6개월', days: 126 },
  { id: '1y', label: '1년', days: 252 },
  { id: '3y', label: '3년', days: 756 },
  { id: 'all', label: '전체', days: Infinity },
];

export async function renderViewer(app) {
  destroyViewer();
  clear(app).append(el('p.loading', { text: '종목 목록을 불러오는 중…' }));

  const index = await loadIndex();
  const state = {
    ticker: index[0].ticker,
    range: '1y',
    end: null, // 기준 종료일 (null = 최신)
  };
  const overlays = { ma5: true, ma20: true, ma60: true, bollinger: false, ichimoku: false, volume: true };

  const box = el('div.chart-box.tall');
  const stats = el('div.stat-row');

  const tickerSel = el('select');
  for (const row of index) {
    tickerSel.append(el('option', { value: row.ticker, text: `${row.name} (${row.ticker})` }));
  }
  tickerSel.value = state.ticker;
  tickerSel.addEventListener('change', () => { state.ticker = tickerSel.value; state.end = null; draw(); });

  const rangeRow = el('div.row');
  const rangeBtns = {};
  for (const r of RANGES) {
    const b = el('button.btn', { text: r.label, onclick: () => { state.range = r.id; draw(); } });
    rangeBtns[r.id] = b;
    rangeRow.append(b);
  }

  const endInput = el('input', { type: 'date' });
  endInput.addEventListener('change', () => { state.end = endInput.value || null; draw(); });

  const meta = el('div.row', { style: { marginBottom: '4px' } });

  async function draw() {
    const stock = await loadStock(state.ticker);
    const all = stock.candles;

    // 기준일 이하의 마지막 봉 (기준일이 휴장일이면 그 직전 거래일)
    let lastIdx = all.length - 1;
    if (state.end) while (lastIdx > 0 && all[lastIdx].date > state.end) lastIdx--;

    const r = RANGES.find((x) => x.id === state.range);
    const startIdx = r.days === Infinity ? 0 : Math.max(0, lastIdx - r.days + 1);
    const view = all.slice(startIdx, lastIdx + 1);

    for (const [id, b] of Object.entries(rangeBtns)) b.classList.toggle('primary', id === state.range);
    endInput.min = all[0].date;
    endInput.max = all[all.length - 1].date;
    if (!state.end) endInput.value = all[lastIdx].date;

    if (!chart) chart = createStockChart(box, { width: box.clientWidth, height: box.clientHeight });
    chart.setOverlays(overlays);
    chart.setCandles(view);
    chart.setMarkers([]);
    chart.fit();

    const first = view[0];
    const last = view[view.length - 1];
    const change = ((last.close - first.close) / first.close) * 100;
    let hi = -Infinity, lo = Infinity, vol = 0;
    for (const c of view) { if (c.high > hi) hi = c.high; if (c.low < lo) lo = c.low; vol += c.volume; }

    clear(meta).append(
      el('strong', { style: { fontSize: '18px' }, text: stock.name }),
      el('span.muted.small', { text: `${stock.ticker} · ${first.date} ~ ${last.date} · ${view.length}봉` })
    );

    clear(stats).append(
      stat('구간 등락률', signed(change), dirClass(change)),
      stat('마지막 종가', fmt(last.close, stock.currency), ''),
      stat('구간 최고가', fmt(hi, stock.currency), 'up'),
      stat('구간 최저가', fmt(lo, stock.currency), 'down'),
      stat('일평균 거래량', Math.round(vol / view.length).toLocaleString('ko-KR'), 'muted')
    );
  }

  const stat = (label, value, cls) =>
    el('div.stat', null, [el('span', { text: label }), el('b', { class: cls, text: value })]);

  clear(app).append(
    el('h1.page-title', { text: '실제 과거 데이터 뷰어' }),
    el('p.page-sub', { text: '지표를 켜고 끄면서 같은 구간이 어떻게 다르게 보이는지 비교해보세요. 지표를 다 끈 상태에서 먼저 눈으로 판단해보고, 그다음에 켜서 확인하는 순서를 권합니다.' }),
    el('div.panel', null, [
      el('div.row', null, [
        tickerSel,
        rangeRow,
        el('span.spacer'),
        el('label.small.muted', null, ['기준일 ', endInput]),
      ]),
      el('div.row', { style: { marginTop: '12px' } }, [
        overlayBar(overlays, (next) => { Object.assign(overlays, next); if (chart) chart.setOverlays(overlays); }),
      ]),
      meta,
      el('div', { style: { marginTop: '6px' } }, [box]),
      stats,
    ])
  );

  draw();
}
