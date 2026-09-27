import { loadPattern, loadPatternIndex, loadStock } from '../lib/data.js';
import { createStockChart, COLORS } from '../lib/chart.js';
import { el, clear, signed, formatEvidence } from '../lib/ui.js';
import * as storage from '../lib/storage.js';
import { STUDY_PATTERNS, PROMPTS, comparisonPairs, studyKey, studyWindow, submitStudy, keepStudy, validDraft } from '../lib/real-study.js';

let charts = [], generation = 0;
function clearCharts() { for (const c of charts.splice(0)) c.destroy(); }
export function destroyRealStudy() { generation++; clearCharts(); }

export async function renderRealStudy(app) {
  destroyRealStudy();
  let patternId = STUDY_PATTERNS[0].id, cursor = 0;
  const loaded = storage.load('real-study:v1', {});
  let records = loaded && typeof loaded === 'object' && !Array.isArray(loaded) ? loaded : {};
  const area = el('section.real-study'), status = el('p.small', { 'aria-live': 'polite' });
  const saveNote = el('p.small.muted', { text: '제출한 근거와 복기는 이 브라우저에 최근 30쌍까지 저장합니다. 제출 전 초안은 이동하면 사라집니다. 서술의 질은 자동 채점하지 않습니다.' });
  const select = el('select', { id: 'real-pattern' }, STUDY_PATTERNS.map((p) => el('option', { value: p.id, text: p.name })));
  const next = el('button.btn', { text: '다른 두 사례', disabled: true });
  clear(app).append(el('h1.page-title', { text: '실제 차트 비교 연습' }),
    el('p.page-sub', { text: '같은 신호, 다른 결과. 확인일까지의 차트로 먼저 근거를 적고, 두 사례를 모두 기록한 뒤 이후 결과를 비교합니다. 방향 맞히기 시험이 아닙니다.' }),
    el('a.btn', { href: '#/practice', text: '기초 개념 문제로 돌아가기' }),
    el('p.rulebox', { text: '비교 교재의 선택 편향: 저장 예시 중 20봉 뒤 종가가 신호 방향과 같았던 사례와 반대였던 사례를 하나씩 고릅니다. 보합·미완료는 제외합니다. 이 구성으로 승률을 계산하거나 시장의 실제 비율을 추정하면 안 됩니다. 종목·시점이 달라 결과 차이의 원인을 증명하는 비교도 아닙니다. A/B 순서는 성공·실패를 뜻하지 않습니다.' }),
    el('div.row', null, [el('label', { for: 'real-pattern', text: '연습할 신호' }), select, next]), status, area, saveNote);

  function save(key, record) {
    records = keepStudy(records, key, record);
    if (!storage.save('real-study:v1', records)) saveNote.textContent = '브라우저 저장이 불가능합니다. 이번 화면에서만 기록이 유지되며 새로고침하면 사라질 수 있습니다.';
  }
  async function load() {
    const token = ++generation;
    clearCharts(); next.disabled = true; select.disabled = true;
    clear(area).append(el('p.loading', { text: '검사된 실제 사례를 불러오는 중…' }));
    try {
      const [meta, index] = await Promise.all([loadPattern(patternId), loadPatternIndex()]);
      if (token !== generation || !app.isConnected) return;
      const pairs = comparisonPairs(meta, index.eligibleTickers);
      if (!pairs.length) { clear(area).append(el('p', { text: '비교할 완전 관측 사례가 부족합니다. 다른 신호를 선택하세요.' })); status.textContent = ''; return; }
      cursor %= pairs.length;
      const pair = pairs[cursor], key = studyKey(meta, pair);
      const stocks = await Promise.all(pair.map((h) => loadStock(h.ticker)));
      if (token !== generation || !app.isConnected) return;
      stocks.forEach((s, i) => studyWindow(s, pair[i])); // 렌더 전 전체 품질/날짜 검사
      let record = records[key];
      if (!record?.submittedAt || record.drafts?.length !== 2 || !record.drafts.every(validDraft)) record = null;
      let revealed = !!record;
      status.textContent = `${cursor + 1}/${pairs.length}쌍 · ${record ? '이전에 기록한 사례 복습 (최초 근거 유지)' : '새 기록'} · 일봉 · ${meta.name}`;
      next.disabled = pairs.length < 2;
      const cards = pair.map((h, i) => {
        const box = el('div.chart-box', { 'aria-label': `사례 ${i ? 'B' : 'A'} 차트` });
        const inputs = Object.fromEntries(PROMPTS.map(([field, label, hint]) => [field,
          el('textarea', { id: `real-${i}-${field}`, rows: 2, maxlength: 1000, placeholder: hint })]));
        const info = el('div');
        const c = el('section.panel.real-study-card', null, [
          el('h2', { text: `사례 ${i ? 'B' : 'A'} · ${h.name} (${h.ticker})` }),
          el('p.small', { text: `신호일 ${h.date} · 판정 확인일 ${h.confirmDate || h.date}. 공개 전에는 확인일 이후의 봉을 차트와 지표 계산에서 제외합니다.` }),
          STUDY_PATTERNS.find((p) => p.id === patternId).averages
            ? el('p.small', { text: '20일선: 초록 · 60일선: 보라 · 거래량 표시. 확인일은 교차 후 5개 거래 봉 유지가 확인된 날입니다.' })
            : el('p.small', { text: '캔들과 거래량을 표시합니다. 앞선 추세와 장악하는 두 봉을 함께 살펴보세요.' }),
          box, ...PROMPTS.flatMap(([field, label]) => [el('label.practice-label', { for: inputs[field].id, text: label }), inputs[field]]), info]);
        for (const [field, input] of Object.entries(inputs)) { input.value = record?.drafts[i][field] || ''; input.readOnly = revealed; }
        return { box, inputs, info, c };
      });
      const feedback = el('div', { 'aria-live': 'polite' });
      const reveal = el('button.btn.primary', { text: '두 근거를 기록하고 결과 공개', disabled: revealed });
      const reflectionArea = el('section');
      clear(area).append(el('details.rulebox', null, [el('summary', { text: '적용된 판정 기준 확인' }),
        el('ul', null, meta.rules.map((text) => el('li', { text })))]), ...cards.map((c) => c.c), reveal, feedback, reflectionArea);

      function draw() {
        clearCharts();
        cards.forEach((card, i) => {
          const h = pair[i], window = studyWindow(stocks[i], h, revealed);
          const chart = createStockChart(card.box, { height: 300 }); charts.push(chart);
          const averages = !!STUDY_PATTERNS.find((p) => p.id === patternId).averages;
          chart.setOverlays({ ma20: averages, ma60: averages, volume: true });
          chart.setCandles(window.view, window.history);
          chart.setMarkers([{ date: window.cutoff, position: 'belowBar', color: COLORS.warn, shape: 'circle', text: '확인일' }]); chart.fit();
          if (!revealed) return;
          const o = h.outcome, agrees = (meta.bias === 'up' ? 1 : -1) * o.changePct > 0;
          const evidence = el('dl.kv');
          for (const e of h.evidence || []) evidence.append(el('dt', { text: e.label }), el('dd', { text: formatEvidence(e, h.currency) }));
          clear(card.info).append(el('h3', { text: '판정 근거와 이후 사실 확인' }), evidence,
            el('p', { text: `${o.fromDate} → ${o.toDate} · 20개 거래 봉 뒤 종가 변화 ${signed(o.changePct)} · 신호 방향과 ${agrees ? '같은' : '반대'} 결과` }),
            el('p.small.muted', { text: '종가 변화 방향만 비교한 것입니다. 매매 수익·손절 성공 여부나 분석의 정답을 뜻하지 않습니다. 달력상 기간은 다를 수 있습니다.' }));
        });
      }
      function showReflection() {
        const reflection = el('textarea', { id: 'real-reflection', rows: 4, maxlength: 2000,
          placeholder: '당시 근거에서 유지할 부분과 수정할 부분을 각각 적으세요. 나중에 안 사실을 당시부터 알았던 것처럼 쓰지 마세요.' });
        reflection.value = typeof record.reflection === 'string' ? record.reflection : '';
        const saved = el('p.small', { 'aria-live': 'polite' });
        clear(reflectionArea).append(el('h2', { text: '결과와 근거를 따로 복기하기' }),
          el('ul', null, ['내가 쓴 관찰 사실이 판정 근거와 맞는가?', '반대 결과가 나온 사례에서도 당시 관찰 자체는 맞았는가?', '결과가 좋았다는 이유만으로 잘못된 설명을 정답으로 바꾸지 않았는가?', '내 무효 조건은 사전에 관찰할 수 있는 구체적 기준인가?'].map((text) => el('li', { text }))),
          el('label.practice-label', { for: 'real-reflection', text: '두 사례에서 배운 점과 수정할 설명' }), reflection,
          el('button.btn', { text: '복기 저장', onclick: () => {
            if (reflection.value.trim().length < 8) { saved.textContent = '복기를 8자 이상 적어주세요. 글의 질을 자동 평가하는 기준은 아닙니다.'; return; }
            record = { ...record, reflection: reflection.value.trim().slice(0, 2000) }; save(key, record);
            saved.textContent = '이번 화면에 복기를 기록했습니다. 최초 근거는 그대로 유지합니다. 브라우저 저장 여부는 아래 안내를 확인하세요.';
          } }), saved, el('a.btn', { href: `#/learn/${meta.lesson}`, text: '관련 개념 다시 읽기' }));
      }
      reveal.addEventListener('click', () => {
        if (revealed || token !== generation) return;
        try { record = submitStudy(record, cards.map((c) => Object.fromEntries(Object.entries(c.inputs).map(([k, input]) => [k, input.value])))); }
        catch (e) { feedback.textContent = e.message; return; }
        save(key, record); revealed = true; reveal.disabled = true; feedback.textContent = '최초 근거를 고정했습니다. 이제 결과와 별개로 근거를 점검하세요.';
        for (const c of cards) for (const input of Object.values(c.inputs)) input.readOnly = true;
        draw(); showReflection();
      });
      draw(); if (revealed) showReflection();
    } catch (e) {
      if (token === generation && app.isConnected) { clearCharts(); clear(area).append(el('p.warn', { text: `사례를 표시하지 못했습니다: ${e.message}` })); }
    } finally { if (token === generation) select.disabled = false; }
  }
  select.addEventListener('change', () => { patternId = select.value; cursor = 0; load(); });
  next.addEventListener('click', () => { cursor++; load(); });
  await load();
}
