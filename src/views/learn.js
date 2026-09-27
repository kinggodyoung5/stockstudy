/**
 * 개념 학습 탭 (설명서 5.1)
 * 개념 설명 → 판정 기준 공개 → 실제 성과 통계 → 탐지 엔진이 찾아낸 사례 차트 → 근거 수치 → 이후 실제 결과
 */

import { LESSONS, LESSON_BY_ID, LESSON_GROUPS } from '../content/lessons.js';
import { FIGURES, emphasize } from '../content/figures.js';
import { LESSON_SETTINGS, SRC_LABEL, SRC_NOTE } from '../content/settings.js';
import { loadPattern, loadStock, sliceByDate } from '../lib/data.js';
import { createStockChart, createOscillatorPanel, syncTimeScales, COLORS } from '../lib/chart.js';
import { OSCILLATORS } from '../lib/oscillators.js';
import { confidence, directionalEdge } from '../lib/stats.js';
import { el, clear, formatEvidence, signed, dirClass, qualityNotice } from '../lib/ui.js';
import { pickCases, invalidCandles } from '../lib/chart-data.js';

let charts = [];

function destroyCharts() {
  charts.reverse().forEach((c) => {
    try { c.destroy(); } catch (_) { /* 이미 제거됨 */ }
  });
  charts = [];
}

/**
 * 성과를 신호일이 아니라 "확인일"부터 잰 규칙에 붙는 안내.
 *
 * 판정에 뒷날 봉이 필요한 규칙이 있다. 그 사실을 감추면 승률이 부풀려지고,
 * 읽는 사람은 실제로는 잡을 수 없었던 수익을 신호의 성과로 오해하게 된다.
 */
function confirmNote(meta) {
  if (!meta.confirm) return el('span');
  return el('p.confirm-note', null, [
    el('b', { text: `성과는 신호 ${meta.confirm.lag}거래일 뒤부터 쟀습니다. ` }),
    document.createTextNode(meta.confirm.why),
  ]);
}

function outcomeCard(hit) {
  const o = hit.outcome;
  if (!o) return el('p.muted.small', { text: '이후 데이터가 부족해 결과를 확인할 수 없습니다.' });

  const dl = el('dl.kv');
  const rows = [
    [`${o.days}거래일 뒤 종가 변화`, el('span', { class: dirClass(o.changePct), text: signed(o.changePct) })],
    ['기준 종가 대비 최고가 변화', el('span', { class: dirClass(o.maxUpPct), text: signed(o.maxUpPct) })],
    ['기준 종가 대비 최저가 변화', el('span', { class: dirClass(o.maxDownPct), text: signed(o.maxDownPct) })],
    [hit.confirmLag ? `성과 측정 구간 (신호 ${hit.confirmLag}거래일 뒤부터)` : '성과 측정 구간',
      `${o.fromDate} → ${o.toDate}`],
  ];
  for (const [k, v] of rows) dl.append(el('dt', { text: k }), el('dd', null, [v]));
  return el('div', null, [dl, el('p.small.muted', { text: '두 극값은 발생 순서나 실현 수익을 뜻하지 않습니다. 최대 낙폭과도 다른 값입니다.' }),
    o.days < 20 ? el('p.small.warn', { text: `관찰 기간 부족: ${o.days}거래일만 있습니다. 20거래일 결과와 직접 비교하지 마세요.` }) : null]);
}

/** 탐지 결과에 담긴 shape 정보를 차트 위에 그린다 */
function drawShape(c, hit, patternName) {
  const s = hit.shape;
  const markers = hit.confirmDate && hit.confirmDate !== hit.date
    ? [{ date: hit.confirmDate, position: 'belowBar', color: COLORS.ma60, shape: 'circle', text: '판정 확인일' }]
    : [];

  if (!s) {
    markers.push({ date: hit.date, position: 'aboveBar', color: COLORS.neckline, shape: 'arrowDown', text: patternName });
    if (hit.highlight && hit.highlight.length > 1) {
      // 캔들 패턴은 관련된 봉 전체를 표시
      for (const d of hit.highlight.slice(0, -1)) {
        markers.push({ date: d, position: 'belowBar', color: COLORS.bbMid, shape: 'circle', text: '' });
      }
    }
    c.setMarkers(markers);
    return;
  }

  if (s.leftShoulder) {
    markers.push(
      { date: s.leftShoulder.date, position: 'aboveBar', color: COLORS.bbMid, shape: 'circle', text: '왼쪽 어깨' },
      { date: s.head.date, position: 'aboveBar', color: COLORS.warn, shape: 'circle', text: '머리' },
      { date: s.rightShoulder.date, position: 'aboveBar', color: COLORS.bbMid, shape: 'circle', text: '오른쪽 어깨' }
    );
  }
  if (s.peaks) {
    s.peaks.forEach((p, i) => {
      markers.push({ date: p.date, position: 'aboveBar', color: COLORS.warn, shape: 'circle', text: String(i + 1) });
    });
  }
  if (s.neckline) c.drawSegment('neckline', s.neckline, COLORS.neckline);
  if (s.upper) c.drawSegment('upperLine', s.upper, COLORS.resistance);
  if (s.lower) c.drawSegment('lowerLine', s.lower, COLORS.support);
  if (s.pole) c.drawSegment('pole', s.pole, COLORS.warn);
  if (s.divergence) c.drawSegment('divPrice', s.divergence.price, COLORS.neckline);
  if (s.breakout) {
    markers.push({ date: s.breakout.date, position: 'belowBar', color: COLORS.neckline, shape: 'arrowUp', text: '돌파/이탈' });
  }
  if (!markers.some((m) => m.date === hit.date)) {
    markers.push({ date: hit.date, position: 'aboveBar', color: COLORS.neckline, shape: 'arrowDown', text: patternName });
  }
  c.setMarkers(markers);
}

/**
 * "이 앱이 쓴 설정값" 박스.
 * 같은 지표라도 설정에 따라 신호가 달라지므로, 무슨 값을 썼고 그게 표준인지
 * 이 앱이 정한 것인지를 밝힌다.
 */
function settingsBox(lessonId) {
  const cfg = LESSON_SETTINGS[lessonId];
  if (!cfg || !cfg.rows || !cfg.rows.length) return null;

  const table = el('table.settings-table');
  const tbody = el('tbody');
  for (const [k, v, src] of cfg.rows) {
    tbody.append(el('tr', null, [
      el('td.set-k', { text: k }),
      el('td.set-v', { text: v }),
      el('td.set-src', null, [el('span', { class: 'src src-' + src, title: SRC_NOTE[src], text: SRC_LABEL[src] })]),
    ]));
  }
  table.append(tbody);

  const used = [...new Set(cfg.rows.map((r) => r[2]))];

  return el('div.rulebox.settings', null, [
    el('h3', { text: '이 앱이 쓴 설정값' }),
    el('p.why', { text: '같은 지표라도 설정을 바꾸면 신호가 달라집니다. 그래서 무슨 값을 썼는지, 그 값이 어디서 온 것인지 밝혀둡니다.' }),
    table,
    el('ul.src-legend', null, used.map((sc) =>
      el('li', null, [el('span', { class: 'src src-' + sc, text: SRC_LABEL[sc] }), ' ' + SRC_NOTE[sc]])
    )),
    cfg.effect ? el('div.set-effect', null, [
      el('h4', { text: '이 값을 바꾸면' }),
      ...String(cfg.effect).split('\n\n').map((para) => el('p', { html: emphasize(para) })),
    ]) : null,
    cfg.fig && FIGURES[cfg.fig] ? figureEl(cfg.fig) : null,
    cfg.tryIt ? el('p.set-try', null, [
      el('a.btn', { href: '#/viewer', text: '데이터 뷰어에서 바꿔보기' }),
      el('span.small.muted', { text: ' ' + cfg.tryIt }),
    ]) : null,
  ]);
}

/** 개념 설명용 모식도 한 장 */
export function figureEl(id, opts) {
  const f = FIGURES[id];
  return el('figure.fig', null, [
    el('div.fig-svg', { html: f.svg(opts) }),
    el('figcaption', { text: f.caption }),
  ]);
}

async function renderCase(hit, lesson, patternMeta) {
  const stock = await loadStock(hit.ticker);
  const view = sliceByDate(stock.candles, hit.fromDate, hit.toDate);
  const history = sliceByDate(stock.candles, null, hit.toDate);
  const bad = invalidCandles(view);

  const box = el('div.chart-box');
  const oscillator = patternMeta.pattern?.startsWith('macd-') ? 'macd' : lesson.oscillator;
  const oscDef = oscillator ? OSCILLATORS[oscillator] : null;
  const oscBox = oscDef ? el('div.osc-box', { style: { height: oscDef.height + 'px' } }) : null;

  const card = el('div.case', null, [
    el('div.case-head', null, [
      el('span.ticker', { text: `${hit.name} (${hit.ticker})` }),
      el('span.date', { text: `신호일 ${hit.date}${hit.confirmDate && hit.confirmDate !== hit.date ? ' / 확인일 ' + hit.confirmDate : ''}` }),
      el('span.spacer'),
      el('span.pill', { text: patternMeta.name }),
    ]),
    el('div.case-body', null, [
      bad.length ? el('p.warn', { text: `표시 구간에 정합성 오류가 있는 봉 ${bad.length}개가 있습니다 (첫 날짜 ${bad[0].date}). 잘못된 모양을 학습하지 않도록 차트를 보류합니다. 원자료와 저장 통계는 아직 수정되지 않았습니다.` }) : box,
      bad.length ? null : oscBox,
    ]),
    el('div.case-foot', null, [
      el('div', null, [
        el('h4', { text: '이 사례가 규칙을 만족한 근거' }),
        (() => {
          const dl = el('dl.kv');
          for (const e of hit.evidence) {
            dl.append(el('dt', { text: e.label }), el('dd', { text: formatEvidence(e, hit.currency) }));
          }
          return dl;
        })(),
      ]),
      el('div', null, [
        el('h4', { text: '그 이후 실제로 어떻게 됐나 (사실 확인)' }),
        outcomeCard(hit),
        el('p.muted.small', {
          style: { marginTop: '10px', marginBottom: '0' },
          text: '이 차트는 이후 결과를 포함한 복습용입니다. 판정 당시 알 수 있었던 정보와 이후에 알게 된 결과를 구분하세요. 규칙을 만족해도 결과는 달라집니다.',
        }),
      ]),
    ]),
  ]);

  // 차트는 카드가 DOM에 붙은 뒤에 만들어야 컨테이너 크기를 잡을 수 있다.
  const owned = [];
  card.dispose = () => {
    for (const item of owned.splice(0).reverse()) {
      try { item.destroy(); } catch (_) { /* 이미 정리됨 */ }
      charts = charts.filter((c) => c !== item);
    }
  };
  const own = (item) => { owned.push(item); charts.push(item); };
  card.mountChart = () => {
    if (!box.isConnected) return;
    const c = createStockChart(box, { width: box.clientWidth, height: box.clientHeight });
    own(c);
    c.setOverlays(lesson.overlays || {});
    c.setCandles(view, history);
    drawShape(c, hit, patternMeta.name);
    c.fit();

    if (oscDef && oscBox.isConnected) {
      oscBox.setAttribute('aria-label', oscDef.name);
      const panel = createOscillatorPanel(oscBox, oscDef, view, undefined, history);
      own(panel);
      panel.fit();
      const unsync = syncTimeScales([c.chart, panel.chart]);
      own({ destroy: unsync });
    }
  };

  return card;
}

/** 승률·평균수익률 요약 박스 */
function statsBox(meta) {
  const s = meta.stats;
  if (!s) return el('p.muted.small', { text: '성과를 계산할 사례가 없습니다.' });
  const conf = confidence(s.samples);

  const row = el('div.stat-row');
  const stat = (label, value, cls) =>
    el('div.stat', null, [el('span', { text: label }), el('b', { class: cls || '', text: value })]);

  // 레슨 본문이 계속 "기준선과 비교해보세요"라고 하므로, 비교 대상을 같은 자리에 둔다
  const base = meta.baseline;
  // 하락 신호는 상승 비율이 기준선보다 **낮아야** 맞힌 것이다. 그냥 빼면 부호가 뒤집혀 보인다.
  const hit = directionalEdge(s, base, meta.bias);
  const raw = base ? +(s.winRate - base.winRate).toFixed(1) : null;
  const edge = hit != null ? hit : raw;
  const edgeLabel = hit != null ? '방향 기준 비율 차이' : '기준선 대비';

  row.append(
    stat(`${meta.outcomeDays}일 뒤 오른 비율`, s.winRate + '%', s.winRate >= 50 ? 'up' : 'down'),
    base ? stat('5봉 간격 기준선', base.winRate + '%', 'muted') : null,
    edge != null ? stat(edgeLabel, (edge > 0 ? '+' : '') + edge + '%p', dirClass(edge)) : null,
    stat('평균 수익률', signed(s.avgChange), dirClass(s.avgChange)),
    stat('가장 나빴던 경우', signed(s.worst), 'down')
  );
  return el('div', null, [
    row,
    el('p.muted.small', { style: { margin: '8px 0 0' }, text:
      conf.label + ' · ' + (hit != null
        ? `이 신호의 해석 방향은 ${meta.bias === 'down' ? '하락' : '상승'}입니다. 차이는 단순 집계 비교이며 신호의 인과적 효과나 통계적 유의성을 뜻하지 않습니다.`
        : '기준선과의 차이는 단순 집계입니다. 차이가 작다고 효과가 없음을 증명한 것은 아닙니다.') }),
    el('p.muted.small', { style: { margin: '4px 0 0' }, text:
      `20거래일을 모두 관측한 ${meta.observation?.complete ?? s.samples}건만 집계했습니다. 기간 부족 ${meta.observation?.partial || 0}건과 결과 없음 ${meta.observation?.pending || 0}건은 제외했습니다. 표본 구간은 겹칠 수 있으며 거래비용·청산 규칙·통계적 유의성 검정은 포함하지 않습니다.` }),
  ]);
}

async function renderPatternSection(root, patternId, lesson) {
  const meta = await loadPattern(patternId);
  if (!root.isConnected) return;
  const section = el('div', { style: { marginTop: '30px' } });
  root.append(section);

  const shuffleBtn = el('button.btn', { text: '다른 사례 보기' });
  section.append(
    el('div.row', { style: { marginBottom: '10px' } }, [
      el('h3', { style: { fontSize: '17px', margin: '0' }, text: meta.name }),
      el('span.pill', { class: meta.bias === 'up' ? 'up' : meta.bias === 'down' ? 'down' : '', text: `전체 ${meta.count.toLocaleString()}건 검출` }),
      el('span.spacer'),
      shuffleBtn,
    ])
  );

  section.append(
    qualityNotice(meta),
    el('div.rulebox', null, [
      el('h3', { text: '판정 기준 (이 조건을 전부 만족해야 사례로 인정)' }),
      el('p.why', { text: meta.summary }),
      (() => {
        const ol = el('ol');
        meta.rules.forEach((r) => ol.append(el('li', { text: r })));
        return ol;
      })(),
      el('h3', { style: { marginTop: '18px' }, text: '이 규칙 이후의 과거 집계 (참고)' }),
      confirmNote(meta),
      statsBox(meta),
    ])
  );

  const list = el('div');
  section.append(list);

  if (!meta.count) {
    list.append(el('p.muted.small', { text: '정합성을 통과한 종목에서 이 조건을 만족하는 사례가 없습니다. 관찰 범위와 앱 설정에 따른 결과이며 패턴의 효과·무효를 증명하지 않습니다.' }));
    shuffleBtn.disabled = true;
    return;
  }

  let offset = 0;
  let drawVersion = 0;
  let mounted = [];
  async function draw() {
    const version = ++drawVersion;
    mounted.forEach((card) => card.dispose());
    mounted = [];
    clear(list).append(el('p.loading', { text: '사례를 불러오는 중…' }));
    const cases = pickCases(meta.hits, 2, offset);
    const cards = [];
    for (const hit of cases) cards.push(await renderCase(hit, lesson, meta));
    if (version !== drawVersion || !list.isConnected) return;
    clear(list);
    cards.forEach((c) => list.append(c));
    // requestAnimationFrame 은 탭이 화면에 보이지 않으면 실행되지 않으므로 동기적으로 만든다
    cards.forEach((c) => c.mountChart());
    mounted = cards;
    if (meta.sampled) {
      list.append(el('p.muted.small', {
        text: `검출 ${meta.count.toLocaleString()}건 중 종목·시기별로 분산한 ${meta.hits.length}건을 예시로 저장했습니다. 통계는 예시만이 아니라 전체 검출 중 20거래일 완전 관측 사례로 계산했습니다.`,
      }));
    }
  }

  shuffleBtn.addEventListener('click', () => { offset += 2; draw(); });
  await draw();
}

/**
 * 레슨 본문에 넣는 작은 표.
 *
 * 본문에서 말로 늘어놓으면 안 읽히는 비교(같은 지표를 설정만 바꿔 잰 결과 같은 것)를
 * 표로 보여준다. 데이터에서 계산한 값이 아니라 본문에 적어 둔 값이므로,
 * 데이터를 다시 만들었으면 이 숫자도 같이 고쳐야 한다.
 *
 * @param {{ head: string[], rows: (string|number)[][], note?: string }} t
 */
function lessonTable(t) {
  const table = el('table.lesson-table');
  table.append(el('thead', null, [
    el('tr', null, t.head.map((h, i) => el(i ? 'th.num' : 'th', { text: h }))),
  ]));
  const tbody = el('tbody');
  for (const row of t.rows) {
    tbody.append(el('tr', { class: /★/.test(String(row[0])) ? 'on' : '' }, row.map((c, i) =>
      el(i ? 'td.num' : 'td', { text: String(c).replace(' ★', '') })
    )));
  }
  table.append(tbody);
  return el('div', null, [table, t.note ? el('p.small.muted', { text: t.note }) : null]);
}

export async function renderLearn(app, params) {
  destroyCharts();
  const lessonId = params[0] && LESSON_BY_ID[params[0]] ? params[0] : LESSONS[0].id;
  const lesson = LESSON_BY_ID[lessonId];

  const nav = el('nav.lesson-nav');
  for (const g of LESSON_GROUPS) {
    const items = LESSONS.filter((l) => l.group === g.id);
    if (!items.length) continue;
    nav.append(el('span.nav-group', { text: g.name }));
    for (const l of items) {
      nav.append(el('a', { href: `#/learn/${l.id}`, class: l.id === lessonId ? 'on' : '', text: l.title }));
    }
  }

  const content = el('article.lesson');
  content.append(el('h2', { text: lesson.title }), el('p.tagline', { text: lesson.tagline }));
  content.append(el('div.rulebox', null, [
    el('h3', { text: '읽고 나서 설명할 수 있나요?' }),
    el('p', { text: '① 무엇을 관찰했나? ② 어떤 설정과 조건으로 판단했나? ③ 무엇은 아직 알 수 없나? 결과가 오른 것과 판단 근거가 타당한 것은 따로 확인합니다.' }),
    el('a.btn', { href: '#/practice', text: '기초 읽기 연습으로 확인' }),
  ]));
  for (const sec of lesson.body) {
    const node = el('section', null, [
      el('h3', { text: sec.h }),
      el('p', { html: emphasize(sec.p) }),
    ]);
    if (sec.table) node.append(lessonTable(sec.table));
    if (sec.fig && FIGURES[sec.fig]) node.append(figureEl(sec.fig));
    content.append(node);
  }

  const setBox = settingsBox(lessonId);
  if (setBox) content.append(setBox);

  clear(app).append(el('div.learn', null, [nav, content]));

  if (!lesson.patterns.length) {
    content.append(
      el('div.rulebox', { style: { marginTop: '28px' } }, [
        el('h3', { text: '직접 읽고 설명하는 연습' }),
        el('p.why', { text: '이 레슨은 자동 탐지 사례 대신 기초 연습과 데이터 뷰어에서 확인합니다. 용어를 외우는 데서 끝내지 말고, 관찰한 사실과 해석을 나눠 적어보세요.' }),
        el('a.btn', { href: '#/viewer', text: '데이터 뷰어에서 열어보기' }),
      ])
    );
    return;
  }

  for (const pid of lesson.patterns) {
    try {
      await renderPatternSection(content, pid, lesson);
    } catch (err) {
      content.append(
        el('div.error', { style: { marginTop: '20px' } }, [
          el('b', { text: `${pid} 사례를 불러오지 못했습니다. ` }),
          el('span.small', { text: '탐지 결과를 생성하려면 node tools/build-patterns.mjs 를 실행하세요. (' + err.message + ')' }),
        ])
      );
    }
  }
}

export { destroyCharts };
