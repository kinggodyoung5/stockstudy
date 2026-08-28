/**
 * 패턴 성과 통계 탭
 *
 * 탐지된 모든 사례에는 "신호 이후 20거래일 실제 성과"가 붙어 있다.
 * 그걸 규칙 단위로 모아 한 화면에 늘어놓으면, 이름만 그럴듯한 신호와
 * 실제로 방향성이 있는 신호가 구분된다.
 *
 * 이 화면의 목적은 매매 근거를 주는 게 아니라 "신호는 확률이지 보장이 아니다"를 보여주는 것이다.
 */

import { loadPatternIndex } from '../lib/data.js';
import { confidence } from '../lib/stats.js';
import { LESSON_BY_ID } from '../content/lessons.js';
import { el, clear, signed, dirClass } from '../lib/ui.js';

const GROUP_NAMES = {
  indicator: '지표 기반',
  shape: '도형 패턴',
  oscillator: '오실레이터 · 다이버전스',
  candlestick: '캔들스틱',
};

const BIAS_NAMES = { up: '상승 신호', down: '하락 신호', none: '방향 없음' };

export function destroyStats() { /* 차트를 쓰지 않아 정리할 것이 없다 */ }

export async function renderStats(app) {
  clear(app).append(el('p.loading', { text: '통계를 불러오는 중…' }));
  const data = await loadPatternIndex();
  const base = data.baseline;

  const state = { sort: 'winRate', desc: true, group: 'all', minSamples: 20, q: '', axis: 'all', bucket: null };

  const AXES = data.axes || {};
  /** 지금 보고 있는 종목군의 기준선 (전체이면 전체 기준선) */
  const curBase = () => (state.axis === 'all' ? base : (data.axisBaselines?.[state.axis]?.[state.bucket] || null));
  /** 지금 보고 있는 종목군에서의 그 규칙 성과 */
  const curStats = (r) => (state.axis === 'all' ? { count: r.count, stats: r.stats } : (r.byAxis?.[state.axis]?.[state.bucket] || { count: 0, stats: null }));

  const tableWrap = el('div.table-wrap');

  const COLUMNS = [
    { key: 'name', label: '패턴', align: 'left' },
    { key: 'group', label: '분류', align: 'left' },
    { key: 'bias', label: '알려진 방향', align: 'left' },
    { key: 'count', label: '검출 건수', align: 'right' },
    { key: 'winRate', label: `${data.outcomeDays}일 뒤 상승 비율`, align: 'right' },
    { key: 'edge', label: '기준선 대비', align: 'right' },
    { key: 'avgChange', label: '평균 수익률', align: 'right' },
    { key: 'medianChange', label: '중앙값', align: 'right' },
    { key: 'stdev', label: '편차', align: 'right' },
  ];

  const valueOf = (row, key) => {
    if (key === 'name' || key === 'group' || key === 'bias') return row[key];
    const cur = curStats(row);
    const b = curBase();
    if (key === 'count') return cur.count;
    if (key === 'edge') return cur.stats && b ? cur.stats.winRate - b.winRate : null;
    return cur.stats ? cur.stats[key] : null;
  };

  function draw() {
    const q = state.q.trim().toLowerCase();
    const rows = data.patterns
      .filter((r) => state.group === 'all' || r.group === state.group)
      .filter((r) => curStats(r).count >= state.minSamples)
      .filter((r) => !q || (r.name + ' ' + r.summary + ' ' + r.pattern).toLowerCase().includes(q));

    rows.sort((a, b) => {
      const va = valueOf(a, state.sort);
      const vb = valueOf(b, state.sort);
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = typeof va === 'string' ? va.localeCompare(vb, 'ko') : va - vb;
      return state.desc ? -cmp : cmp;
    });

    const table = el('table.stats-table');
    const thead = el('thead');
    const htr = el('tr');
    for (const col of COLUMNS) {
      const th = el('th', {
        class: (col.align === 'right' ? 'num ' : '') + (state.sort === col.key ? 'sorted' : ''),
        text: col.label + (state.sort === col.key ? (state.desc ? ' ▾' : ' ▴') : ''),
        onclick: () => {
          if (state.sort === col.key) state.desc = !state.desc;
          else { state.sort = col.key; state.desc = true; }
          draw();
        },
      });
      htr.append(th);
    }
    thead.append(htr);
    table.append(thead);

    const tbody = el('tbody');
    const b = curBase();
    for (const r of rows) {
      const cur = curStats(r);
      const s = cur.stats;
      const edge = s && b ? +(s.winRate - b.winRate).toFixed(1) : null;
      const conf = confidence(cur.count);
      const lesson = LESSON_BY_ID[r.lesson];

      const nameCell = el('td', null, [
        lesson
          ? el('a', { href: `#/learn/${r.lesson}`, text: r.name })
          : el('span', { text: r.name }),
        el('div.small.muted', { text: r.summary }),
      ]);

      tbody.append(
        el('tr', { class: conf.level === 'low' ? 'dim' : '' }, [
          nameCell,
          el('td.small.muted', { text: GROUP_NAMES[r.group] || r.group }),
          el('td.small', null, [el('span', { class: 'pill ' + (r.bias === 'up' ? 'up' : r.bias === 'down' ? 'down' : ''), text: BIAS_NAMES[r.bias] })]),
          el('td.num', { text: cur.count.toLocaleString() }),
          el('td.num', { class: s ? (s.winRate >= 50 ? 'up' : 'down') : '', text: s ? s.winRate + '%' : '—' }),
          el('td.num', { class: dirClass(edge), text: edge == null ? '—' : (edge > 0 ? '+' : '') + edge + '%p' }),
          el('td.num', { class: s ? dirClass(s.avgChange) : '', text: s ? signed(s.avgChange) : '—' }),
          el('td.num', { class: s ? dirClass(s.medianChange) : '', text: s ? signed(s.medianChange) : '—' }),
          el('td.num.muted', { text: s ? s.stdev + '%p' : '—' }),
        ])
      );
    }
    table.append(tbody);
    clear(tableWrap).append(table);
    if (!rows.length) tableWrap.append(el('p.muted', { text: '조건에 맞는 패턴이 없습니다.' }));
  }

  const groupSel = el('select');
  groupSel.append(el('option', { value: 'all', text: '전체 분류' }));
  for (const [k, v] of Object.entries(GROUP_NAMES)) groupSel.append(el('option', { value: k, text: v }));
  groupSel.addEventListener('change', () => { state.group = groupSel.value; draw(); });

  const minSel = el('select');
  for (const n of [0, 20, 60, 150]) {
    minSel.append(el('option', { value: String(n), text: n === 0 ? '표본 수 제한 없음' : `${n}건 이상만` }));
  }
  minSel.value = '20';
  minSel.addEventListener('change', () => { state.minSamples = Number(minSel.value); draw(); });

  const search = el('input.search', { type: 'search', placeholder: '규칙 이름·설명으로 찾기 (예: 다이버전스, RSI, 헤드앤숄더)' });
  search.addEventListener('input', () => { state.q = search.value; draw(); });

  // ── 종목군 분류 ──────────────────────────────────────
  const axisSel = el('select');
  axisSel.append(el('option', { value: 'all', text: '전체 종목' }));
  for (const [k, def] of Object.entries(AXES)) axisSel.append(el('option', { value: k, text: def.name + '으로 나누기' }));

  const bucketRow = el('div.row', { style: { marginTop: '10px' } });
  const axisPanel = el('div.panel.axis-panel', { style: { marginTop: '18px' } });

  function drawAxis() {
    clear(bucketRow);
    clear(axisPanel);

    if (state.axis === 'all') {
      axisPanel.style.display = 'none';
      return;
    }
    axisPanel.style.display = '';
    const def = AXES[state.axis];
    if (!state.bucket || !def.keys.includes(state.bucket)) state.bucket = def.keys[0];

    for (const key of def.keys) {
      const bl = data.axisBaselines?.[state.axis]?.[key];
      const btn = el('button.btn', {
        class: key === state.bucket ? 'primary' : '',
        text: def.labels[key] + (bl ? ` · 기준선 ${bl.winRate}%` : ''),
        onclick: () => { state.bucket = key; drawAxis(); drawBase(); draw(); },
      });
      bucketRow.append(btn);
    }

    // 이 축의 기준선이 얼마나 벌어지는지가 핵심이다
    const bls = def.keys.map((k) => data.axisBaselines?.[state.axis]?.[k]).filter(Boolean);
    const spread = bls.length > 1
      ? +(Math.max(...bls.map((x) => x.winRate)) - Math.min(...bls.map((x) => x.winRate))).toFixed(1)
      : null;

    axisPanel.append(
      el('h3', { style: { margin: '0 0 4px', fontSize: '15px' }, text: def.name + ' 으로 나눈 기준선' }),
      el('p.small.muted', { style: { margin: '0 0 12px' }, text: def.why }),
      el('div.stat-row', null, def.keys.map((k) => {
        const bl = data.axisBaselines?.[state.axis]?.[k];
        const n = (data.profiles || []).filter((p) => p[state.axis] === k).length;
        return el('div.stat', { class: k === state.bucket ? 'on' : '' }, [
          el('span', { text: def.labels[k] + ` · 종목 ${n}개` }),
          el('b', { class: bl ? (bl.winRate >= base.winRate ? 'up' : 'down') : '', text: bl ? bl.winRate + '%' : '—' }),
          el('span.small.muted', { text: bl ? `평균 ${signed(bl.avgChange)}` : '' }),
        ]);
      })),
      spread != null
        ? el('p.small', { style: { margin: '12px 0 0' }, html:
            `종목군에 따라 <b>아무 날이나 샀을 때의 승률이 ${spread}%p 벌어집니다.</b> ` +
            `어떤 신호가 주로 한쪽 종목군에서만 나온다면, 그 신호의 승률은 전체 기준선이 아니라 ` +
            `<b>그 종목군의 기준선</b>과 비교해야 합니다. 위 버튼으로 종목군을 골라 표를 다시 보세요.` })
        : null
    );
  }

  axisSel.addEventListener('change', () => {
    state.axis = axisSel.value;
    state.bucket = null;
    drawAxis();
    drawBase();
    draw();
  });

  const baseCard = el('div');
  function drawBase() {
    const b = curBase();
    const label = state.axis === 'all'
      ? '전체 종목'
      : AXES[state.axis].name + ' · ' + AXES[state.axis].labels[state.bucket];
    clear(baseCard).append(
      el('h3', { style: { margin: '0 0 4px', fontSize: '15px' }, text: `먼저 기준선을 보세요 — ${label}` }),
      el('p.small.muted', { style: { margin: '0 0 12px' }, text: '같은 종목·같은 기간에서 아무 날이나 사서 20거래일 들고 있었을 때의 결과입니다. 어떤 신호의 승률은 이 숫자와 비교해야 의미가 생깁니다.' }),
      b
        ? el('div.stat-row', null, [
            el('div.stat', null, [el('span', { text: '아무 날이나 매수 시 상승 비율' }), el('b', { text: b.winRate + '%' })]),
            el('div.stat', null, [el('span', { text: '평균 수익률' }), el('b', { class: dirClass(b.avgChange), text: signed(b.avgChange) })]),
            el('div.stat', null, [el('span', { text: '중앙값' }), el('b', { class: dirClass(b.medianChange), text: signed(b.medianChange) })]),
            el('div.stat', null, [el('span', { text: '표본' }), el('b', { text: b.samples.toLocaleString() + '건' })]),
          ])
        : el('p.muted.small', { text: '이 종목군의 기준선을 계산할 수 없습니다.' })
    );
  }

  clear(app).append(
    el('h1.page-title', { text: '패턴 성과 통계' }),
    el('p.page-sub', {
      text: `${data.tickers}개 종목 · ${data.from} ~ ${data.to} 기간에서 ${data.patterns.length}개 규칙이 찾아낸 ${data.totalHits.toLocaleString()}건의 신호를, 발생 ${data.outcomeDays}거래일 뒤 결과로 집계했습니다.`,
    }),

    el('div.panel', null, [baseCard]),

    el('div.panel', { style: { marginTop: '18px' } }, [
      el('h3', { style: { margin: '0 0 4px', fontSize: '15px' }, text: '종목을 나눠서 보기' }),
      el('p.small.muted', { style: { margin: '0 0 12px' }, text:
        '모든 종목을 한 덩어리로 보면 중요한 차이가 묻힙니다. 거래가 활발한 종목과 한산한 종목, 잘 흔들리는 종목과 얌전한 종목은 같은 신호에도 다르게 반응합니다.' }),
      el('div.row', null, [axisSel]),
      bucketRow,
    ]),

    axisPanel,

    el('div.panel', { style: { marginTop: '18px' } }, [
      el('div.row', { style: { marginBottom: '14px' } }, [
        search, groupSel, minSel,
        el('span.spacer'),
        el('span.small.muted', { text: '열 제목을 누르면 정렬됩니다' }),
      ]),
      tableWrap,
    ]),

    el('div.panel.caution', { style: { marginTop: '18px' } }, [
      el('h3', { style: { margin: '0 0 8px', fontSize: '15px' }, text: '이 표를 읽을 때 반드시 감안할 것' }),
      el('ul.small', { style: { margin: '0', paddingLeft: '20px' } }, [
        el('li', { text: '매매 전략의 백테스트가 아닙니다. 수수료·세금·슬리피지·분산투자·자금관리가 전혀 반영돼 있지 않습니다.' }),
        el('li', { text: `종목이 ${data.tickers}개입니다. 고점 대비 크게 밀린 종목과 오래 부진한 종목을 일부러 섞었지만, 여전히 '지금까지 상장을 유지한 회사들'만 들어 있습니다. 같은 기간에 상장폐지된 회사는 한 곳도 없습니다 (생존 편향). 실제보다 낙관적인 숫자라고 보는 편이 맞습니다.` }),
        el('li', { text: '표본이 20건 미만인 규칙은 흐리게 표시했습니다. 승률 100%라도 3건이면 아무 의미가 없습니다.' }),
        el('li', { text: '보유 기간을 20거래일로 고정했습니다. 기간을 바꾸면 순위가 달라집니다.' }),
        el('li', { text: '같은 데이터로 57개 규칙을 한꺼번에 평가하면, 순전히 우연으로 좋아 보이는 규칙이 몇 개는 나오게 돼 있습니다. 상위권 규칙을 곧바로 믿지 마세요.' }),
      ]),
    ])
  );

  drawAxis();
  drawBase();
  draw();
}
