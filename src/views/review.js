/**
 * 실제 사례 복습 (#/practice/review)
 * 오답·낮은 확신·도움 사용·자기 점검에서 남긴 어려움을 같은 개념의 다른 실제 사례로 다시 읽는다.
 * 처음 기록은 읽기 전용으로 보여주고, 복습 시도는 따로 쌓는다.
 */
import { loadChartCourse, loadStock } from '../lib/data.js';
import { COURSE_VERSION, TASKS, openCourseCase } from '../lib/chart-course.js';
import { CONFIDENCE } from '../lib/course-feedback.js';
import { REVIEW_KEY, REVIEW_RULE, REASONS, DAY, reviewSources, normalizeReview, reviewEntries, pickReviewCase, reviewAttempt, addReviewAttempt, schedule } from '../lib/review.js';
import { el, clear } from '../lib/ui.js';
import * as storage from '../lib/storage.js';
import { autoCheck } from './course-feedback.js';
import { drawCaseCharts, factsList, optionsField, pickedChoice, confidenceField, numericField, caseHeader, rulesBox, legendNotes } from './case-view.js';

let generation = 0, cleanup = null;
function clearCharts() { if (cleanup) { cleanup(); cleanup = null; } }
export function destroyReview() { generation++; clearCharts(); }

const date = (t) => new Date(t).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
const when = (t, now) => (t <= now ? '지금' : `${date(t)} (${Math.ceil((t - now) / DAY)}일 뒤)`);

/** 이 앱의 학습 기록 저장값을 모두 읽는다. 읽기만 한다. */
export function readStore() {
  const out = {};
  for (const key of storage.keys()) out[key] = storage.load(key, null);
  return out;
}

/** 처음 기록 요약. 저장된 값만 보여주며 다시 채점하지 않는다. */
export function firstRecordView(source) {
  const r = source.record, title = TASKS[source.ref.type]?.[0] || source.ref.type;
  const old = source.kind === 'course' && source.version !== COURSE_VERSION;
  return el('section.review-first', null, [
    el('h3', { text: '처음 기록 · 바뀌지 않습니다' }),
    el('p.small.muted', { text: `${source.kind === 'course' ? '입문 과정' : '새 구간 평가'} · ${title} · ${source.ref.ticker} · 관찰 마감 ${source.ref.date} · ${new Date(r.submittedAt).toLocaleString('ko-KR')}` }),
    el('dl.assess-kv', null, [
      el('dt', { text: '고른 답' }), el('dd', { text: r.choiceText || `선택지 ${r.choice + 1}번 (이전 형식이라 문장은 저장되지 않았습니다)` }),
      el('dt', { text: '자동 확인' }), el('dd', { text: r.correct ? '맞음' : '다시 볼 관찰 있음' }),
      el('dt', { text: '확신' }), el('dd', { text: r.confidence ? CONFIDENCE[r.confidence] : '표시 안 함' }),
      source.kind === 'check' ? el('dt', { text: '도움' }) : null,
      source.kind === 'check' ? el('dd', { text: r.help && Object.values(r.help).some(Boolean) ? '받음' : '받지 않음' }) : null,
    ].filter(Boolean)),
    r.reflection ? el('p.small', { text: '처음 쓴 근거' }) : null,
    r.reflection ? el('blockquote.fb-quote', { text: r.reflection }) : null,
    r.self?.note ? el('p.small', { text: '해설을 본 뒤의 생각' }) : null,
    r.self?.note ? el('blockquote.fb-quote', { text: r.self.note }) : null,
    el('p.small.muted', { text: `복습 이유: ${source.reasons.map((w) => REASONS[w]).join(', ')}` }),
    old ? el('p.small.warn', { text: `이전 교재 버전(${source.version}) 기록입니다. 저장된 정답 여부를 그대로 보여주며 지금 기준으로 다시 채점하지 않았습니다.` }) : null,
  ].filter(Boolean));
}

export async function renderReview(app) {
  destroyReview();
  const token = generation;
  const course = await loadChartCourse();
  if (token !== generation || !app.isConnected) return;
  const currentKey = `chart-course:${course.version}:${course.provenance.sourceDigest}`;
  let review = normalizeReview(storage.load(REVIEW_KEY, null));
  let serial = 0;
  const listArea = el('section.review-list');
  const area = el('section.panel.practice-card');
  const saveNote = el('p.small.muted', { 'aria-live': 'polite' });

  function current() {
    const store = readStore();
    const tried = new Set(Object.keys(store[currentKey] || {}));
    return { store, tried, entries: reviewEntries(reviewSources(store), review, Date.now()) };
  }

  function renderList() {
    const { entries } = current(), now = Date.now();
    const due = entries.filter((e) => e.due), later = entries.filter((e) => !e.due && !e.plan.done), done = entries.filter((e) => e.plan.done);
    const row = (e) => el('li', null, [
      el('b', { text: TASKS[e.source.ref.type][0] }),
      ` · ${e.source.kind === 'course' ? '입문 과정' : '새 구간 평가'} · ${e.source.reasons.map((w) => REASONS[w]).join(', ')} · 복습 ${e.attempts.length}회`,
      e.due ? el('button.btn.small-btn', { text: '복습하기', onclick: () => run(e.source.id) })
        : el('span.small.muted', { text: e.plan.done ? ' · 일정 끝남' : ` · 다음 복습 ${when(e.plan.dueAt, now)}` }),
      e.plan.done ? el('button.btn.small-btn', { text: '한 번 더 보기', onclick: () => run(e.source.id) }) : null,
      !e.due && !e.plan.done ? el('button.btn.small-btn', { text: '미리 하기', onclick: () => run(e.source.id) }) : null,
    ].filter(Boolean));
    clear(listArea).append(...[
      el('h2', { text: `지금 복습할 것 ${due.length}개` }),
      due.length ? el('ul.review-items', null, due.map(row)) : el('p.small.muted', { text: entries.length ? '지금 예정된 복습은 없습니다.' : '아직 복습할 기록이 없습니다. 입문 과정이나 새 구간 평가에서 틀렸거나 확신이 낮았던 문항이 여기에 올라옵니다.' }),
      later.length ? el('details', null, [el('summary', { text: `예정된 복습 ${later.length}개` }), el('ul.review-items', null, later.map(row))]) : null,
      done.length ? el('details', null, [el('summary', { text: `일정을 끝낸 복습 ${done.length}개` }), el('ul.review-items', null, done.map(row))]) : null,
    ].filter(Boolean));
  }

  async function run(sourceId) {
    const drawToken = ++serial;
    clearCharts();
    const { entries, tried } = current();
    const entry = entries.find((e) => e.source.id === sourceId);
    if (!entry) return;
    const pick = pickReviewCase(entry.source, entry.attempts, course.cases, tried, String(entry.attempts.length));
    clear(area).append(el('p.loading', { text: '복습할 실제 사례를 준비하는 중…' }));
    area.scrollIntoView({ block: 'start' });
    if (!pick) { clear(area).append(firstRecordView(entry.source), el('p.warn', { text: '이 주제의 실제 사례를 현재 교재에서 찾지 못했습니다.' })); return; }
    try {
      const stock = await loadStock(pick.ref.ticker);
      if (token !== generation || drawToken !== serial || !app.isConnected) return;
      const { question: q, history, view } = openCourseCase(stock, pick.ref);
      const chartBox = el('div.chart-box', { 'aria-label': '관찰 마감일까지의 실제 일봉 차트' });
      const panelWrap = el('div.panels');
      const feedback = el('div.practice-feedback', { 'aria-live': 'polite' });
      const options = optionsField(q, 'review-answer');
      const confidence = confidenceField('review-confidence');
      const { box: numericBox, input: numericInput } = numericField(q, 'review-numeric', q.numeric && `선택 입력입니다. ‘차트에서 비교할 값’의 숫자로 나눠 소수 ${q.numeric.decimals}째 자리까지 적습니다.`);
      const reflection = el('textarea', { id: 'review-reflection', rows: 3, maxlength: 1500, placeholder: '눈에 보이는 값이나 위치를 근거로 적어보세요.' });
      const submit = el('button.btn.primary', { text: '제출하고 해설 보기' });
      let submitted = false;
      submit.addEventListener('click', () => {
        if (submitted) return;
        try {
          const level = confidence.querySelector('input:checked');
          const attempt = reviewAttempt(q, pick.ref, pick.mode, { choice: pickedChoice(options), confidence: level?.value, numeric: numericInput?.value, reflection: reflection.value });
          submitted = true;
          review = addReviewAttempt(review, sourceId, attempt);
          if (!storage.save(REVIEW_KEY, review)) { saveNote.textContent = '복습 기록을 저장하지 못했습니다. 브라우저 저장이 막혀 있거나 공간이 부족할 수 있습니다. ‘기록과 백업’에서 내보내기를 먼저 해두세요.'; saveNote.className = 'small warn'; }
          options.disabled = true; confidence.disabled = true; reflection.readOnly = true; submit.disabled = true;
          if (numericInput) numericInput.readOnly = true;
          const plan = schedule(entry.source, review.entries[sourceId].attempts);
          clear(feedback).append(
            el('h3', { text: attempt.correct ? '관찰과 선택이 맞았습니다' : '다시 볼 관찰이 있습니다' }),
            autoCheck(q, attempt),
            el('h4', { text: '해설' }), el('p', { text: `정답: ${q.options[q.answer]}` }), el('p', { text: q.explanation }),
            el('p.small.muted', { text: plan.done ? '7일 간격 복습까지 연속으로 맞혀 이 복습 일정을 끝냈습니다. 익혔다는 인증은 아닙니다.' : `다음 복습: ${when(plan.dueAt, Date.now())}. ${REVIEW_RULE}` }),
            el('a.btn', { href: `#/learn/${q.lesson}`, text: '관련 개념 읽기' }),
          );
          renderList();
        } catch (error) { clear(feedback).append(el('p.warn', { text: error.message })); }
      });
      clear(area).append(...[
        firstRecordView(entry.source),
        entry.attempts.length ? el('details', null, [el('summary', { text: `지난 복습 ${entry.attempts.length}회` }),
          el('ul.fb-list', null, entry.attempts.map((a) => el('li', { text: `${new Date(a.submittedAt).toLocaleDateString('ko-KR')} · ${a.ref.ticker} ${a.ref.date} · ${a.mode === 'same' ? '원래 사례' : '다른 사례'} · ${a.correct ? '맞음' : '다시 볼 관찰 있음'}` })))]) : null,
        el('hr'),
        ...caseHeader(q, `${stock.name} (${stock.ticker}) · 일봉 · 관찰 마감 ${pick.ref.date}`),
        el('p.small.assess-tag', { text: pick.mode === 'same' ? '원래 사례 재복습 · 같은 주제의 다른 실제 사례가 없습니다' : '같은 개념의 다른 실제 사례' }),
        el('details.course-help', null, [el('summary', { text: '읽는 방법' }), el('p', { text: q.hint })]),
        rulesBox(q), chartBox, panelWrap, ...legendNotes(q),
        el('details.course-help', null, [el('summary', { text: '차트에서 비교할 값' }), factsList(q, stock.currency)]),
        numericBox, options, confidence,
        q.reflection ? el('label.practice-label', { for: 'review-reflection', text: q.reflection }) : null,
        q.reflection ? reflection : null, submit, feedback,
      ].filter(Boolean));
      cleanup = drawCaseCharts(chartBox, panelWrap, q, view, history, pick.ref.date);
    } catch (error) {
      if (token === generation && drawToken === serial && app.isConnected) clear(area).append(el('p.error', { text: error.message }));
    }
  }

  clear(app).append(
    el('h1.page-title', { text: '실제 사례 복습' }),
    el('p.page-sub', { text: '틀렸거나 확신이 낮았던 개념을 같은 개념의 다른 실제 차트로 다시 읽습니다. 처음 기록은 그대로 두고, 복습 시도는 따로 남깁니다.' }),
    el('div.row', { style: { marginBottom: '16px' } }, [el('a.btn', { href: '#/practice/chart', text: '입문 6단계' }), el('a.btn', { href: '#/practice/check', text: '새 구간에서 다시 읽기' }), el('a.btn', { href: '#/practice/records', text: '기록과 백업' })]),
    el('details.rulebox', null, [el('summary', { text: '복습 일정은 어떻게 정하나요?' }), el('p.small', { text: REVIEW_RULE }),
      el('p.small', { text: '복습 사례는 입문 과정의 사례 중 같은 주제에서 고릅니다. 새 구간 평가 문항은 복습에 쓰지 않습니다. 평가와 연습을 섞지 않기 위해서입니다.' })]),
    listArea, area, saveNote);
  clear(area).append(el('p.small.muted', { text: '위 목록에서 ‘복습하기’나 ‘미리 하기’를 누르면 여기에 실제 사례가 나옵니다.' }));
  renderList();
}
