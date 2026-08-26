/**
 * 개념 학습 탭 (설명서 5.1)
 * 개념 설명 → 판정 기준 공개 → 탐지 엔진이 찾아낸 실제 사례 차트 → 근거 수치 → 이후 실제 결과
 */

import { LESSONS, LESSON_BY_ID } from '../content/lessons.js';
import { loadPattern, loadStock, sliceByDate } from '../lib/data.js';
import { createStockChart, COLORS } from '../lib/chart.js';
import { el, clear, fmt, signed, dirClass } from '../lib/ui.js';

let charts = [];

function destroyCharts() {
  charts.forEach((c) => {
    try { c.destroy(); } catch (_) { /* 이미 제거됨 */ }
  });
  charts = [];
}

/** 사례를 종목·연도가 겹치지 않게 고른다 (다양성 우선) */
function pickCases(hits, count, offset = 0) {
  const byTicker = new Map();
  for (const h of hits) {
    if (!byTicker.has(h.ticker)) byTicker.set(h.ticker, []);
    byTicker.get(h.ticker).push(h);
  }
  const buckets = [...byTicker.values()];
  const picked = [];
  let round = 0;
  while (picked.length < count && round < 30) {
    let added = false;
    for (const b of buckets) {
      const idx = (offset + round) % b.length;
      const cand = b[idx];
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
 * 라벨에 %·배수·비율·거래일 같은 단위가 이미 들어있는 항목은 가격이 아니므로 통화 기호를 붙이지 않는다.
 */
const NON_PRICE = /(%|배수|비율|거래일|거래량)/;
function formatEvidence(e, currency) {
  if (typeof e.value !== 'number') return String(e.value);
  if (NON_PRICE.test(e.label)) return e.value.toLocaleString('ko-KR', { maximumFractionDigits: 3 });
  return fmt(e.value, currency);
}

function outcomeCard(hit, outcomeDays) {
  const o = hit.outcome;
  if (!o) return el('p.muted.small', { text: '이후 데이터가 부족해 결과를 확인할 수 없습니다.' });

  const dl = el('dl.kv');
  const rows = [
    [`${o.days}거래일 뒤 종가 변화`, el('span', { class: dirClass(o.changePct), text: signed(o.changePct) })],
    ['기간 중 최대 상승', el('span.up', { text: signed(o.maxUpPct) })],
    ['기간 중 최대 하락', el('span.down', { text: signed(o.maxDownPct) })],
    ['확인 구간', `${o.fromDate} → ${o.toDate}`],
  ];
  for (const [k, v] of rows) {
    dl.append(el('dt', { text: k }), el('dd', null, [v]));
  }
  return dl;
}

async function renderCase(hit, lesson, patternMeta) {
  const stock = await loadStock(hit.ticker);
  const view = sliceByDate(stock.candles, hit.fromDate, hit.toDate);

  const box = el('div.chart-box');
  const card = el('div.case', null, [
    el('div.case-head', null, [
      el('span.ticker', { text: `${hit.name} (${hit.ticker})` }),
      el('span.date', { text: `신호일 ${hit.date}` }),
      el('span.spacer'),
      el('span.pill', { text: patternMeta.name }),
    ]),
    el('div.case-body', null, [box]),
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
        outcomeCard(hit, patternMeta.outcomeDays),
        el('p.muted.small', {
          style: { marginTop: '10px', marginBottom: '0' },
          text: '이 수치는 판정에 사용되지 않았습니다. 규칙을 만족했다고 해서 결과가 늘 같은 방향인 것은 아닙니다.',
        }),
      ]),
    ]),
  ]);

  // 차트는 카드가 DOM에 붙은 뒤에 만들어야 컨테이너 크기를 잡을 수 있다.
  // 그래서 생성 함수를 카드에 실어 보내고, 호출부가 append 후에 실행한다.
  card.mountChart = () => {
    if (!box.isConnected) return;
    const c = createStockChart(box, { width: box.clientWidth, height: box.clientHeight });
    charts.push(c);
    c.setOverlays(lesson.overlays);
    c.setCandles(view);

    const markers = [{ date: hit.date, position: 'aboveBar', color: COLORS.neckline, shape: 'arrowDown', text: patternMeta.name }];

    if (hit.shape) {
      markers.length = 0;
      markers.push(
        { date: hit.shape.leftShoulder.date, position: 'aboveBar', color: COLORS.bbMid, shape: 'circle', text: '왼쪽 어깨' },
        { date: hit.shape.head.date, position: 'aboveBar', color: COLORS.warn || '#f2b134', shape: 'circle', text: '머리' },
        { date: hit.shape.rightShoulder.date, position: 'aboveBar', color: COLORS.bbMid, shape: 'circle', text: '오른쪽 어깨' },
        { date: hit.shape.breakout.date, position: 'belowBar', color: COLORS.neckline, shape: 'arrowUp', text: '넥라인 이탈' }
      );
      c.drawSegment('neckline', hit.shape.neckline);
    }
    c.setMarkers(markers);
    c.fit();
  };

  return card;
}

async function renderPatternSection(root, patternId, lesson) {
  const meta = await loadPattern(patternId);
  const section = el('div');
  root.append(section);

  const header = el('div.row', { style: { marginBottom: '10px' } }, [
    el('h3', { style: { fontSize: '17px', margin: '0' }, text: `실제 사례 — ${meta.name}` }),
    el('span.pill', { text: `전체 ${meta.count}건 검출` }),
    el('span.spacer'),
  ]);
  const shuffleBtn = el('button.btn', { text: '다른 사례 보기' });
  header.append(shuffleBtn);
  section.append(header);

  const rulebox = el('div.rulebox', null, [
    el('h3', { text: '판정 기준 (이 조건을 전부 만족해야 사례로 인정)' }),
    el('p.why', { text: meta.summary }),
    (() => {
      const ol = el('ol');
      meta.rules.forEach((r) => ol.append(el('li', { text: r })));
      return ol;
    })(),
    el('p.why', {
      style: { margin: '12px 0 0' },
      text: `아래 사례는 사람이 고른 것이 아니라, 보유한 ${meta.count > 0 ? '전체 과거 데이터' : '데이터'}에 위 조건을 그대로 적용해 자동으로 찾아낸 구간입니다.`,
    }),
  ]);
  section.append(rulebox);

  const list = el('div');
  section.append(list);

  let offset = 0;
  async function draw() {
    clear(list);
    list.append(el('p.loading', { text: '사례를 불러오는 중…' }));
    const cases = pickCases(meta.hits, 3, offset);
    const cards = [];
    for (const hit of cases) cards.push(await renderCase(hit, lesson, meta));
    clear(list);
    if (!cards.length) list.append(el('p.muted', { text: '조건을 만족하는 사례가 없습니다.' }));
    cards.forEach((c) => list.append(c));
    // requestAnimationFrame 은 탭이 화면에 보이지 않으면 실행되지 않으므로,
    // DOM에 붙인 직후 동기적으로 차트를 만든다 (이 시점이면 컨테이너 크기가 잡혀 있다).
    cards.forEach((c) => c.mountChart());
  }

  shuffleBtn.addEventListener('click', () => { offset += 3; draw(); });
  await draw();
}

export async function renderLearn(app, params) {
  destroyCharts();
  const lessonId = params[0] && LESSON_BY_ID[params[0]] ? params[0] : LESSONS[0].id;
  const lesson = LESSON_BY_ID[lessonId];

  const nav = el('nav.lesson-nav');
  for (const l of LESSONS) {
    nav.append(el('a', { href: `#/learn/${l.id}`, class: l.id === lessonId ? 'on' : '', text: l.title }));
  }

  const content = el('article.lesson');
  content.append(
    el('h2', { text: lesson.title }),
    el('p.tagline', { text: lesson.tagline })
  );
  for (const sec of lesson.body) {
    content.append(el('section', null, [el('h3', { text: sec.h }), el('p', { text: sec.p })]));
  }

  clear(app).append(el('div.learn', null, [nav, content]));

  for (const pid of lesson.patterns) {
    try {
      await renderPatternSection(content, pid, lesson);
    } catch (err) {
      content.append(
        el('div.error', null, [
          el('b', { text: `${pid} 사례를 불러오지 못했습니다. ` }),
          el('span.small', { text: '탐지 결과가 아직 없다면 tools/build-patterns.html 을 한 번 실행하세요. (' + err.message + ')' }),
        ])
      );
    }
  }
}

export { destroyCharts };
