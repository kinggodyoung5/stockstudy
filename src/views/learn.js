/**
 * 개념 학습 탭 (설명서 5.1)
 * 개념 설명 → 판정 기준 공개 → 실제 성과 통계 → 탐지 엔진이 찾아낸 사례 차트 → 근거 수치 → 이후 실제 결과
 */

import { LESSONS, LESSON_BY_ID, LESSON_GROUPS } from '../content/lessons.js';
import { FIGURES, emphasize } from '../content/figures.js';
import { loadPattern, loadStock, sliceByDate } from '../lib/data.js';
import { createStockChart, createOscillatorPanel, syncTimeScales, COLORS } from '../lib/chart.js';
import { OSCILLATORS } from '../lib/oscillators.js';
import { confidence } from '../lib/stats.js';
import { el, clear, fmt, signed, dirClass } from '../lib/ui.js';

let charts = [];

function destroyCharts() {
  charts.forEach((c) => {
    try { c.destroy(); } catch (_) { /* 이미 제거됨 */ }
  });
  charts = [];
}

/** 사례를 종목이 겹치지 않게 돌아가며 고른다 (다양성 우선) */
function pickCases(hits, count, offset = 0) {
  const byTicker = new Map();
  for (const h of hits) {
    if (!byTicker.has(h.ticker)) byTicker.set(h.ticker, []);
    byTicker.get(h.ticker).push(h);
  }
  const buckets = [...byTicker.values()];
  const picked = [];
  let round = 0;
  while (picked.length < count && round < 60) {
    let added = false;
    for (const b of buckets) {
      const cand = b[(offset + round) % b.length];
      if (cand && !picked.includes(cand)) { picked.push(cand); added = true; }
      if (picked.length >= count) break;
    }
    if (!added) break;
    round++;
  }
  return picked;
}

/**
 * 근거 수치 표시.
 * 라벨에 %·배수·비율 같은 단위가 이미 들어있는 항목은 가격이 아니므로 통화 기호를 붙이지 않는다.
 */
const NON_PRICE = /(%|배수|비율|거래일|거래량|횟수|R²|기울기|오차)/;
function formatEvidence(e, currency) {
  if (typeof e.value !== 'number') return String(e.value);
  if (NON_PRICE.test(e.label)) return e.value.toLocaleString('ko-KR', { maximumFractionDigits: 3 });
  return fmt(e.value, currency);
}

function outcomeCard(hit) {
  const o = hit.outcome;
  if (!o) return el('p.muted.small', { text: '이후 데이터가 부족해 결과를 확인할 수 없습니다.' });

  const dl = el('dl.kv');
  const rows = [
    [`${o.days}거래일 뒤 종가 변화`, el('span', { class: dirClass(o.changePct), text: signed(o.changePct) })],
    ['기간 중 최대 상승', el('span.up', { text: signed(o.maxUpPct) })],
    ['기간 중 최대 하락', el('span.down', { text: signed(o.maxDownPct) })],
    ['확인 구간', `${o.fromDate} → ${o.toDate}`],
  ];
  for (const [k, v] of rows) dl.append(el('dt', { text: k }), el('dd', null, [v]));
  return dl;
}

/** 탐지 결과에 담긴 shape 정보를 차트 위에 그린다 */
function drawShape(c, hit, patternName) {
  const s = hit.shape;
  const markers = [];

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
  if (!markers.length) {
    markers.push({ date: hit.date, position: 'aboveBar', color: COLORS.neckline, shape: 'arrowDown', text: patternName });
  }
  c.setMarkers(markers);
}

/** 개념 설명용 모식도 한 장 */
function figureEl(id) {
  const f = FIGURES[id];
  return el('figure.fig', null, [
    el('div.fig-svg', { html: f.svg() }),
    el('figcaption', { text: f.caption }),
  ]);
}

async function renderCase(hit, lesson, patternMeta) {
  const stock = await loadStock(hit.ticker);
  const view = sliceByDate(stock.candles, hit.fromDate, hit.toDate);

  const box = el('div.chart-box');
  const oscDef = lesson.oscillator ? OSCILLATORS[lesson.oscillator] : null;
  const oscBox = oscDef ? el('div.osc-box', { style: { height: oscDef.height + 'px' } }) : null;

  const card = el('div.case', null, [
    el('div.case-head', null, [
      el('span.ticker', { text: `${hit.name} (${hit.ticker})` }),
      el('span.date', { text: `신호일 ${hit.date}` }),
      el('span.spacer'),
      el('span.pill', { text: patternMeta.name }),
    ]),
    el('div.case-body', null, [box, oscBox]),
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
          text: '이 수치는 판정에 사용되지 않았습니다. 규칙을 만족했다고 해서 결과가 늘 같은 방향인 것은 아닙니다.',
        }),
      ]),
    ]),
  ]);

  // 차트는 카드가 DOM에 붙은 뒤에 만들어야 컨테이너 크기를 잡을 수 있다.
  card.mountChart = () => {
    if (!box.isConnected) return;
    const c = createStockChart(box, { width: box.clientWidth, height: box.clientHeight });
    charts.push(c);
    c.setOverlays(lesson.overlays || {});
    c.setCandles(view);
    drawShape(c, hit, patternMeta.name);
    c.fit();

    if (oscDef && oscBox.isConnected) {
      const panel = createOscillatorPanel(oscBox, oscDef, view);
      charts.push(panel);
      panel.fit();
      const unsync = syncTimeScales([c.chart, panel.chart]);
      charts.push({ destroy: unsync });
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
  const edge = base ? +(s.winRate - base.winRate).toFixed(1) : null;

  row.append(
    stat(`${meta.outcomeDays}일 뒤 오른 비율`, s.winRate + '%', s.winRate >= 50 ? 'up' : 'down'),
    base ? stat('아무 날이나 샀다면', base.winRate + '%', 'muted') : null,
    edge != null ? stat('신호가 보탠 몫', (edge > 0 ? '+' : '') + edge + '%p', dirClass(edge)) : null,
    stat('평균 수익률', signed(s.avgChange), dirClass(s.avgChange)),
    stat('가장 나빴던 경우', signed(s.worst), 'down')
  );
  return el('div', null, [
    row,
    el('p.muted.small', { style: { margin: '8px 0 0' }, text:
      conf.label + ' · "신호가 보탠 몫"이 0에 가까우면, 그 신호는 아무 날이나 사는 것과 구별되지 않는다는 뜻입니다.' }),
    el('p.muted.small', { style: { margin: '4px 0 0' }, text:
      '매매 전략의 백테스트가 아니라 단순 집계입니다 (수수료·세금·분산투자 미반영).' }),
  ]);
}

async function renderPatternSection(root, patternId, lesson) {
  const meta = await loadPattern(patternId);
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
    el('div.rulebox', null, [
      el('h3', { text: '판정 기준 (이 조건을 전부 만족해야 사례로 인정)' }),
      el('p.why', { text: meta.summary }),
      (() => {
        const ol = el('ol');
        meta.rules.forEach((r) => ol.append(el('li', { text: r })));
        return ol;
      })(),
      el('h3', { style: { marginTop: '18px' }, text: '이 신호의 실제 성과' }),
      statsBox(meta),
    ])
  );

  const list = el('div');
  section.append(list);

  if (!meta.count) {
    list.append(el('p.muted.small', { text: '보유한 데이터에서 이 조건을 만족하는 구간이 없습니다. 조건이 그만큼 엄격하다는 뜻입니다.' }));
    shuffleBtn.disabled = true;
    return;
  }

  let offset = 0;
  async function draw() {
    clear(list).append(el('p.loading', { text: '사례를 불러오는 중…' }));
    const cases = pickCases(meta.hits, 2, offset);
    const cards = [];
    for (const hit of cases) cards.push(await renderCase(hit, lesson, meta));
    clear(list);
    cards.forEach((c) => list.append(c));
    // requestAnimationFrame 은 탭이 화면에 보이지 않으면 실행되지 않으므로 동기적으로 만든다
    cards.forEach((c) => c.mountChart());
    if (meta.sampled) {
      list.append(el('p.muted.small', {
        text: `전체 ${meta.count.toLocaleString()}건 중 종목별로 고르게 뽑은 ${meta.hits.length}건이 저장돼 있습니다. 위 통계는 전체 건수로 계산한 값입니다.`,
      }));
    }
  }

  shuffleBtn.addEventListener('click', () => { offset += 2; draw(); });
  await draw();
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
  for (const sec of lesson.body) {
    const node = el('section', null, [
      el('h3', { text: sec.h }),
      el('p', { html: emphasize(sec.p) }),
    ]);
    if (sec.fig && FIGURES[sec.fig]) node.append(figureEl(sec.fig));
    content.append(node);
  }

  clear(app).append(el('div.learn', null, [nav, content]));

  if (!lesson.patterns.length) {
    content.append(
      el('div.rulebox', { style: { marginTop: '28px' } }, [
        el('h3', { text: '이 지표에는 자동 탐지 사례가 없습니다' }),
        el('p.why', { text: '방향을 가리키는 신호가 아니라 상태를 재는 도구라서, 규칙 기반 사례 대신 데이터 뷰어 탭에서 직접 켜보며 익히는 쪽이 맞습니다.' }),
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
          el('span.small', { text: '탐지 결과가 아직 없다면 tools/build-patterns.html 을 한 번 실행하세요. (' + err.message + ')' }),
        ])
      );
    }
  }
}

export { destroyCharts };
