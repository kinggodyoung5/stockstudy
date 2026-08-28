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

  const state = { sort: 'winRate', desc: true, group: 'all', minSamples: 20 };

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
    if (key === 'count') return row.count;
    if (key === 'edge') return row.stats && base ? row.stats.winRate - base.winRate : null;
    return row.stats ? row.stats[key] : null;
  };

  function draw() {
    const rows = data.patterns
      .filter((r) => state.group === 'all' || r.group === state.group)
      .filter((r) => r.count >= state.minSamples);

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
    for (const r of rows) {
      const s = r.stats;
      const edge = s && base ? +(s.winRate - base.winRate).toFixed(1) : null;
      const conf = confidence(r.count);
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
          el('td.num', { text: r.count.toLocaleString() }),
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

  clear(app).append(
    el('h1.page-title', { text: '패턴 성과 통계' }),
    el('p.page-sub', {
      text: `${data.tickers}개 종목 · ${data.from} ~ ${data.to} 기간에서 ${data.patterns.length}개 규칙이 찾아낸 ${data.totalHits.toLocaleString()}건의 신호를, 발생 ${data.outcomeDays}거래일 뒤 결과로 집계했습니다.`,
    }),

    el('div.panel', null, [
      el('h3', { style: { margin: '0 0 4px', fontSize: '15px' }, text: '먼저 기준선을 보세요' }),
      el('p.small.muted', { style: { margin: '0 0 12px' }, text: '같은 종목·같은 기간에서 아무 날이나 사서 20거래일 들고 있었을 때의 결과입니다. 어떤 신호의 승률은 이 숫자와 비교해야 의미가 생깁니다.' }),
      base
        ? el('div.stat-row', null, [
            el('div.stat', null, [el('span', { text: '아무 날이나 매수 시 상승 비율' }), el('b', { text: base.winRate + '%' })]),
            el('div.stat', null, [el('span', { text: '평균 수익률' }), el('b', { class: dirClass(base.avgChange), text: signed(base.avgChange) })]),
            el('div.stat', null, [el('span', { text: '중앙값' }), el('b', { class: dirClass(base.medianChange), text: signed(base.medianChange) })]),
            el('div.stat', null, [el('span', { text: '표본' }), el('b', { text: base.samples.toLocaleString() + '건' })]),
          ])
        : el('p.muted.small', { text: '기준선 데이터가 없습니다. tools/build-patterns.html 을 다시 실행하세요.' }),
    ]),

    el('div.panel', { style: { marginTop: '18px' } }, [
      el('div.row', { style: { marginBottom: '14px' } }, [
        groupSel, minSel,
        el('span.spacer'),
        el('span.small.muted', { text: '열 제목을 누르면 정렬됩니다' }),
      ]),
      tableWrap,
    ]),

    el('div.panel.caution', { style: { marginTop: '18px' } }, [
      el('h3', { style: { margin: '0 0 8px', fontSize: '15px' }, text: '이 표를 읽을 때 반드시 감안할 것' }),
      el('ul.small', { style: { margin: '0', paddingLeft: '20px' } }, [
        el('li', { text: '매매 전략의 백테스트가 아닙니다. 수수료·세금·슬리피지·분산투자·자금관리가 전혀 반영돼 있지 않습니다.' }),
        el('li', { text: `종목이 ${data.tickers}개뿐이고, 전부 지금 시점에서 잘 알려진 회사들입니다. 같은 기간에 사라진 회사들은 목록에 없습니다 (생존 편향). 그래서 대부분의 신호가 기준선처럼 플러스로 나옵니다.` }),
        el('li', { text: '표본이 20건 미만인 규칙은 흐리게 표시했습니다. 승률 100%라도 3건이면 아무 의미가 없습니다.' }),
        el('li', { text: '보유 기간을 20거래일로 고정했습니다. 기간을 바꾸면 순위가 달라집니다.' }),
        el('li', { text: '같은 데이터로 57개 규칙을 한꺼번에 평가하면, 순전히 우연으로 좋아 보이는 규칙이 몇 개는 나오게 돼 있습니다. 상위권 규칙을 곧바로 믿지 마세요.' }),
      ]),
    ])
  );

  draw();
}
