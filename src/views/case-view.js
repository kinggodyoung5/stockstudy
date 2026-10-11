/**
 * 실제 사례 문제의 화면 부품. 입문 과정·새 구간 평가·복습이 같은 모양으로 그린다.
 * 차트와 지표는 관찰 마감일까지의 이력(history)으로만 계산하고, 화면에는 view 만 보인다.
 */
import { createStockChart, createOscillatorPanel, syncTimeScales } from '../lib/chart.js';
import { OSCILLATORS } from '../lib/oscillators.js';
import { CONFIDENCE } from '../lib/course-feedback.js';
import { el } from '../lib/ui.js';

/** 차트를 그리고 정리 함수를 돌려준다. */
export function drawCaseCharts(chartBox, panelWrap, q, view, history, cutoff) {
  const made = [];
  let unsync = null;
  const chart = createStockChart(chartBox, { height: chartBox.clientHeight || 380 }); made.push(chart);
  chart.setOverlays(q.overlays); chart.setCandles(view, history);
  chart.setMarkers(q.markers.length ? q.markers : [{ date: q.focusDate || cutoff, text: '관찰 대상', position: 'aboveBar' }]);
  q.lines.forEach((line, j) => chart.drawSegment('course-line-' + j, [{ date: line.from, value: line.value }, { date: cutoff, value: line.value }]));
  chart.fit();
  const synced = [chart.chart];
  for (const id of q.panels) {
    const def = OSCILLATORS[id], box = el('div.osc-box', { style: { height: def.height + 'px' } });
    panelWrap.append(el('div.osc-wrap', null, [el('div.panel-head', { text: def.name }), box]));
    const panel = createOscillatorPanel(box, def, view, undefined, history); made.push(panel); synced.push(panel.chart); panel.fit();
  }
  if (synced.length > 1) unsync = syncTimeScales(synced);
  if (q.weekly) {
    const box = el('div.chart-box', { 'aria-label': '완료된 주까지만 표시한 주봉 차트' });
    panelWrap.append(el('p.small', { text: '주봉 비교 · 진행 중일 수 있는 마지막 주는 제외. 주봉 끝 날짜가 각 봉의 날짜입니다.' }), box);
    const weekly = createStockChart(box, { height: 240 }); made.push(weekly);
    weekly.setCandles(q.weekly); weekly.setMarkers([{ date: q.focusDate, text: '비교할 주' }]); weekly.fit();
  }
  return () => { if (unsync) unsync(); made.forEach((c) => c.destroy()); };
}

/** ‘차트에서 비교할 값’ 목록 */
export function factsList(q, currency) {
  const facts = el('dl.course-facts');
  q.facts.forEach(([label, value, unit]) => facts.append(el('div', null, [el('dt', { text: label }),
    el('dd', { text: value + (unit === 'price' ? (currency === 'USD' ? ' 달러' : ' 원') : '') })])));
  return facts;
}

/** 선택지. 매번 위치를 섞되 값은 원래 인덱스다. */
export function optionsField(q, name, checked = null) {
  const options = el('fieldset.practice-options', null, [el('legend', { text: '차트에 맞는 설명 선택' })]);
  const shift = Math.floor(Math.random() * q.options.length);
  q.options.forEach((_, k) => {
    const j = (k + shift) % q.options.length;
    options.append(el('label.practice-option', null, [el('input', { type: 'radio', name, value: j, checked: checked === j }), el('span', { text: q.options[j] })]));
  });
  return options;
}
export const pickedChoice = (options) => {
  const picked = options.querySelector('input:checked');
  return picked ? Number(picked.value) : null;
};

export function confidenceField(name, checked = null) {
  return el('fieldset.course-confidence', null, [el('legend', { text: '내 답에 얼마나 확신하나요? (선택)' }),
    ...Object.entries(CONFIDENCE).map(([id, label]) => el('label', null, [
      el('input', { type: 'radio', name, value: id, checked: checked === id }), el('span', { text: label })]))]);
}

export function numericField(q, id, help) {
  if (!q.numeric) return { box: null, input: null };
  const input = el('input', { type: 'text', id, inputmode: 'decimal', autocomplete: 'off', placeholder: '예: 1.85', 'aria-describedby': id + '-help' });
  const box = el('div.course-numeric', null, [
    el('label.practice-label', { for: id, text: `직접 계산: ${q.numeric.label} (${q.numeric.unit})` }), input,
    el('p.small.muted', { id: id + '-help', text: help }),
  ]);
  return { box, input };
}

/** 문제 위쪽(종목·제목·질문·조건) */
export function caseHeader(q, meta) {
  return [
    el('p.small.muted.case-meta', { text: meta }),
    el('h2.course-title', { text: q.title }), el('p.course-prompt', { text: q.prompt }),
  ];
}
export function rulesBox(q) {
  return q.rules ? el('details.rulebox', { open: true }, [el('summary', { text: '이번에 확인할 조건 (이 앱의 기준)' }), el('ul', null, q.rules.map((rule) => el('li', { text: rule })))]) : null;
}
export function legendNotes(q) {
  return [
    (q.overlays.ma20 || q.overlays.ma60) ? el('p.small.muted.chart-legend', { text: '이동평균: 노랑 5일, 초록 20일, 보라 60일. 문제에 필요한 선만 표시합니다.' }) : null,
    q.overlays.volume ? el('p.small.muted.chart-legend', { text: '아래쪽 막대는 거래량(주)입니다. 가격과는 다른 눈금을 사용합니다.' }) : null,
  ];
}

/** Move the existing controls, without cloning them or changing their event handlers. */
export function arrangeStudyDesk(area, chartBox, panelWrap) {
  const children = [...area.children];
  const chartSide = el('section.study-chart-side', { 'aria-label': '차트 관찰' });
  const noteSide = el('section.study-note-side', { 'aria-label': '관찰 노트' }, [el('div.note-heading', { text: '관찰 노트' })]);
  const metaIndex = children.findIndex((node) => node.classList.contains('case-meta'));
  const history = children.slice(0, Math.max(0, metaIndex));
  for (const node of children.slice(Math.max(0, metaIndex))) {
    const isChart = node === chartBox || node === panelWrap || node.matches('.case-meta, .course-title, .chart-legend');
    (isChart ? chartSide : noteSide).append(node);
  }
  area.replaceChildren(...history, el('div.study-desk', null, [chartSide, noteSide]));
  area.classList.add('study-workspace');
}
