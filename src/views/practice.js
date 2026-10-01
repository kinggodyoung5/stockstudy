import { buildPractice, recordAttempt } from '../content/practice.js';
import { createStockChart } from '../lib/chart.js';
import { el, clear } from '../lib/ui.js';
import * as storage from '../lib/storage.js';
import { renderRealStudy, destroyRealStudy } from './real-study.js';
import { renderChartCourse, destroyChartCourse } from './chart-course.js';
import { renderAssessment, destroyAssessment } from './assessment.js';
import { renderReview, destroyReview } from './review.js';
import { renderRecords } from './records.js';

let chart = null;
export function destroyPractice() {
  destroyChartCourse();
  destroyAssessment();
  destroyReview();
  destroyRealStudy();
  if (chart) { chart.destroy(); chart = null; }
}

export function renderPractice(app, params = []) {
  destroyPractice();
  if (params[0] === 'real') return renderRealStudy(app);
  if (params[0] === 'chart') return renderChartCourse(app, params[1]);
  if (params[0] === 'check') return renderAssessment(app);
  if (params[0] === 'review') return renderReview(app);
  if (params[0] === 'records') return renderRecords(app);
  const bank = buildPractice(Math.floor(Math.random() * 20));
  const loaded = storage.load('practice:v1', {});
  const records = loaded && typeof loaded === 'object' && !Array.isArray(loaded) ? loaded : {};
  let queue = [...bank];
  let index = 0;
  const status = el('p.small.muted', { 'aria-live': 'polite' });
  const saveNote = el('p.small.muted', { text: '답과 근거는 이 브라우저에만 저장됩니다. 정답은 선택지만 자동 채점하며, 서술한 근거는 해설과 직접 대조합니다.' });
  const area = el('section.panel.practice-card');
  function progress() {
    const seen = bank.filter((q) => records[q.id]?.attempts > 0);
    const first = seen.filter((q) => records[q.id].firstCorrect).length;
    const due = seen.filter((q) => records[q.id].dueAt <= Date.now()).length;
    status.textContent = `기초 개념 ${bank.length}개 중 ${seen.length}개 시도 · 첫 시도 정답 ${first}/${seen.length} · 복습할 개념 ${due}개. 이 수치는 기술적 분석 숙달 점수가 아닙니다.`;
  }
  function draw() {
    destroyPractice();
    clear(area);
    if (!queue.length) {
      area.append(el('h2', { text: '지금 복습할 문제가 없습니다' }), el('p', { text: '전체 연습을 하거나, 며칠 뒤 다시 풀어보세요. 실제 차트에서는 아래 종합 과제도 해보세요.' }));
      return;
    }
    const q = queue[index];
    let submitted = false;
    const choices = el('fieldset.practice-options');
    choices.append(el('legend', { text: '해석 선택' }));
    // 선택지 위치를 바꿔 번호 기억보다 내용을 읽게 한다.
    const shift = Math.floor(Math.random() * q.options.length);
    const order = q.options.map((_, i) => (i + shift) % q.options.length);
    order.forEach((i) => choices.append(el('label.practice-option', null, [
      el('input', { type: 'radio', name: 'practice-choice', value: i }), el('span', { text: q.options[i] }),
    ])));
    const reason = el('textarea', { id: 'practice-reason', rows: 3, maxlength: 1000, placeholder: '관찰한 값이나 조건을 쓰고, 그것이 무엇을 뜻하는지 설명하세요.' });
    const confidence = el('select', { id: 'practice-confidence' }, [
      el('option', { value: 'unsure', text: '아직 확신이 낮다' }), el('option', { value: 'sure', text: '근거를 설명할 수 있다' }),
    ]);
    const feedback = el('div.practice-feedback', { 'aria-live': 'polite' });
    const submit = el('button.btn.primary', { text: '근거를 적고 정답 확인', type: 'button' });
    submit.addEventListener('click', () => {
      if (submitted) return;
      const selected = choices.querySelector('input:checked');
      if (!selected || reason.value.trim().length < 8) {
        clear(feedback).append(el('p.warn', { text: '해석을 선택하고 근거를 8자 이상 적어주세요. 정답을 보기 전 생각을 남기는 단계입니다.' }));
        return;
      }
      submitted = true;
      const correct = Number(selected.value) === q.answer;
      const previous = records[q.id];
      records[q.id] = recordAttempt(previous, { correct, reason: reason.value, confidence: confidence.value });
      if (!storage.save('practice:v1', records)) saveNote.textContent = '브라우저 저장이 차단되었거나 용량이 부족합니다. 이번 화면에서는 연습할 수 있지만 기록은 유지되지 않습니다.';
      progress();
      submit.disabled = true; choices.disabled = true; reason.readOnly = true; confidence.disabled = true;
      clear(feedback).append(...[
        el('h3', { text: correct ? '선택지 정답 — 근거도 대조해보세요' : '다시 확인할 개념이 있습니다' }),
        el('p', { text: `정답: ${q.options[q.answer]}` }),
        el('p', { text: q.explanation }),
        !correct && confidence.value === 'sure' ? el('p.warn', { text: '확신했던 부분이 해설과 다릅니다. 어떤 기준을 혼동했는지 특히 확인하세요.' }) : null,
        el('p.small.muted', { text: '내 근거에 관찰 사실이 있는지, 해석을 확정 예측으로 바꾸지는 않았는지 직접 점검하세요. 근거 내용은 자동 채점하지 않았습니다.' }),
        previous?.reason ? el('details', null, [el('summary', { text: '지난 근거와 비교' }), el('p', { text: previous.reason })]) : null,
        el('a.btn', { href: `#/learn/${q.lesson}`, text: '관련 개념 다시 읽기' }),
        el('button.btn', { text: index + 1 < queue.length ? '다음 개념' : '이번 연습 마치기', onclick: () => {
          if (index + 1 < queue.length) { index++; draw(); }
          else { destroyPractice(); clear(area).append(el('h2', { text: '이번 연습을 마쳤습니다' }), el('p', { text: '복습할 개념을 다시 풀거나 아래 종합 과제로 옮겨가세요. 정답을 기억하는 것과 새 차트를 설명하는 것은 다릅니다.' })); }
        } }),
      ].filter(Boolean));
    });
    const chartBox = q.candles ? el('div.chart-box', { 'aria-label': '학습용 구성 차트' }) : null;
    area.append(...[el('p.small.muted', { text: `${index + 1}/${queue.length} · 학습용 구성 예제 (실제 종목 아님)` }),
      el('h2', { text: q.title }), el('p', { text: q.prompt }), el('p.practice-facts', { text: q.facts }), chartBox,
      choices, el('label.practice-label', { for: 'practice-reason', text: '내가 그렇게 읽은 근거' }), reason,
      el('label.practice-label', { for: 'practice-confidence', text: '정답을 보기 전 확신 정도' }), confidence,
      el('div.row', { style: { marginTop: '16px' } }, [submit]), feedback].filter(Boolean));
    if (chartBox && chartBox.isConnected) {
      chart = createStockChart(chartBox, { height: 280 });
      chart.setCandles(q.candles); chart.fit();
    }
  }
  const resetQueue = (review) => {
    queue = review ? bank.filter((q) => records[q.id]?.dueAt <= Date.now()) : [...bank];
    index = 0; draw();
  };
  clear(app).append(el('h1.page-title', { text: '기초 읽기 연습' }),
    el('p.page-sub', { text: '예측이 아니라 관찰·조건·한계를 연습합니다. 답을 고르고 근거를 남긴 뒤 해설과 비교하세요.' }), status,
    el('div.row', { style: { marginBottom: '16px' } }, [
      el('button.btn', { text: '전체 개념 연습', onclick: () => resetQueue(false) }),
      el('button.btn', { text: '복습할 개념만', onclick: () => resetQueue(true) }),
      el('a.btn.primary', { href: '#/practice/chart', text: '실제 차트 · 입문 6단계' }),
      el('a.btn', { href: '#/practice/real', text: '실제 차트 비교 연습' }),
      el('a.btn', { href: '#/practice/check', text: '새 구간에서 다시 읽기' }),
      el('a.btn', { href: '#/practice/review', text: '실제 사례 복습' }),
      el('a.btn', { href: '#/practice/records', text: '기록과 백업' }),
    ]), area, saveNote,
    el('section.panel', { style: { marginTop: '20px' } }, [
      el('h2', { text: '실제 차트로 옮겨가는 종합 과제' }),
      el('p', { text: '처음 보는 종목의 날짜를 정하고 지표를 끈 뒤, 봉 단위·추세·지지와 저항 후보를 적으세요. 그다음 지표 하나를 켜고 설명이 달라지는지 비교합니다.' }),
      el('ol', null, ['관찰: 어떤 고점·저점과 가격대를 근거로 삼았나?', '해석: 지표가 무엇을 계산하며 설정값은 무엇인가?', '반대 증거: 내 설명과 맞지 않는 부분은 무엇인가?', '무효 조건: 어떤 관찰이 나오면 설명을 바꿀 것인가?', '복기: 이후 결과와 당시 근거의 정확성을 따로 평가했나?'].map((text) => el('li', { text }))),
      el('p.small.muted', { text: '이 과제는 자기 점검용이며 자동 채점하지 않습니다. 며칠 뒤 다른 종목에서도 도움말 없이 반복하세요.' }),
      el('a.btn', { href: '#/viewer', text: '실제 차트에서 연습' }),
    ]));
  progress(); draw();
}
