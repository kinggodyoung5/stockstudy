/**
 * 구간 맞히기 퀴즈 탭 (설명서 5.5)
 * 실제 과거 데이터에서 임의 구간을 뽑아 앞부분만 보여주고, 다음 20거래일 방향을 맞힌다.
 * 정답 라벨을 따로 만들 필요가 없다 — 가려둔 미래 구간 자체가 정답이다.
 */

import { loadEligibleStockList, loadStock } from '../lib/data.js';
import { inspectStock } from '../lib/data-quality.js';
import { createStockChart, COLORS } from '../lib/chart.js';
import { pct } from '../lib/indicators.js';
import { evaluateSignals } from '../lib/quiz-signals.js';
import { el, clear, signed, dirClass } from '../lib/ui.js';
import { createOscillatorPanel, syncTimeScales } from '../lib/chart.js';
import { OSCILLATORS } from '../lib/oscillators.js';
import * as storage from '../lib/storage.js';

const SETUP_BARS = 120;   // 보여줄 앞구간
const FUTURE_BARS = 20;   // 가려둘 미래 구간
const FLAT_BAND = 3;      // ±3% 안이면 횡보로 본다

let chart = null;
let panels = [];
let unsync = null;
let quizVersion = 0;

export function destroyQuiz() {
  quizVersion++;
  if (unsync) { try { unsync(); } catch (_) {} unsync = null; }
  panels.forEach((p) => { try { p.destroy(); } catch (_) {} });
  panels = [];
  if (chart) { try { chart.destroy(); } catch (_) {} chart = null; }
}

const ANSWERS = [
  { id: 'up', label: '상승', desc: `20거래일 뒤 종가가 +${FLAT_BAND}% 초과` },
  { id: 'flat', label: '횡보', desc: `-${FLAT_BAND}% ~ +${FLAT_BAND}% 사이` },
  { id: 'down', label: '하락', desc: `-${FLAT_BAND}% 미만` },
];

const verdictOf = (changePct) =>
  changePct > FLAT_BAND ? 'up' : changePct < -FLAT_BAND ? 'down' : 'flat';

export async function renderQuiz(app) {
  destroyQuiz();
  const version = quizVersion;
  clear(app).append(el('p.loading', { text: '문제를 준비하는 중…' }));

  const index = await loadEligibleStockList();
  if (!index.length) throw new Error('출제 가능한 정합성 통과 종목이 없습니다.');
  if (version !== quizVersion || !app.isConnected) return;
  // 기록은 브라우저에 남긴다 (새로고침·재방문해도 유지)
  const saved = storage.load('quiz', null);
  const session = saved && typeof saved.total === 'number'
    ? { total: saved.total, correct: saved.correct, notes: saved.notes || [] }
    : { total: 0, correct: 0, notes: [] };
  const canSave = storage.available();
  const persist = () => storage.save('quiz', session);

  const box = el('div.chart-box.tall');
  const panelWrap = el('div.panels');
  const answerArea = el('div');
  const resultArea = el('div');
  const scoreArea = el('div.score');
  const notesArea = el('div.notes');
  const questionMeta = el('div.row', { style: { marginBottom: '6px' } });

  let current = null;

  function updateScore() {
    clear(scoreArea).append(
      el('div', null, [el('b', { text: String(session.total) }), el('span.muted.small', { text: '푼 문제' })]),
      el('div', null, [el('b', { class: 'up', text: String(session.correct) }), el('span.muted.small', { text: '정답' })]),
      el('div', null, [
        el('b', { text: session.total ? Math.round((session.correct / session.total) * 100) + '%' : '—' }),
        el('span.muted.small', { text: '정답률' }),
      ])
    );
  }

  function updateNotes() {
    clear(notesArea);
    if (!session.notes.length) {
      notesArea.append(el('p.muted.small', { text: '아직 오답이 없습니다. 틀린 문제는 여기에 모입니다.' }));
      return;
    }
    for (const n of [...session.notes].reverse()) {
      notesArea.append(
        el('div.note', null, [
          el('b', { text: `${n.name} · ${n.cutDate}` }),
          el('div.small.muted', { text: `내 답 ${n.pickedLabel} → 실제 ${n.actualLabel} (${signed(n.changePct)})` }),
          el('div.small', { text: n.signals.length ? '있던 신호: ' + n.signals.join(', ') : '뚜렷한 신호 없음' }),
        ])
      );
    }
  }

  /**
   * 체크리스트에서 RSI·MACD를 근거로 물어보므로 그 차트도 함께 보여준다.
   * createOscillatorPanel 은 생성 시점의 캔들로 그리기 때문에, 데이터가 바뀌면 다시 만든다.
   */
  function mountPanels(candles) {
    if (unsync) { try { unsync(); } catch (_) {} unsync = null; }
    panels.forEach((p) => { try { p.destroy(); } catch (_) {} });
    panels = [];
    clear(panelWrap);
    const charts = [chart.chart];
    for (const id of ['rsi', 'macd']) {
      const def = OSCILLATORS[id];
      const pbox = el('div.osc-box', { style: { height: def.height + 'px' } });
      panelWrap.append(el('div.osc-wrap', null, [el('div.panel-head', null, [el('span', { text: def.name })]), pbox]));
      const panel = createOscillatorPanel(pbox, def, candles, undefined, current.stock.candles);
      panels.push(panel);
      panel.fit();
      charts.push(panel.chart);
    }
    unsync = syncTimeScales(charts);
  }

  let questionVersion = 0;
  async function newQuestion() {
    const question = ++questionVersion;
    clear(resultArea);
    const row = index[Math.floor(Math.random() * index.length)];
    const stock = await loadStock(row.ticker);
    if (version !== quizVersion || question !== questionVersion || !app.isConnected) return;
    if (!inspectStock(stock).eligible) {
      clear(resultArea).append(el('p.error', { text: '원자료가 바뀌어 정합성 검사를 통과하지 못했습니다. 탐지 결과를 다시 생성하세요.' }));
      return;
    }
    const all = stock.candles;
    const need = SETUP_BARS + FUTURE_BARS;
    const start = Math.floor(Math.random() * (all.length - need));
    const setup = all.slice(start, start + SETUP_BARS);
    const future = all.slice(start + SETUP_BARS, start + need);

    const fromClose = setup[setup.length - 1].close;
    const changePct = +pct(fromClose, future[future.length - 1].close).toFixed(2);

    current = {
      stock, setup, future, changePct,
      actual: verdictOf(changePct),
      cutDate: setup[setup.length - 1].date,
      signals: evaluateSignals(stock, start + SETUP_BARS - 1),
      checked: new Set(),
      answered: false,
    };

    clear(questionMeta).append(
      el('span.pill', { text: '종목·기간 비공개' }),
      el('span.muted.small', { text: `앞 ${SETUP_BARS}봉을 보고 다음 ${FUTURE_BARS}거래일의 방향을 맞혀보세요.` })
    );

    if (!chart) chart = createStockChart(box, { width: box.clientWidth, height: box.clientHeight });
    chart.dropLine('cut');
    chart.setOverlays({ ma5: true, ma20: true, ma60: true, volume: true });
    chart.setCandles(setup, stock.candles);
    chart.setMarkers([]);
    chart.fit();
    mountPanels(setup);

    renderAnswers();
  }

  function renderAnswers() {
    clear(answerArea).append(
      el('h3', { style: { margin: '0 0 8px', fontSize: '15px' }, text: '다음 20거래일, 어느 쪽일까요?' }),
      (() => {
        const grid = el('div.choice-grid');
        for (const a of ANSWERS) {
          grid.append(
            el('button.choice', { onclick: () => answer(a.id) }, [
              el('span', { text: a.label }),
              el('small', { text: a.desc }),
            ])
          );
        }
        return grid;
      })()
    );
  }

  function answer(pickedId) {
    if (current.answered) return;
    current.answered = true;
    const correct = pickedId === current.actual;
    session.total++;
    if (correct) session.correct++;

    // 가려뒀던 미래 구간을 이어 붙인다
    const full = current.setup.concat(current.future);
    chart.setCandles(full, current.stock.candles);
    mountPanels(full);
    chart.setMarkers([
      { date: current.cutDate, position: 'belowBar', color: COLORS.neckline, shape: 'arrowUp', text: '여기까지 보였음' },
    ]);
    chart.fit();

    const pickedLabel = ANSWERS.find((a) => a.id === pickedId).label;
    const actualLabel = ANSWERS.find((a) => a.id === current.actual).label;
    const presentSignals = current.signals.filter((s) => s.present);

    if (!correct) {
      session.notes.push({
        name: `${current.stock.name}`,
        cutDate: current.cutDate,
        pickedLabel, actualLabel,
        changePct: current.changePct,
        signals: presentSignals.map((s) => s.label),
      });
    }
    persist();
    updateScore();
    updateNotes();

    // 선택지 상태 갱신
    [...answerArea.querySelectorAll('.choice')].forEach((btn, i) => {
      btn.disabled = true;
      if (ANSWERS[i].id === current.actual) btn.classList.add('correct');
      else if (ANSWERS[i].id === pickedId) btn.classList.add('wrong');
    });

    clear(resultArea).append(
      el('div.panel', { style: { marginTop: '16px' } }, [
        el('div.row', null, [
          el('span.pill', { class: correct ? 'up' : 'down', text: correct ? '정답' : '오답' }),
          el('strong', { text: `${current.stock.name} (${current.stock.ticker})` }),
          el('span.muted.small', { text: `${current.cutDate} 이후 ${FUTURE_BARS}거래일` }),
          el('span.spacer'),
          el('strong', { class: dirClass(current.changePct), text: signed(current.changePct) }),
        ]),
        el('p.small.muted', { style: { margin: '10px 0 4px' }, text: '레슨과 같은 조건을 마지막 관찰일까지의 자료로 검사합니다. RSI 같은 지표의 상태와 이후 주가의 방향은 별개입니다. 결과를 본 뒤 체크하는 복습이며 사전 판단 점수가 아닙니다.' }),
        signalChecklist(presentSignals),
      ])
    );
  }

  function signalChecklist(presentSignals) {
    const wrap = el('div.check-list');
    let lastGroup = null;
    for (const s of current.signals) {
      if (s.group !== lastGroup) {
        wrap.append(el('div.check-group', { text: s.group }));
        lastGroup = s.group;
      }
      const input = el('input', { type: 'checkbox' });
      const verdict = el('span.verdict');
      const label = el('label', null, [input, el('span', null, [s.label, verdict])]);

      const evaluate = () => {
        if (!input.checked) {
          verdict.textContent = '';
          label.className = '';
          return;
        }
        if (!s.present) {
          verdict.textContent = '최근 10거래일 안에 확인 완료된 조건은 없습니다. 아직 형성 중인 후보는 세지 않습니다.';
          verdict.className = 'verdict muted';
          label.className = 'miss';
          return;
        }
        verdict.textContent = '조건 확인일: ' + s.dates.join(', ') + '. 이후 방향이나 매매 시점을 보장하지 않습니다.';
        verdict.className = 'verdict muted';
        label.className = 'hit';
      };

      input.addEventListener('change', evaluate);
      wrap.append(label, el('details.small', null, [el('summary', { text: '이 앱의 정확한 판정 기준' }), el('ul', null, s.rules.map((rule) => el('li', { text: rule })))]));
    }
    wrap.append(
      el('p.small.muted', { style: { margin: '8px 0 0' }, text: `마지막 관찰일까지 최근 10거래일 안에 확인된 조건은 ${current.signals.length}개 중 ${presentSignals.length}개입니다. 조건이 있었다는 사실과 이후 방향의 적중은 나눠서 확인하세요.` })
    );
    return wrap;
  }

  clear(app).append(
    el('h1.page-title', { text: '방향 예측 실험 (보조 활동)' }),
    el('p.page-sub', { text: '실제 과거 구간의 이후 방향을 예상해보는 실험입니다. 방향 적중률은 차트 읽기 숙달 점수가 아닙니다. 상승·횡보·하락의 출현 비율도 같지 않습니다. 기초 공부는 “기초 읽기 연습”에서 시작하세요.' }),
    el('p.small.warn', { text: `정합성을 통과한 ${index.length}개 종목에서만 출제합니다. 체크리스트는 레슨과 같은 탐지 엔진으로 마지막 10거래일의 확인 완료 조건만 셉니다. 결과를 본 뒤 고른 근거는 사전 판단 기록이 아닙니다.` }),
    el('div.quiz-grid', null, [
      el('div.panel', null, [questionMeta, box, panelWrap, resultArea]),
      el('div', null, [
        el('div.panel', null, [
          answerArea,
          el('div', { style: { marginTop: '14px' } }, [
            el('button.btn.primary', { text: '다음 문제', onclick: () => newQuestion() }),
          ]),
        ]),
        el('div.panel', { style: { marginTop: '16px' } }, [
          el('h3', { style: { margin: '0 0 10px', fontSize: '15px' }, text: '이번 세션 기록' }),
          scoreArea,
        ]),
        el('div.panel', { style: { marginTop: '16px' } }, [
          el('div.row', { style: { marginBottom: '8px' } }, [
            el('h3', { style: { margin: 0, fontSize: '15px' }, text: '오답노트' }),
            el('span.spacer'),
            el('button.btn.small', {
              text: '기록 지우기',
              onclick: () => {
                if (!confirm('지금까지의 점수와 오답노트를 모두 지웁니다. 계속할까요?')) return;
                session.total = 0;
                session.correct = 0;
                session.notes.length = 0;
                storage.remove('quiz');
                updateScore();
                updateNotes();
              },
            }),
          ]),
          el('p.small.muted', { style: { margin: '0 0 10px' }, text: canSave
            ? '이 브라우저에 저장되어 새로고침하거나 나중에 다시 와도 남아 있습니다.'
            : '이 브라우저에서는 저장이 차단돼 있어 새로고침하면 사라집니다.' }),
          notesArea,
        ]),
      ]),
    ])
  );

  updateScore();
  updateNotes();
  newQuestion();
}
