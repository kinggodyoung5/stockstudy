/**
 * 가상 차트 탭 (설명서 5.3 + 확장)
 *
 * 두 가지를 한다.
 *  1) GBM으로 만든 가짜 주가를 보여준다 — 실제 종목이 아니므로 선입견 없이 형태만 볼 수 있다.
 *  2) **그 가짜 데이터에 실제 탐지 엔진 57개 규칙을 그대로 돌린다.**
 *
 * 2번이 이 탭의 핵심이다. 앱 전체가 "신호는 확률이지 보장이 아니다"라고 말하는데,
 * 추세도 기억도 없는 순수 난수에서 골든크로스와 헤드앤숄더가 몇 개나 나오는지
 * 직접 세어보는 것보다 확실한 근거는 없다.
 */

import { generateCandles, makeRandom } from '../lib/gbm.js';
import { createStockChart, createOscillatorPanel, syncTimeScales } from '../lib/chart.js';
import { OSCILLATORS } from '../lib/oscillators.js';
import { detectStock, ALL_PATTERNS, PATTERN_GROUPS } from '../lib/engine.js';
import { summarize, baseline } from '../lib/stats.js';
import { loadPatternIndex } from '../lib/data.js';
import { el, clear, overlayBar, signed, dirClass } from '../lib/ui.js';

let chart = null;
let panels = [];
let unsync = null;

export function destroySandbox() {
  if (unsync) { try { unsync(); } catch (_) {} unsync = null; }
  panels.forEach((p) => { try { p.destroy(); } catch (_) {} });
  panels = [];
  if (chart) { try { chart.destroy(); } catch (_) {} chart = null; }
}

export async function renderSandbox(app) {
  destroySandbox();

  const params = { days: 250, volatility: 0.35, drift: 0.08, start: 10000, seed: Math.floor(Math.random() * 1e9) };
  const overlays = { ma5: true, ma20: true, ma60: false, bollinger: false, ichimoku: false, volume: true };
  const oscState = { rsi: false, macd: false, stochastic: false, atr: false, adx: false, obv: false };

  const box = el('div.chart-box.tall');
  const panelWrap = el('div.panels');
  const stats = el('div.stat-row');
  const seedLabel = el('span.muted.small');

  // ── 파라미터 슬라이더 ─────────────────────────────────
  const sliders = [
    { key: 'days', label: '기간 (캔들 개수)', min: 60, max: 750, step: 10, format: (v) => `${v}봉` },
    { key: 'volatility', label: '변동성 (연 기준)', min: 5, max: 100, step: 1, scale: 100, format: (v) => `${(v * 100).toFixed(0)}%` },
    { key: 'drift', label: '추세 강도 (연 기대수익률)', min: -50, max: 60, step: 1, scale: 100, format: (v) => `${(v * 100).toFixed(0)}%` },
  ];
  const controls = el('div.controls');
  for (const s of sliders) {
    const valEl = el('span.val', { text: s.format(params[s.key]) });
    const input = el('input', {
      type: 'range', min: s.min, max: s.max, step: s.step,
      value: s.scale ? params[s.key] * s.scale : params[s.key],
    });
    input.addEventListener('input', () => {
      params[s.key] = s.scale ? Number(input.value) / s.scale : Number(input.value);
      valEl.textContent = s.format(params[s.key]);
      draw();
    });
    controls.append(el('div.control', null, [el('label', null, [s.label + ' ', valEl]), input]));
  }

  const oscBar = el('div.row');
  for (const [id, def] of Object.entries(OSCILLATORS)) {
    const input = el('input', { type: 'checkbox' });
    input.addEventListener('change', () => { oscState[id] = input.checked; draw(); });
    oscBar.append(el('label.toggle', null, [input, def.name]));
  }

  // ── 차트 그리기 ──────────────────────────────────────
  let current = null;

  function draw() {
    const { candles, seed } = generateCandles(params);
    current = candles;

    destroySandbox();
    chart = createStockChart(box, { width: box.clientWidth, height: box.clientHeight });
    chart.setOverlays(overlays);
    chart.setCandles(candles);
    chart.fit();

    clear(panelWrap);
    const charts = [chart.chart];
    for (const [id, on] of Object.entries(oscState)) {
      if (!on) continue;
      const def = OSCILLATORS[id];
      const pbox = el('div.osc-box', { style: { height: def.height + 'px' } });
      panelWrap.append(el('div.osc-wrap', null, [el('div.panel-head', null, [el('span', { text: def.name })]), pbox]));
      const panel = createOscillatorPanel(pbox, def, candles);
      panels.push(panel);
      panel.fit();
      charts.push(panel.chart);
    }
    if (charts.length > 1) unsync = syncTimeScales(charts);

    // 이 한 장의 가짜 차트에서 몇 개의 신호가 나오는지 즉석 집계
    const found = detectStock({ ticker: 'RANDOM', name: '가상 차트', market: 'US', currency: '', candles });
    const hitCount = Object.values(found).reduce((a, b) => a + b.length, 0);
    const kinds = Object.entries(found).filter(([, v]) => v.length).length;

    const first = candles[0].close;
    const last = candles[candles.length - 1].close;
    let peak = candles[0].high;
    let mdd = 0;
    for (const c of candles) {
      if (c.high > peak) peak = c.high;
      const dd = ((c.low - peak) / peak) * 100;
      if (dd < mdd) mdd = dd;
    }
    const total = ((last - first) / first) * 100;

    const card = (label, value, cls) =>
      el('div.stat', null, [el('span', { text: label }), el('b', { class: cls || '', text: value })]);

    clear(stats).append(
      card('전체 수익률', signed(total), dirClass(total)),
      card('최대 낙폭', signed(mdd), 'down'),
      card('캔들 수', `${candles.length}봉`, 'muted'),
      card('이 차트에서 검출된 신호', `${hitCount}건`, 'warn'),
      card('서로 다른 패턴 종류', `${kinds}종`, 'warn')
    );
    seedLabel.textContent = `seed ${seed} — 같은 seed·같은 설정이면 항상 같은 차트가 나옵니다`;
  }

  // ── 무작위 데이터 대규모 검증 ─────────────────────────
  const expResult = el('div');
  const runBtn = el('button.btn.primary', { text: '무작위 차트 200개에 57개 규칙 돌리기' });
  const expCount = el('select');
  for (const n of [50, 200, 500]) expCount.append(el('option', { value: String(n), text: `${n}개` }));
  expCount.value = '200';

  async function runExperiment() {
    const n = Number(expCount.value);
    runBtn.disabled = true;
    clear(expResult).append(el('p.loading', { text: `무작위 차트 ${n}개 생성 후 탐지 중…` }));

    // 실제 데이터 통계와 나란히 놓기 위해 미리 계산된 요약을 가져온다
    let realIndex = null;
    try { realIndex = await loadPatternIndex(); } catch (_) { /* 없으면 비교 없이 진행 */ }

    // 브라우저가 멈추지 않게 조금씩 나눠 돌린다
    const merged = {};
    const charts = [];
    const rnd = makeRandom(Date.now());
    for (let i = 0; i < n; i++) {
      const { candles } = generateCandles({
        days: 750,
        volatility: params.volatility,
        drift: 0,                                    // 추세를 0으로 둔다 — 순수 무작위
        start: 10000,
        seed: Math.floor(rnd() * 1e9),
      });
      charts.push({ candles });
      const res = detectStock({ ticker: 'R' + i, name: '가상', market: 'US', currency: '', candles });
      for (const [id, hits] of Object.entries(res)) (merged[id] = merged[id] || []).push(...hits);
      if (i % 25 === 24) await new Promise((r) => setTimeout(r, 0));
    }

    const base = baseline(charts, 20);
    const rows = Object.entries(merged)
      .map(([id, hits]) => ({ id, meta: ALL_PATTERNS[id], count: hits.length, stats: summarize(hits) }))
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count);

    const totalHits = rows.reduce((a, r) => a + r.count, 0);
    const realBase = realIndex && realIndex.baseline;
    const realById = realIndex
      ? Object.fromEntries(realIndex.patterns.map((p) => [p.pattern, p]))
      : {};

    clear(expResult).append(
      el('div.stat-row', null, [
        el('div.stat', null, [el('span', { text: '생성한 무작위 차트' }), el('b', { text: `${n}개 × 750봉` })]),
        el('div.stat', null, [el('span', { text: '검출된 신호 총합' }), el('b', { class: 'warn', text: totalHits.toLocaleString() + '건' })]),
        el('div.stat', null, [el('span', { text: '하나 이상 검출된 규칙' }), el('b', { class: 'warn', text: `${rows.length} / 57종` })]),
        el('div.stat', null, [el('span', { text: '무작위 데이터 기준선' }), el('b', { class: dirClass(base.avgChange), text: `${base.winRate}% · ${signed(base.avgChange)}` })]),
      ]),

      el('p.small', { style: { margin: '14px 0 6px' }, html:
        `추세를 <b>0%</b>로 두고 만든, 과거를 전혀 기억하지 못하는 난수 데이터입니다. ` +
        `그런데도 57개 규칙 중 <b>${rows.length}개</b>가 신호를 찾아냈고 총 <b>${totalHits.toLocaleString()}건</b>이 검출됐습니다. ` +
        `패턴이 보인다는 것 자체는 그 안에 정보가 있다는 뜻이 아닙니다.` }),

      (() => {
        const wrap = el('div.table-wrap');
        const table = el('table.stats-table');
        table.append(el('thead', null, [el('tr', null, [
          el('th', { text: '규칙' }),
          el('th.num', { text: '무작위 검출' }),
          el('th.num', { text: '무작위 승률' }),
          el('th.num', { text: '실제 데이터 승률' }),
          el('th.num', { text: '차이' }),
        ])]));
        const tbody = el('tbody');
        for (const r of rows.slice(0, 25)) {
          const real = realById[r.id];
          const rw = r.stats ? r.stats.winRate : null;
          const realW = real && real.stats ? real.stats.winRate : null;
          const diff = rw != null && realW != null ? +(realW - rw).toFixed(1) : null;
          tbody.append(el('tr', null, [
            el('td', null, [
              el('a', { href: `#/learn/${r.meta.lesson}`, text: r.meta.name }),
              el('div.small.muted', { text: r.id }),
            ]),
            el('td.num', { text: r.count.toLocaleString() }),
            el('td.num', { text: rw == null ? '—' : rw + '%' }),
            el('td.num', { text: realW == null ? '—' : realW + '%' }),
            el('td.num', { class: dirClass(diff), text: diff == null ? '—' : (diff > 0 ? '+' : '') + diff + '%p' }),
          ]));
        }
        table.append(tbody);
        wrap.append(table);
        return wrap;
      })(),

      el('p.small.muted', { style: { margin: '10px 0 0' }, text:
        rows.length > 25 ? `검출 건수 상위 25개만 표시했습니다 (전체 ${rows.length}종).` : '' }),

      el('div.panel.caution', { style: { marginTop: '16px' } }, [
        el('h3', { style: { margin: '0 0 8px', fontSize: '15px' }, text: '이 실험이 말하는 것과 말하지 않는 것' }),
        el('ul.small', { style: { margin: 0, paddingLeft: '20px' } }, [
          el('li', { text: '말하는 것: 어떤 규칙이 신호를 "찾아낸다"는 사실 자체는 아무것도 증명하지 않습니다. 정보가 0인 데이터에서도 규칙은 부지런히 신호를 만들어냅니다.' }),
          el('li', { text: '말하는 것: 무작위 데이터의 승률은 그 데이터의 기준선 근처에 머뭅니다. 실제 데이터에서 어떤 규칙의 승률이 기준선과 비슷하다면, 무작위와 구별되지 않는다는 뜻입니다.' }),
          el('li', { html: '말하지 않는 것: 실제 주가가 무작위와 <b>같다</b>는 것은 아닙니다. GBM은 실제 시장의 변동성 군집·두꺼운 꼬리·추세 지속을 재현하지 못하는 단순한 모형입니다.' }),
          el('li', { text: '"실제 데이터 승률"은 종목·기간·표본 수가 전혀 다른 집계라 엄밀한 비교가 아닙니다. 자릿수 감각을 보기 위한 참고용입니다.' }),
        ]),
      ])
    );
    runBtn.disabled = false;
  }

  runBtn.addEventListener('click', runExperiment);

  // ── 레이아웃 ─────────────────────────────────────────
  clear(app).append(
    el('h1.page-title', { text: '가상 차트 실험실' }),
    el('p.page-sub', { text: '기하 브라운 운동(GBM)으로 만든 가짜 주가입니다. 실제 종목이 아니므로 "이 모양은 원래 이런 뜻" 같은 선입견 없이 형태만 볼 수 있습니다.' }),

    el('div.panel', null, [
      controls,
      el('div.row', { style: { marginTop: '18px' } }, [
        el('button.btn.primary', { text: '다시 생성', onclick: () => { params.seed = Math.floor(Math.random() * 1e9); draw(); } }),
        overlayBar(overlays, (next) => { Object.assign(overlays, next); if (chart) chart.setOverlays(overlays); }),
      ]),
      el('div.row', { style: { marginTop: '8px' } }, [oscBar, el('span.spacer'), seedLabel]),
      el('div', { style: { marginTop: '16px' } }, [box, panelWrap]),
      stats,
    ]),

    el('div.panel', { style: { marginTop: '18px' } }, [
      el('h3', { style: { margin: '0 0 6px', fontSize: '17px' }, text: '무작위 데이터에 탐지 엔진 돌려보기' }),
      el('p.small.muted', { style: { margin: '0 0 14px' }, text:
        '추세도 기억도 없는 순수 난수 차트를 대량으로 만들어, 실제 종목에 쓰는 것과 완전히 같은 57개 규칙을 적용합니다. ' +
        '규칙 코드도, 판정 조건도 하나도 바꾸지 않습니다.' }),
      el('div.row', null, [expCount, runBtn]),
      el('div', { style: { marginTop: '16px' } }, [expResult]),
    ]),

    el('div.panel', { style: { marginTop: '18px' } }, [
      el('h3', { style: { margin: '0 0 8px', fontSize: '15px' }, text: '이렇게 써보세요' }),
      el('ul.small.muted', { style: { margin: 0, paddingLeft: '20px' } }, [
        el('li', { text: '변동성만 5% → 80%로 올려보세요. 같은 추세라도 차트가 얼마나 달라 보이는지 확인할 수 있습니다.' }),
        el('li', { text: '추세 강도를 0%로 두고 "다시 생성"을 여러 번 눌러보세요. 추세가 전혀 없는데도 위 통계의 "검출된 신호" 숫자가 0이 되는 일은 거의 없습니다.' }),
        el('li', { text: '이동평균선을 켜두고 보면, 순수 무작위 데이터에서도 골든크로스와 정배열이 그럴듯하게 나타납니다.' }),
      ]),
    ])
  );

  draw();
}
