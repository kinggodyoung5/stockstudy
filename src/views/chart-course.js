import { loadChartCourse, loadStock } from '../lib/data.js';
import { COURSE_STEPS, TASKS, openCourseCase, courseRecord } from '../lib/chart-course.js';
import { createStockChart, createOscillatorPanel, syncTimeScales } from '../lib/chart.js';
import { OSCILLATORS } from '../lib/oscillators.js';
import { el, clear } from '../lib/ui.js';
import * as storage from '../lib/storage.js';

let generation = 0, charts = [], unsync = null;
function clearCharts() {
  if (unsync) { unsync(); unsync = null; }
  charts.forEach((c) => c.destroy()); charts = [];
}
export function destroyChartCourse() { generation++; clearCharts(); }

export async function renderChartCourse(app, initialType = '') {
  destroyChartCourse();
  const token = generation;
  const course = await loadChartCourse();
  if (token !== generation || !app.isConnected) return;
  const storageKey = `chart-course:${course.version}:${course.provenance.sourceDigest}`;
  const loaded = storage.load(storageKey, {});
  const records = loaded && typeof loaded === 'object' && !Array.isArray(loaded) ? loaded : {};
  const keyOf = (r) => `${r.type}|${r.ticker}|${r.date}`;
  let type = TASKS[initialType] ? initialType : 'candle', serial = 0;
  const cursors = {};
  const steps = el('div.course-steps', { 'aria-label': '입문 학습 단계' });
  const taskSelect = el('select', { id: 'course-task' });
  const progress = el('p.small.muted', { 'aria-live': 'polite' });
  const introduction = el('p');
  const area = el('section.panel.practice-card');
  const saveNote = el('p.small.muted', { text: '기록은 이 브라우저에만 남습니다. 선택지만 자동 채점하며 글의 내용은 채점하지 않습니다. 제출하지 않은 선택·메모는 이동하면 사라집니다.' });
  const nextCase = el('button.btn', { text: '같은 주제 · 다른 실제 사례', onclick: () => { cursors[type] = (cursors[type] || 0) + 1; draw(); } });

  function queue() {
    // 상태를 번갈아 보되 상태/정답 이름은 제출 전 화면에 노출하지 않는다.
    const groups = new Map();
    for (const ref of course.cases.filter((r) => r.type === type)) {
      if (!groups.has(ref.bucket)) groups.set(ref.bucket, []);
      groups.get(ref.bucket).push(ref);
    }
    const result = [];
    for (let i = 0; result.length < course.cases.filter((r) => r.type === type).length; i++) {
      for (const group of groups.values()) if (group[i]) result.push(group[i]);
    }
    return result;
  }
  function updateProgress() {
    const tried = course.cases.filter((r) => records[keyOf(r)]?.submittedAt);
    const topics = new Set(tried.map((r) => r.type));
    progress.textContent = `${Object.keys(TASKS).length}개 주제 중 ${topics.size}개 시도 · 실제 사례 ${tried.length}/${course.cases.length}개 기록. 시도 수는 숙달이나 예측 능력 인증이 아닙니다.`;
  }
  function selectType(id) {
    type = id;
    const step = COURSE_STEPS.find((s) => s.ids.includes(type));
    clear(taskSelect).append(...step.ids.map((id) => el('option', { value: id, text: TASKS[id][0] })));
    taskSelect.value = type;
    introduction.textContent = step.intro;
    [...steps.children].forEach((button, i) => button.setAttribute('aria-pressed', String(COURSE_STEPS[i] === step)));
    if (cursors[type] == null) {
      const pending = queue().findIndex((r) => !records[keyOf(r)]?.submittedAt);
      cursors[type] = Math.max(0, pending);
    }
    draw();
  }
  COURSE_STEPS.forEach((s, i) => steps.append(el('button.btn', { text: `${i + 1}. ${s.title}`, onclick: () => selectType(s.ids[0]) })));
  taskSelect.addEventListener('change', () => selectType(taskSelect.value));

  async function draw() {
    const drawToken = ++serial, selectedType = type;
    clearCharts(); clear(area).append(el('p.loading', { text: '실제 차트를 준비하는 중…' }));
    nextCase.disabled = true;
    try {
      const refs = queue();
      if (!refs.length) throw new Error('이 주제의 실제 사례가 없습니다.');
      const ref = refs[(cursors[type] || 0) % refs.length];
      const stock = await loadStock(ref.ticker);
      if (token !== generation || drawToken !== serial || !app.isConnected) return;
      const { question: q, history, view } = openCourseCase(stock, ref);
      const key = keyOf(ref), existing = records[key]?.submittedAt ? records[key] : null;
      const chartBox = el('div.chart-box', { 'aria-label': '관찰 마감일까지의 실제 일봉 차트' });
      const panelWrap = el('div.panels');
      const feedback = el('div.practice-feedback', { 'aria-live': 'polite' });
      const options = el('fieldset.practice-options', null, [el('legend', { text: '차트에 맞는 설명 선택' })]);
      // 매번 정답 위치를 섞되 저장은 원래 선택지 인덱스로 한다.
      const shift = Math.floor(Math.random() * q.options.length);
      q.options.forEach((_, k) => {
        const j = (k + shift) % q.options.length;
        options.append(el('label.practice-option', null, [el('input', { type: 'radio', name: 'course-answer', value: j, checked: existing?.choice === j }), el('span', { text: q.options[j] })]));
      });
      const reflection = el('textarea', { id: 'course-reflection', rows: 3, maxlength: 1500, placeholder: '눈에 보이는 값이나 위치를 근거로 적어보세요.' });
      if (existing) reflection.value = existing.reflection || '';
      const submit = el('button.btn.primary', { text: '선택하고 해설 확인' });
      let submitted = !!existing;
      function reveal(record) {
        options.disabled = true; reflection.readOnly = true; submit.disabled = true;
        const flat = COURSE_STEPS.flatMap((s) => s.ids), nextType = flat[flat.indexOf(selectedType) + 1];
        clear(feedback).append(...[
          el('h3', { text: record.correct ? '관찰과 선택이 맞았습니다' : '이 부분을 다시 비교해보세요' }),
          el('p', { text: `정답: ${q.options[q.answer]}` }),
          el('p', { text: q.explanation }),
          q.reflection ? el('p.small.muted', { text: '위에 남긴 글은 자동 채점하지 않았습니다. 해설의 숫자와 내 관찰이 맞는지, 해석을 확정 예측으로 바꾸지는 않았는지 직접 대조하세요.' }) : null,
          el('a.btn', { href: `#/learn/${q.lesson}`, text: '관련 개념 읽기' }),
          nextType ? el('button.btn', { text: '다음 주제로', onclick: () => selectType(nextType) }) : el('a.btn', { href: '#/practice/real', text: '같은 신호 · 다른 결과 비교로' })
        ].filter(Boolean));
      }
      submit.addEventListener('click', () => {
        if (submitted) return;
        try {
          const picked = options.querySelector('input:checked');
          const record = courseRecord(null, picked ? Number(picked.value) : null, q, reflection.value);
          records[key] = record; submitted = true;
          if (!storage.save(storageKey, records)) saveNote.textContent = '저장하지 못했습니다. 현재 화면에서는 확인할 수 있지만 새로고침 후 기록이 유지되지 않을 수 있습니다.';
          updateProgress(); reveal(record);
        } catch (error) { clear(feedback).append(el('p.warn', { text: error.message })); }
      });
      const facts = el('dl.course-facts');
      q.facts.forEach(([label, value, unit]) => facts.append(el('div', null, [el('dt', { text: label }), el('dd', { text: value + (unit === 'price' ? (stock.currency === 'USD' ? ' 달러' : ' 원') : '') })])));
      clear(area).append(...[
        el('p.small.muted', { text: `${stock.name} (${stock.ticker}) · 일봉 · 관찰 마감 ${ref.date} · 이 주제 ${(cursors[type] || 0) % refs.length + 1}/${refs.length} 사례` }),
        el('h2', { text: q.title }), el('p.course-prompt', { text: q.prompt }),
        el('details.course-help', null, [el('summary', { text: '처음이라면 · 읽는 방법' }), el('p', { text: q.hint })]),
        q.rules ? el('details.rulebox', { open: true }, [el('summary', { text: '이번에 확인할 조건 (이 앱의 기준)' }), el('ul', null, q.rules.map((rule) => el('li', { text: rule })))]) : null,
        chartBox, panelWrap,
        (q.overlays.ma20 || q.overlays.ma60) ? el('p.small.muted', { text: '이동평균: 노랑 5일 · 초록 20일 · 보라 60일. 문제에 필요한 선만 표시합니다.' }) : null,
        q.overlays.volume ? el('p.small.muted', { text: '가격 차트 아래쪽 막대는 거래량(주)입니다. 높이는 가격과 별도 눈금으로 그립니다.' }) : null,
        el('details.course-help', { open: ['candle', 'wick', 'timeframe'].includes(q.type) }, [el('summary', { text: '차트에서 비교할 값' }), facts]), options,
        q.reflection ? el('label.practice-label', { for: 'course-reflection', text: q.reflection }) : null,
        q.reflection ? reflection : null, submit, feedback
      ].filter(Boolean));
      const chart = createStockChart(chartBox, { height: 280 }); charts.push(chart);
      chart.setOverlays(q.overlays); chart.setCandles(view, history);
      chart.setMarkers(q.markers.length ? q.markers : [{ date: q.focusDate || ref.date, text: '관찰 대상', position: 'aboveBar' }]);
      q.lines.forEach((line, j) => chart.drawSegment('course-line-' + j, [{ date: line.from, value: line.value }, { date: ref.date, value: line.value }]));
      chart.fit();
      const synced = [chart.chart];
      for (const id of q.panels) {
        const def = OSCILLATORS[id], box = el('div.osc-box', { style: { height: def.height + 'px' } });
        panelWrap.append(el('div.osc-wrap', null, [el('div.panel-head', { text: def.name }), box]));
        const panel = createOscillatorPanel(box, def, view, undefined, history); charts.push(panel); synced.push(panel.chart); panel.fit();
      }
      if (synced.length > 1) unsync = syncTimeScales(synced);
      if (q.weekly) {
        const box = el('div.chart-box', { 'aria-label': '완료된 주까지만 표시한 주봉 차트' });
        panelWrap.append(el('p.small', { text: '주봉 비교 · 진행 중일 수 있는 마지막 주는 제외. 주봉 끝 날짜가 각 봉의 날짜입니다.' }), box);
        const weekly = createStockChart(box, { height: 240 }); charts.push(weekly);
        weekly.setCandles(q.weekly); weekly.setMarkers([{ date: q.focusDate, text: '비교할 주' }]); weekly.fit();
      }
      if (existing) reveal(existing);
    } catch (error) {
      if (token === generation && drawToken === serial && app.isConnected) clear(area).append(el('p.error', { text: error.message }));
    } finally {
      if (token === generation && drawToken === serial) nextCase.disabled = false;
    }
  }
  clear(app).append(el('h1.page-title', { text: '실제 차트 · 입문 6단계' }),
    el('p.page-sub', { text: '가격을 읽고 → 조건을 구별하고 → 근거를 연결합니다. 처음에는 읽는 방법과 숫자를 펼쳐보고, 익숙해지면 접고 차트에서 먼저 찾아보세요.' }),
    el('div.row', null, [el('a.btn', { href: '#/practice', text: '구성 예제로 기초 다지기' }), el('a.btn', { href: '#/practice/real', text: '같은 신호 · 다른 결과 비교' })]),
    steps, introduction,
    el('div.course-toolbar', null, [el('label', { for: 'course-task', text: '연습 주제' }), taskSelect, nextCase]), progress, area, saveNote,
    el('details.rulebox', null, [el('summary', { text: '어떤 실제 자료로 연습하나요?' }), el('p.small', { text: course.policy }), el('p.small', { text: '자료 검사를 통과한 종목만 씁니다. 한쪽 모양만 외우지 않도록 다른 상태와 경계 사례를 함께 골랐습니다. 화면에 나온 사례 비율을 시장에서의 발생 비율로 해석하면 안 됩니다. 차트·지표 계산·해설은 모두 관찰 마감일까지의 자료만 사용합니다.' })])
  );
  updateProgress(); selectType(type);
}
