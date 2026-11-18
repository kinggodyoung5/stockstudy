/**
 * 종합 읽기와 계획 (#/practice/plan)
 * 한 장의 실제 차트를 관찰 → 근거 → 계획 순서로 읽는다. 관찰은 자동으로 확인하고, 근거와 계획은 채점하지 않는다.
 * 이후 20봉은 제출한 뒤에만 공개한다. 공개한 결과로 계획이나 관찰을 채점하지 않는다.
 */
import { loadChartCourse, loadStock } from '../lib/data.js';
import { CONFIDENCE } from '../lib/course-feedback.js';
import { CAPSTONE_KEY, NOTE_FIELDS, CAPSTONE_SELF, NOTE_MIN, capstoneRefs, capstoneId, openCapstone, revealWindow, capstoneRecord,
  capstoneOutcome, capstoneReview, capstoneSummary } from '../lib/capstone.js';
import { planError, planMetrics, sizeFor, planNotices, PLAN_DAYS } from '../lib/plan.js';
import { el, clear } from '../lib/ui.js';
import * as storage from '../lib/storage.js';
import { autoCheck, selfCheck } from './course-feedback.js';
import { drawCaseCharts, optionsField, pickedChoice, confidenceField, factsList } from './case-view.js';

let generation = 0, cleanup = null;
function clearCharts() { if (cleanup) { cleanup(); cleanup = null; } }
export function destroyPlan() { generation++; clearCharts(); }

const n = (v, d = 2) => (v == null || !Number.isFinite(v) ? '—' : Number(v).toLocaleString('ko-KR', { maximumFractionDigits: d }));
const OUTCOME_TEXT = {
  invalid: '무효 가격에 먼저 닿았습니다.',
  target: '지켜볼 가격에 먼저 닿았습니다.',
  'same-bar': '같은 봉에서 무효 가격과 지켜볼 가격에 모두 닿았습니다. 일봉으로는 어느 쪽이 먼저였는지 알 수 없습니다.',
  none: `${PLAN_DAYS}봉 동안 무효 가격에도 지켜볼 가격에도 닿지 않았습니다.`,
  incomplete: `저장된 자료가 ${PLAN_DAYS}봉보다 짧아 끝까지 볼 수 없습니다.`,
};

function loadState() {
  const raw = storage.load(CAPSTONE_KEY, null);
  return raw && raw.v === 1 && raw.items && typeof raw.items === 'object' ? raw : { v: 1, items: {} };
}

export async function renderPlan(app) {
  destroyPlan();
  const token = generation;
  const course = await loadChartCourse();
  if (token !== generation || !app.isConnected) return;
  const refs = capstoneRefs(course.cases);
  let state = loadState(), cursor = Math.max(0, refs.findIndex((r) => !state.items[capstoneId(r)])), serial = 0;
  const area = el('section.panel.practice-card.capstone');
  const summary = el('p.small.muted', { 'aria-live': 'polite' });
  const saveNote = el('p.small.muted', { 'aria-live': 'polite' });
  const nextButton = el('button.btn', { text: '다른 차트', onclick: () => { cursor = (cursor + 1) % refs.length; draw(); } });

  function persist() {
    if (storage.save(CAPSTONE_KEY, state)) return true;
    saveNote.textContent = '저장하지 못했습니다. 브라우저 저장이 막혀 있거나 공간이 부족할 수 있습니다. ‘기록과 백업’에서 내보내기를 먼저 해 두세요.';
    saveNote.className = 'small warn';
    return false;
  }
  function renderSummary() {
    const s = capstoneSummary(state.items);
    summary.textContent = s.n
      ? `관찰지 ${s.n}개 · 관찰 문항 ${s.partsN}개 중 ${s.partsOk}개 맞게 읽음 · 계획 ${s.plans}개, 관망 ${s.passes}개${s.medianRiskAtr != null ? ` · 무효 가격까지 거리의 가운데 값 ATR ${n(s.medianRiskAtr)}배` : ''}. 계획이 맞았는지는 세지 않습니다.`
      : '아직 쓴 관찰지가 없습니다.';
  }

  async function draw() {
    const drawToken = ++serial;
    clearCharts(); nextButton.disabled = true;
    clear(area).append(el('p.loading', { text: '실제 차트를 준비하는 중…' }));
    try {
      let open = null, ref = null, stock = null;
      // 관찰 문항이 4개보다 적은 날은 건너뛴다.
      for (let tries = 0; tries < refs.length && !open; tries++) {
        ref = refs[cursor];
        stock = await loadStock(ref.ticker);
        if (token !== generation || drawToken !== serial || !app.isConnected) return;
        open = openCapstone(stock, ref);
        if (!open) cursor = (cursor + 1) % refs.length;
      }
      if (!open) throw new Error('관찰지로 쓸 수 있는 차트를 찾지 못했습니다.');
      const id = capstoneId(ref), existing = state.items[id]?.submittedAt ? state.items[id] : null;
      build(stock, ref, open, id, existing);
    } catch (error) {
      if (token === generation && drawToken === serial && app.isConnected) clear(area).append(el('p.error', { text: error.message }));
    } finally {
      if (token === generation && drawToken === serial) nextButton.disabled = false;
    }
  }

  function build(stock, ref, open, id, existing) {
    const unit = stock.currency === 'USD' ? '달러' : '원';
    const chartBox = el('div.chart-box', { 'aria-label': '관찰 마감일까지의 실제 일봉 차트' });
    const panelWrap = el('div.panels');
    const mtf = open.parts.find((q) => q.type === 'mtf');
    // 문항이 '표시한' 고점·저점을 묻는 경우가 있어, 각 문항의 표시를 차트 하나에 모은다.
    const partMarkers = open.parts.flatMap((q) => q.markers || []);
    const chartQ = { overlays: { ma20: true, ma60: true, volume: true }, panels: ['rsi', 'macd'], markers: partMarkers, lines: [],
      weekly: mtf?.weekly, weeklyHistory: mtf?.weeklyHistory, weeklyOverlays: mtf?.weeklyOverlays, focusDate: mtf?.focusDate, weeklyMarkerText: mtf?.weeklyMarkerText };

    // 1. 관찰: 주제마다 같은 날짜의 입문 문제
    const partBoxes = open.parts.map((q, k) => {
      const options = optionsField(q, `cap-${q.type}`, existing?.parts?.[q.type]?.choice ?? null);
      options.querySelector('legend').textContent = q.prompt;
      const feedback = el('div.cap-part-feedback');
      return { q, options, feedback, node: el('section.cap-part', null, [el('h4.cap-title', { text: `${k + 1}. ${q.title}` }), options,
        el('details.course-help', null, [el('summary', { text: '읽는 방법' }), el('p', { text: q.hint })]), feedback]) };
    });

    // 2. 근거 네 칸
    const notes = Object.fromEntries(NOTE_FIELDS.map(([k, , hint]) => [k, el('textarea', { id: `cap-${k}`, rows: 3, maxlength: 1000, placeholder: hint })]));
    if (existing) for (const [k] of NOTE_FIELDS) { notes[k].value = existing.notes[k]; notes[k].readOnly = true; }

    // 3. 계획
    const modeName = 'cap-plan-mode';
    const modePlan = el('input', { type: 'radio', name: modeName, value: 'plan', checked: existing?.plan?.mode === 'plan' });
    const modePass = el('input', { type: 'radio', name: modeName, value: 'pass', checked: existing?.plan?.mode === 'pass' });
    const invalid = el('input', { type: 'text', id: 'cap-invalid', inputmode: 'decimal', autocomplete: 'off', placeholder: '예: 47500' });
    const target = el('input', { type: 'text', id: 'cap-target', inputmode: 'decimal', autocomplete: 'off', placeholder: '비워도 됩니다' });
    if (existing?.plan?.mode === 'plan') { invalid.value = String(existing.plan.invalid); target.value = existing.plan.target ?? ''; }
    const calc = el('div.cap-calc', { 'aria-live': 'polite' });
    const planFields = el('div.cap-plan-fields', null, [
      el('label.practice-label', { for: 'cap-invalid', text: `무효 가격 (${unit}) · 종가가 여기 닿으면 내 해석이 틀렸다고 볼 가격` }), invalid,
      el('label.practice-label', { for: 'cap-target', text: `지켜볼 가격 (${unit}, 선택) · 근거를 댈 수 있는 위쪽 가격대` }), target, calc,
    ]);
    const toNum = (s) => (String(s).trim() === '' ? null : Number(String(s).replace(/,/g, '')));
    function updateCalc() {
      planFields.hidden = !modePlan.checked;
      clear(calc);
      if (!modePlan.checked) return;
      const inv = toNum(invalid.value), tgt = toNum(target.value);
      if (inv == null) { calc.append(el('p.small.muted', { text: '무효 가격을 적으면 거리와 수량을 계산합니다.' })); return; }
      const err = planError({ close: open.close, invalid: inv, target: tgt });
      if (err) { calc.append(el('p.small.warn', { text: err })); return; }
      const m = planMetrics({ close: open.close, atr: open.atr, invalid: inv, target: tgt });
      const size = sizeFor({ account: stock.currency === 'USD' ? 10000 : 10000000, riskPercent: 1, close: open.close, invalid: inv });
      calc.append(el('dl.assess-kv', null, [
        el('dt', { text: '무효 가격까지' }), el('dd', { text: `${n(m.riskPct)}% · ATR ${n(m.riskAtr)}배` }),
        el('dt', { text: '지켜볼 가격까지' }), el('dd', { text: m.rewardPct != null ? `${n(m.rewardPct)}%` : '적지 않음' }),
        el('dt', { text: '손익비' }), el('dd', { text: m.ratio != null ? n(m.ratio) : '—' }),
        el('dt', { text: '수량 예시' }), el('dd', { text: `계좌 ${stock.currency === 'USD' ? '1만 달러' : '1,000만 원'}에서 1%만 잃기로 하면 ${size.shares}주 (${n(size.amount, 0)} ${unit})` }),
      ]), ...planNotices(m).map((t) => el('p.small.warn', { text: t })),
      el('p.small.muted', { text: '계산만 합니다. 이 계획이 좋은지 나쁜지는 판정하지 않습니다. 수량 예시는 계산법을 보여주기 위한 숫자입니다.' }));
    }
    [modePlan, modePass].forEach((r) => r.addEventListener('change', updateCalc));
    [invalid, target].forEach((r) => r.addEventListener('input', updateCalc));

    const confidence = confidenceField('cap-confidence', existing?.confidence ?? null);
    const submit = el('button.btn.primary', { text: '제출하고 확인하기' });
    const feedback = el('div.practice-feedback', { 'aria-live': 'polite' });

    function lock() {
      partBoxes.forEach((p) => { p.options.disabled = true; });
      Object.values(notes).forEach((t) => { t.readOnly = true; });
      [modePlan, modePass, invalid, target].forEach((x) => { x.disabled = true; });
      confidence.disabled = true; submit.disabled = true;
    }

    function reveal(record) {
      lock();
      for (const p of partBoxes) {
        const r = record.parts[p.q.type];
        if (!r) continue;
        clear(p.feedback).append(autoCheck(p.q, { choice: r.choice, correct: r.correct, auto: { wrong: r.wrong, numeric: null }, confidence: null }));
      }
      // 이후 20봉 공개
      clearCharts();
      const win = revealWindow(stock, open.i);
      const lines = record.plan?.mode === 'plan'
        ? [{ points: [{ date: ref.date, value: record.plan.invalid }, { date: stock.candles[win.end].date, value: record.plan.invalid }] },
          ...(record.plan.target != null ? [{ points: [{ date: ref.date, value: record.plan.target }, { date: stock.candles[win.end].date, value: record.plan.target }] }] : [])]
        : [];
      cleanup = drawCaseCharts(chartBox, clear(panelWrap), { ...chartQ, markers: [...partMarkers, { date: ref.date, text: '관찰 마감', position: 'aboveBar' }], lines }, win.view, win.history, stock.candles[win.end].date);
      const outcome = capstoneOutcome(stock, open.i, record);
      const right = Object.values(record.parts).filter((p) => p.correct).length;
      clear(feedback).append(...[
        el('h3', { text: '제출한 관찰지' }),
        el('p', { text: `관찰 문항 ${Object.keys(record.parts).length}개 중 ${right}개를 맞게 읽었습니다. 각 문항 아래에서 다시 볼 관찰을 확인하세요.` }),
        el('h4', { text: `이후 ${PLAN_DAYS}봉 (차트에 공개됨)` }),
        record.plan?.mode === 'plan'
          ? el('p', { text: `${OUTCOME_TEXT[outcome.first]}${outcome.first !== 'none' && outcome.first !== 'incomplete' ? ` (${outcome.date}, 마감 뒤 ${outcome.bar}번째 봉)` : ''} 마지막으로 본 종가는 위험 1단위의 ${n(outcome.endR)}배 자리입니다.${outcome.gapThrough ? ' 그날 시가가 이미 무효 가격 아래에서 시작해 계획보다 더 잃는 자리였습니다.' : ''}` })
          : el('p', { text: '이 차트에서는 계획을 세우지 않기로 했습니다(관망). 관망도 계획입니다.' }),
        el('p.small.muted', { text: '계획대로 됐는지와 계획이 타당했는지는 다른 질문입니다. 이 결과로 관찰이나 계획을 채점하지 않습니다. 같은 근거로도 결과는 달라질 수 있습니다.' }),
        selfCheck({ selfChecks: CAPSTONE_SELF }, { ...record, reflection: NOTE_FIELDS.map(([k, label]) => `${label}: ${record.notes[k]}`).join('\n') }, (checks, note) => {
          const updated = capstoneReview(state.items[id], checks, note);
          state = { ...state, items: { ...state.items, [id]: updated } };
          if (!persist()) throw new Error('저장하지 못했습니다. 브라우저 저장이 막혀 있거나 공간이 부족할 수 있습니다.');
          return updated;
        }),
        el('button.btn', { text: '다른 차트로', onclick: () => { cursor = (cursor + 1) % refs.length; draw(); } }),
      ]);
    }

    submit.addEventListener('click', () => {
      try {
        const record = capstoneRecord(open, {
          choices: Object.fromEntries(partBoxes.map((p) => [p.q.type, pickedChoice(p.options)])),
          notes: Object.fromEntries(Object.entries(notes).map(([k, t]) => [k, t.value])),
          plan: { mode: modePlan.checked ? 'plan' : modePass.checked ? 'pass' : null, invalid: toNum(invalid.value), target: toNum(target.value) },
          confidence: confidence.querySelector('input:checked')?.value,
        });
        if (state.items[id]?.submittedAt) return;
        state = { ...state, items: { ...state.items, [id]: record } };
        persist(); renderSummary(); reveal(record);
      } catch (error) { clear(feedback).append(el('p.warn', { text: error.message })); }
    });

    const facts = factsList({ facts: [['오늘 종가', n(open.close, 4), 'price'], ['ATR(14)', n(open.atr, 4), 'price']] }, stock.currency);
    const chartSide = el('section.study-chart-side', { 'aria-label': '차트 관찰' }, [
      el('p.small.muted.case-meta', { text: `${stock.name} (${stock.ticker}) · 일봉 · 관찰 마감 ${ref.date}` }),
      el('h2.course-title', { text: '한 장의 차트 읽기' }),
      chartBox, panelWrap,
      el('p.small.muted.chart-legend', { text: '이동평균: 초록 20일, 보라 60일. 아래쪽 막대는 거래량, 그 아래는 RSI와 MACD입니다. 주봉 차트가 있으면 맨 아래에 있습니다.' }),
    ]);
    const noteSide = el('section.study-note-side', { 'aria-label': '관찰 노트' }, [
      el('div.note-heading', { text: '관찰지' }),
      el('p.small', { text: '위에서부터 차례로 읽습니다. 큰 구조 → 시간 단위 → 평균 → 거래량 → 모멘텀. 해설은 모두 제출한 뒤에 열립니다.' }),
      el('h3', { text: '1. 차트에서 읽기 (자동 확인)' }), ...partBoxes.map((p) => p.node),
      el('h3', { text: '2. 근거 쓰기 (자동 채점하지 않음)' }),
      el('p.small.muted', { text: `칸마다 ${NOTE_MIN}자 이상. 위에서 고른 관찰을 숫자·날짜와 함께 옮겨 적고, 반대 근거도 씁니다.` }),
      ...NOTE_FIELDS.flatMap(([k, label]) => [el('label.practice-label', { for: `cap-${k}`, text: label }), notes[k]]),
      el('h3', { text: '3. 계획' }),
      el('details.course-help', null, [el('summary', { text: '현재가와 ATR' }), facts]),
      el('fieldset.course-confidence', null, [el('legend', { text: '이 차트에서' }),
        el('label', null, [modePlan, el('span', { text: '매수 계획을 세운다' })]),
        el('label', null, [modePass, el('span', { text: '계획을 세우지 않는다 (관망)' })])]),
      planFields, confidence, submit, feedback,
    ]);
    clear(area).append(el('div.study-desk', null, [chartSide, noteSide]));
    area.classList.add('study-workspace');
    cleanup = drawCaseCharts(chartBox, panelWrap, chartQ, open.view, open.history, ref.date);
    updateCalc();
    if (existing) reveal(existing);
  }

  clear(app).append(
    el('h1.page-title', { text: '종합 읽기와 계획' }),
    el('p.page-sub', { text: '앞에서 따로 연습한 관찰을 한 장의 차트에서 모두 해 봅니다. 읽은 것을 근거로 적고, 내 해석이 틀렸다고 볼 가격까지 숫자로 적습니다. 어디서 사고팔지 알려주는 화면이 아닙니다.' }),
    el('div.row', { style: { marginBottom: '16px' } }, [nextButton, el('a.btn', { href: '#/learn/plan-risk', text: '레슨: 계획을 숫자로 적기' }), el('a.btn', { href: '#/learn/analysis-process', text: '레슨: 한 장의 차트를 설명하는 순서' })]),
    summary, area, saveNote,
    el('details.rulebox', null, [el('summary', { text: '어떤 차트가 나오나요?' }),
      el('p.small', { text: `실제 차트 8단계 교재 가운데 주봉과 일봉, 돌파한 날, 돌파 뒤 되돌림 주제의 사례 ${refs.length}개를 씁니다. 같은 차트를 입문 연습에서 이미 봤을 수 있습니다. 관찰 문항은 그날까지의 봉으로만 계산합니다.` }),
      el('p.small', { text: '매수 쪽 계획만 다룹니다. 공매도는 다루지 않습니다. 계획의 좋고 나쁨이나 이후 결과로 점수를 매기지 않습니다.' })]),
  );
  renderSummary();
  draw();
}
