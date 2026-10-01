import { loadChartCourse, loadStock } from '../lib/data.js';
import { COURSE_STEPS, TASKS, openCourseCase, courseRecord } from '../lib/chart-course.js';
import { el, clear } from '../lib/ui.js';
import * as storage from '../lib/storage.js';
import { reviewSelf } from '../lib/course-feedback.js';
import { autoCheck, selfCheck } from './course-feedback.js';
import { drawCaseCharts, factsList, optionsField, pickedChoice, confidenceField, numericField, caseHeader, rulesBox, legendNotes } from './case-view.js';

let generation = 0, cleanup = null;
function clearCharts() {
  if (cleanup) { cleanup(); cleanup = null; }
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
  const saveNote = el('p.small.muted', { text: '기록은 이 브라우저에만 남습니다. 선택지·직접 계산한 수치·정해진 조건만 자동으로 확인하고, 글은 채점하지 않습니다. 제출하지 않은 선택·메모는 이동하면 사라집니다.' });
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
      // 매번 정답 위치를 섞되 저장은 원래 선택지 인덱스로 한다.
      const options = optionsField(q, 'course-answer', existing?.choice ?? null);
      const reflection = el('textarea', { id: 'course-reflection', rows: 3, maxlength: 1500, placeholder: '눈에 보이는 값이나 위치를 근거로 적어보세요.' });
      if (existing) reflection.value = existing.reflection || '';
      const { box: numericBox, input: numericInput } = numericField(q, 'course-numeric',
        q.numeric && `‘차트에서 비교할 값’의 숫자로 나눠보세요. 소수 ${q.numeric.decimals}째 자리까지 적고, 실제 값과 ${10 ** -q.numeric.decimals} 이내면 맞게 읽은 것으로 봅니다.`);
      if (numericInput && existing?.auto?.numeric) numericInput.value = String(existing.auto.numeric.input);
      const confidence = confidenceField('course-confidence', existing?.confidence ?? null);
      const submit = el('button.btn.primary', { text: '선택하고 해설 확인' });
      let submitted = !!existing;
      function reveal(record) {
        options.disabled = true; confidence.disabled = true; reflection.readOnly = true; submit.disabled = true;
        if (numericInput) numericInput.readOnly = true;
        const flat = COURSE_STEPS.flatMap((s) => s.ids), nextType = flat[flat.indexOf(selectedType) + 1];
        clear(feedback).append(...[
          el('h3', { text: record.correct ? '관찰과 선택이 맞았습니다' : '다시 볼 관찰이 있습니다' }),
          autoCheck(q, record),
          el('h4', { text: '해설' }),
          el('p', { text: `정답: ${q.options[q.answer]}` }),
          el('p', { text: q.explanation }),
          selfCheck(q, record, (checks, note) => {
            const updated = reviewSelf(records[key], q.selfChecks || [], checks, note);
            records[key] = updated;
            if (!storage.save(storageKey, records)) throw new Error('저장하지 못했습니다. 브라우저 저장이 막혀 있거나 공간이 부족할 수 있습니다.');
            return updated;
          }),
          el('a.btn', { href: `#/learn/${q.lesson}`, text: '관련 개념 읽기' }),
          nextType ? el('button.btn', { text: '다음 주제로', onclick: () => selectType(nextType) }) : el('a.btn', { href: '#/practice/real', text: '같은 신호 · 다른 결과 비교로' })
        ].filter(Boolean));
      }
      submit.addEventListener('click', () => {
        if (submitted) return;
        try {
          const level = confidence.querySelector('input:checked');
          const record = courseRecord(null, pickedChoice(options), q, reflection.value, Date.now(),
            { numeric: numericInput?.value, confidence: level?.value });
          records[key] = record; submitted = true;
          if (!storage.save(storageKey, records)) saveNote.textContent = '저장하지 못했습니다. 현재 화면에서는 확인할 수 있지만 새로고침 후 기록이 유지되지 않을 수 있습니다.';
          updateProgress(); reveal(record);
        } catch (error) { clear(feedback).append(el('p.warn', { text: error.message })); }
      });
      const facts = factsList(q, stock.currency);
      clear(area).append(...[
        ...caseHeader(q, `${stock.name} (${stock.ticker}) · 일봉 · 관찰 마감 ${ref.date} · 이 주제 ${(cursors[type] || 0) % refs.length + 1}/${refs.length} 사례`),
        el('details.course-help', null, [el('summary', { text: '처음이라면 · 읽는 방법' }), el('p', { text: q.hint })]),
        rulesBox(q),
        chartBox, panelWrap, ...legendNotes(q),
        el('details.course-help', { open: ['candle', 'wick', 'timeframe', 'volume'].includes(q.type) }, [el('summary', { text: '차트에서 비교할 값' }), facts]),
        numericBox, options, confidence,
        q.reflection ? el('label.practice-label', { for: 'course-reflection', text: q.reflection }) : null,
        q.reflection ? reflection : null, submit, feedback
      ].filter(Boolean));
      cleanup = drawCaseCharts(chartBox, panelWrap, q, view, history, ref.date);
      if (existing) reveal(existing);
    } catch (error) {
      if (token === generation && drawToken === serial && app.isConnected) clear(area).append(el('p.error', { text: error.message }));
    } finally {
      if (token === generation && drawToken === serial) nextCase.disabled = false;
    }
  }
  clear(app).append(el('h1.page-title', { text: '실제 차트 · 입문 6단계' }),
    el('p.page-sub', { text: '가격을 읽고 → 조건을 구별하고 → 근거를 연결합니다. 처음에는 읽는 방법과 숫자를 펼쳐보고, 익숙해지면 접고 차트에서 먼저 찾아보세요.' }),
    el('div.row', null, [el('a.btn', { href: '#/practice', text: '구성 예제로 기초 다지기' }), el('a.btn', { href: '#/practice/real', text: '같은 신호 · 다른 결과 비교' }), el('a.btn', { href: '#/practice/check', text: '새 구간에서 다시 읽기' })]),
    steps, introduction,
    el('div.course-toolbar', null, [el('label', { for: 'course-task', text: '연습 주제' }), taskSelect, nextCase]), progress, area, saveNote,
    el('details.rulebox', null, [el('summary', { text: '어떤 실제 자료로 연습하나요?' }), el('p.small', { text: course.policy }), el('p.small', { text: '자료 검사를 통과한 종목만 씁니다. 한쪽 모양만 외우지 않도록 다른 상태와 경계 사례를 함께 골랐습니다. 화면에 나온 사례 비율을 시장에서의 발생 비율로 해석하면 안 됩니다. 차트·지표 계산·해설은 모두 관찰 마감일까지의 자료만 사용합니다.' })])
  );
  updateProgress(); selectType(type);
}
