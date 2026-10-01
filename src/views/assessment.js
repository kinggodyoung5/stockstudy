/**
 * 새 구간에서 다시 읽기 (#/practice/check)
 *
 * 입문 과정과 같은 문제 계산을 쓰지만, 사례는 연습 화면에 나온 봉과 겹치지 않는 구간에서 고른다.
 * 해설은 제출 뒤에만 보인다. 도움은 언제든 열 수 있지만 열었다는 사실을 기록한다.
 * 시간 제한은 두지 않는다.
 */
import { loadAssessment, loadStock } from '../lib/data.js';
import { TASKS, openCourseCase } from '../lib/chart-course.js';
import { reviewSelf, CONFIDENCE } from '../lib/course-feedback.js';
import { DOMAINS, DOMAIN_OF, HELP, itemId, assessmentRecord, normalizeAssessment, addAttempt, pickSession, scorecard, weakTopics, usedHelp } from '../lib/assessment.js';
import { el, clear } from '../lib/ui.js';
import * as storage from '../lib/storage.js';
import { autoCheck, selfCheck } from './course-feedback.js';
import { drawCaseCharts, factsList, optionsField, pickedChoice, confidenceField, numericField, caseHeader, rulesBox, legendNotes } from './case-view.js';

export const ASSESSMENT_KEY = 'assessment:v1';
const WHY = { wrong: '오답', unsure: '확신 낮음', help: '도움 받음', self: '자기 점검에서 표시 못 한 항목' };

let generation = 0, cleanup = null;
function clearCharts() { if (cleanup) { cleanup(); cleanup = null; } }
export function destroyAssessment() { generation++; clearCharts(); }

export async function renderAssessment(app) {
  destroyAssessment();
  const token = generation;
  const data = await loadAssessment();
  if (token !== generation || !app.isConnected) return;
  const items = data.items, byId = new Map(items.map((r) => [itemId(r), r]));
  let state = normalizeAssessment(storage.load(ASSESSMENT_KEY, null));
  let serial = 0;

  const saveNote = el('p.small.muted', { 'aria-live': 'polite' });
  function persist() {
    if (storage.save(ASSESSMENT_KEY, state)) return true;
    saveNote.textContent = '저장하지 못했습니다. 브라우저 저장이 막혀 있거나 공간이 부족할 수 있습니다. 이 화면을 떠나면 이번 기록이 사라집니다. ‘기록과 백업’에서 내보내기를 먼저 해두세요.';
    saveNote.className = 'small warn';
    return false;
  }

  const area = el('section.panel.practice-card');
  const report = el('section.assess-report');
  const startButton = el('button.btn.primary', { text: '새 점검 시작 (영역마다 한 문항)', onclick: () => startSession() });

  function startSession() {
    const { ids, missing } = pickSession(items, state, String(Date.now()));
    state = { ...state, session: ids.length ? { startedAt: Date.now(), ids, missing, help: {}, retry: null } : null };
    persist();
    if (!ids.length) {
      clear(area).append(el('h2', { text: '새 구간이 남지 않았습니다' }),
        el('p', { text: `평가 문항 ${items.length}개를 모두 화면에 냈습니다. 이미 푼 문항을 다시 풀 수는 있지만 재시도로 따로 기록합니다. 처음 보는 구간이라고 표시하지 않습니다.` }));
      return;
    }
    draw();
  }

  function currentId() {
    const s = state.session;
    if (!s) return null;
    if (s.retry) return s.retry;
    return s.ids.find((id) => !state.items[id]?.first) || null;
  }

  async function draw() {
    const drawToken = ++serial;
    clearCharts();
    const s = state.session, id = currentId();
    if (!s) { clear(area).append(el('h2', { text: '점검을 시작하세요' }), el('p', { text: '여섯 영역에서 한 문항씩, 연습 화면에 나오지 않은 구간을 보여줍니다. 답을 고른 뒤에 해설이 열립니다.' }), startButton); return; }
    if (!id) { sessionSummary(); return; }
    const ref = byId.get(id), retry = s.retry === id;
    if (!ref) { clear(area).append(el('p.error', { text: '이 문항은 현재 평가 자료에 없습니다. 새 점검을 시작하세요.' }), startButton); return; }
    clear(area).append(el('p.loading', { text: '실제 차트를 준비하는 중…' }));
    try {
      const stock = await loadStock(ref.ticker);
      if (token !== generation || drawToken !== serial || !app.isConnected) return;
      const { question: q, history, view } = openCourseCase(stock, ref);
      if (!retry && !state.shown[id]) { state = { ...state, shown: { ...state.shown, [id]: Date.now() } }; persist(); }
      // 첫 시도의 도움 기록은 세션에 저장해 새로고침해도 남긴다. 재시도는 빈 상태에서 따로 센다.
      const helpKey = retry ? 'retry:' + id : id;
      const help = { ...(s.help?.[helpKey] || {}) };
      const position = s.ids.indexOf(id);
      const domain = DOMAINS.find((d) => d.id === DOMAIN_OF[ref.type]);
      const chartBox = el('div.chart-box', { 'aria-label': '관찰 마감일까지의 실제 일봉 차트' });
      const panelWrap = el('div.panels');
      const feedback = el('div.practice-feedback', { 'aria-live': 'polite' });
      const options = optionsField(q, 'assess-answer');
      const confidence = confidenceField('assess-confidence');
      const { box: numericBox, input: numericInput } = numericField(q, 'assess-numeric',
        q.numeric && `선택 입력입니다. 비워도 제출됩니다. 숫자는 ‘비교 값 보기’를 열어야 보이며, 열면 도움을 받은 것으로 기록합니다. 소수 ${q.numeric.decimals}째 자리까지 적습니다.`);
      const reflection = el('textarea', { id: 'assess-reflection', rows: 3, maxlength: 1500, placeholder: '눈에 보이는 값이나 위치를 근거로 적어보세요.' });

      // 도움: 열면 그 자리에서 기록한다. 제출 전에 연 것만 도움으로 센다.
      const helpStatus = el('p.small.muted', { 'aria-live': 'polite' });
      const helpBody = el('div');
      const showHelp = (kind) => {
        if (kind === 'hint') helpBody.append(el('div.course-help', null, [el('b', { text: '읽는 방법' }), el('p', { text: q.hint })]));
        if (kind === 'values') helpBody.append(el('div.course-help', null, [el('b', { text: '차트에서 비교할 값' }), factsList(q, stock.currency)]));
      };
      const helpButtons = Object.entries(HELP).map(([kind, label]) => {
        const button = el('button.btn', { type: 'button', text: label + ' (도움으로 기록)', disabled: !!help[kind] });
        button.addEventListener('click', () => {
          if (help[kind] || submitted) return;
          help[kind] = true; button.disabled = true; showHelp(kind);
          state = { ...state, session: { ...state.session, help: { ...state.session.help, [helpKey]: { ...help } } } };
          persist();
          helpStatus.textContent = '도움을 열었습니다. 이 문항은 ‘도움 받고 푼 결과’로 따로 셉니다.';
        });
        return button;
      });
      Object.keys(HELP).forEach((kind) => { if (help[kind]) showHelp(kind); });

      const submit = el('button.btn.primary', { text: '제출하고 해설 보기' });
      let submitted = false;
      submit.addEventListener('click', () => {
        if (submitted) return;
        try {
          const level = confidence.querySelector('input:checked');
          const record = assessmentRecord(q, { choice: pickedChoice(options), reflection: reflection.value, confidence: level?.value,
            numeric: numericInput?.value, help, kind: retry ? 'retry' : 'first', session: s.startedAt });
          submitted = true;
          state = addAttempt(state, id, record);
          if (retry) {
            const { [helpKey]: _, ...rest } = state.session.help || {};
            state = { ...state, session: { ...state.session, retry: null, help: rest } };
          }
          persist();
          options.disabled = true; confidence.disabled = true; reflection.readOnly = true; submit.disabled = true;
          helpButtons.forEach((b) => { b.disabled = true; });
          if (numericInput) numericInput.readOnly = true;
          clear(feedback).append(...[
            el('h3', { text: record.correct ? '관찰과 선택이 맞았습니다' : '다시 볼 관찰이 있습니다' }),
            retry ? el('p.small.warn', { text: '재시도입니다. 같은 차트와 해설을 이미 봤으므로 첫 시도와 따로 셉니다.' }) : null,
            usedHelp(record) ? el('p.small.muted', { text: '도움을 열고 푼 결과로 기록했습니다.' }) : null,
            autoCheck(q, record),
            el('h4', { text: '해설' }),
            el('p', { text: `정답: ${q.options[q.answer]}` }),
            el('p', { text: q.explanation }),
            retry ? null : selfCheck(q, record, (checks, note) => {
              const entry = state.items[id];
              const updated = reviewSelf(entry.first, q.selfChecks || [], checks, note);
              state = { ...state, items: { ...state.items, [id]: { ...entry, first: updated } } };
              if (!persist()) throw new Error('저장하지 못했습니다. 브라우저 저장이 막혀 있거나 공간이 부족할 수 있습니다.');
              renderReport();
              return updated;
            }),
            el('button.btn.primary', { text: currentId() ? '다음 문항' : '이번 점검 정리 보기', onclick: () => draw() }),
          ].filter(Boolean));
          renderReport();
        } catch (error) { clear(feedback).append(el('p.warn', { text: error.message })); }
      });

      clear(area).append(...[
        ...caseHeader(q, `${retry ? '재시도' : `${position + 1}/${s.ids.length}`} · ${domain.title} · ${stock.name} (${stock.ticker}) · 일봉 · 관찰 마감 ${ref.date}`),
        el('p.small.assess-tag', { text: retry ? '이미 푼 차트입니다. 재시도로 따로 기록합니다.' : '이 기능의 기록상 처음 보는 구간 · 입문 과정과 비교 연습의 화면 구간과 겹치지 않습니다.' }),
        rulesBox(q), chartBox, panelWrap, ...legendNotes(q),
        el('div.assess-help', null, [el('p.small.muted', { text: '막히면 도움을 열 수 있습니다. 해설(정답)은 제출 뒤에만 보입니다.' }), el('div.row', null, helpButtons), helpStatus, helpBody]),
        numericBox, options, confidence,
        q.reflection ? el('label.practice-label', { for: 'assess-reflection', text: q.reflection }) : null,
        q.reflection ? reflection : null, submit, feedback,
      ].filter(Boolean));
      cleanup = drawCaseCharts(chartBox, panelWrap, q, view, history, ref.date);
    } catch (error) {
      if (token === generation && drawToken === serial && app.isConnected) clear(area).append(el('p.error', { text: error.message }), startButton);
    }
  }

  function sessionSummary() {
    const s = state.session;
    const rows = s.ids.map((id) => {
      const ref = byId.get(id), first = state.items[id]?.first;
      if (!ref || !first) return null;
      const domain = DOMAINS.find((d) => d.id === DOMAIN_OF[ref.type]);
      return el('li', null, [
        el('b', { text: `${domain.title} · ${TASKS[ref.type][0]}` }), ` — ${first.correct ? '맞음' : '다시 볼 관찰 있음'}`,
        usedHelp(first) ? ' · 도움 받음' : '', first.confidence ? ` · 확신: ${CONFIDENCE[first.confidence]}` : '',
        first.correct ? null : el('button.btn.small-btn', { text: '같은 차트 다시 풀기 (재시도)', onclick: () => {
          state = { ...state, session: { ...state.session, retry: id } }; persist(); draw();
        } }),
      ]);
    }).filter(Boolean);
    clear(area).append(...[
      el('h2', { text: '이번 점검을 마쳤습니다' }),
      el('ul.assess-summary', null, rows),
      s.missing?.length ? el('p.small.warn', { text: `새 구간이 남지 않아 이번 점검에서 뺀 영역: ${s.missing.map((m) => DOMAINS.find((d) => d.id === m).title).join(', ')}. 이미 본 문항으로 몰래 채우지 않았습니다.` }) : null,
      el('p.small.muted', { text: '한 번의 점검은 영역마다 한 문항뿐입니다. 맞고 틀린 결과 하나로 그 영역을 안다·모른다고 판단하지 마세요.' }),
      el('div.row', null, [startButton, el('a.btn', { href: '#/practice/review', text: '복습할 주제 보기' })]),
    ].filter(Boolean));
  }

  function renderReport() {
    const rows = scorecard(state, items);
    const weak = weakTopics(state);
    const count = (a, b) => `${b}개 중 ${a}개`;
    clear(report).append(...[
      el('h2', { text: '영역별 기록' }),
      el('p.small.muted', { text: '맞힌 개수만 셉니다. 합격선이나 숙달 인증은 없습니다. 이후 주가가 어떻게 움직였는지는 점수에 들어가지 않습니다. 자기 점검과 서술은 자동 채점하지 않고 따로 셉니다.' }),
      el('div.assess-grid', null, rows.map((r) => el('section.assess-card', null, [
        el('h3', { text: r.domain.title }),
        r.first ? el('dl.assess-kv', null, [
          el('dt', { text: '첫 시도 · 맞음' }), el('dd', { text: count(r.firstCorrect, r.first) }),
          el('dt', { text: '도움 없이' }), el('dd', { text: r.noHelp ? count(r.noHelpCorrect, r.noHelp) : '없음' }),
          el('dt', { text: '도움 받고' }), el('dd', { text: r.withHelp ? count(r.withHelpCorrect, r.withHelp) : '없음' }),
          el('dt', { text: '재시도 · 맞음' }), el('dd', { text: r.retry ? count(r.retryCorrect, r.retry) : '없음' }),
          r.numeric ? el('dt', { text: '직접 계산 · 범위 안' }) : null, r.numeric ? el('dd', { text: count(r.numericOk, r.numeric) }) : null,
          el('dt', { text: '자기 점검 저장' }), el('dd', { text: r.self ? `${r.self}회 (점수 아님)` : '없음' }),
        ].filter(Boolean)) : el('p.small.muted', { text: '아직 푼 문항이 없습니다.' }),
        Object.keys(r.reads).length ? el('details', null, [el('summary', { text: '관찰별로 맞게 읽은 횟수' }),
          el('ul.fb-list', null, Object.entries(r.reads).map(([label, c]) => el('li', { text: `${label}: ${count(c.right, c.n)}` })))]) : null,
        r.first && r.first < 5 ? el('p.small.muted', { text: `첫 시도가 ${r.first}개뿐이라 이 영역을 판단하기엔 이릅니다.` }) : null,
      ].filter(Boolean)))),
      weak.size ? el('section.assess-weak', null, [
        el('h3', { text: '복습으로 이어갈 주제' }),
        el('ul', null, [...weak].map(([type, why]) => el('li', null, [
          el('b', { text: TASKS[type]?.[0] || type }), ` — ${why.map((w) => WHY[w]).join(', ')} `,
          TASKS[type] ? el('a', { href: `#/practice/chart/${type}`, text: '입문 연습에서 같은 주제 보기' }) : null,
        ]))),
        el('a.btn', { href: '#/practice/review', text: '복습 일정 보기' }),
      ]) : null,
    ].filter(Boolean));
  }

  const tried = Object.values(state.items).filter((e) => e?.first).length;
  clear(app).append(
    el('h1.page-title', { text: '새 구간에서 다시 읽기' }),
    el('p.page-sub', { text: '입문 과정의 차트나 정답 문장을 기억하는 것과, 다른 구간을 실제로 읽는 것은 다릅니다. 연습 화면에 나오지 않은 구간에서 같은 관찰을 해봅니다. 시간 제한은 없습니다.' }),
    el('div.row', { style: { marginBottom: '16px' } }, [el('a.btn', { href: '#/practice/chart', text: '입문 6단계로' }), el('a.btn', { href: '#/practice/review', text: '복습' }), el('a.btn', { href: '#/practice/records', text: '기록과 백업' })]),
    el('details.rulebox', null, [el('summary', { text: '‘새 구간’은 무엇을 뜻하나요?' }),
      el('p.small', { text: `평가 문항 ${items.length}개(${data.summary.tickers}개 종목)는 입문 과정 ${data.exposure.courseCases}사례와 실제 비교 연습 ${data.exposure.studyCases / 2}쌍의 화면 구간과 한 봉도 겹치지 않는 날짜에서 골랐습니다. 지표 계산에 쓰는 앞쪽 이력은 화면에 나오지 않으므로 겹침으로 세지 않습니다.` }),
      el('p.small', { text: '레슨의 예시 차트, 데이터 뷰어, 방향 예측 실험에서 무엇을 봤는지는 기록이 없어 확인하지 못합니다. 그래서 ‘한 번도 본 적 없는 차트’가 아니라 ‘이 기능의 기록상 처음 보는 구간’이라고 부릅니다.' }),
      el('p.small', { text: `이후 등락으로 문항을 고르지 않았습니다. 상태별로 고르게 뽑고 경계에 가까운 사례(${data.summary.edge}개)도 넣었습니다. 문항 비율을 시장에서 일어나는 비율로 읽으면 안 됩니다.` }),
      el('p.small.muted', { text: `평가 자료 ${data.version} · 입문 교재 ${data.courseVersion} · 규칙 ${data.provenance.rulesVersion}` }),
    ]),
    el('p.small.muted', { text: tried ? `지금까지 ${tried}개 문항을 처음 풀었습니다.` : '아직 푼 평가 문항이 없습니다.' }),
    area, saveNote, report);
  renderReport();
  if (!storage.available()) { saveNote.textContent = '이 브라우저는 저장이 막혀 있습니다. 풀 수는 있지만 기록이 남지 않습니다.'; saveNote.className = 'small warn'; }
  draw();
}
