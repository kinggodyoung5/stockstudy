/**
 * 구간 맞히기 퀴즈 탭 (설명서 5.5)
 * 실제 과거 데이터에서 임의 구간을 뽑아 앞부분만 보여주고, 다음 20거래일 방향을 맞힌다.
 * 정답 라벨을 따로 만들 필요가 없다 — 가려둔 미래 구간 자체가 정답이다.
 */

import { loadStockList, loadStock } from '../lib/data.js';
import { createStockChart, COLORS } from '../lib/chart.js';
import { sma, bollinger, ichimoku, cloudBounds, closes, volumes, crossAt, pct, disparity } from '../lib/indicators.js';
import { rsi, macd, stochastic, adx } from '../lib/oscillators.js';
import { el, clear, overlayBar, signed, dirClass } from '../lib/ui.js';

const SETUP_BARS = 120;   // 보여줄 앞구간
const FUTURE_BARS = 20;   // 가려둘 미래 구간
const FLAT_BAND = 3;      // ±3% 안이면 횡보로 본다

let chart = null;

export function destroyQuiz() {
  if (chart) { try { chart.destroy(); } catch (_) {} chart = null; }
}

const ANSWERS = [
  { id: 'up', label: '상승', desc: `20거래일 뒤 종가가 +${FLAT_BAND}% 초과` },
  { id: 'flat', label: '횡보', desc: `-${FLAT_BAND}% ~ +${FLAT_BAND}% 사이` },
  { id: 'down', label: '하락', desc: `-${FLAT_BAND}% 미만` },
];

const verdictOf = (changePct) =>
  changePct > FLAT_BAND ? 'up' : changePct < -FLAT_BAND ? 'down' : 'flat';

/**
 * 앞구간(setup)만 보고 계산할 수 있는 신호들.
 * 각 신호는 "있었는가(present)"와 "어느 방향을 가리키는가(bias)"를 가진다.
 */
function evaluateSignals(setup) {
  const c = closes(setup);
  const v = volumes(setup);
  const last = setup.length - 1;
  const m5 = sma(c, 5), m20 = sma(c, 20), m60 = sma(c, 60);
  const bb = bollinger(c, 20, 2);
  const cloud = cloudBounds(ichimoku(setup));
  const r = rsi(c, 14);
  const m = macd(c);
  const st = stochastic(setup);
  const ax = adx(setup, 14);
  const dis = disparity(c, 20);

  const recentCross = (a, b, dir, within) => {
    for (let i = Math.max(1, last - within); i <= last; i++) if (crossAt(a, b, i) === dir) return true;
    return false;
  };
  const recentBand = (side, within) => {
    for (let i = Math.max(0, last - within); i <= last; i++) {
      if (side === 'upper' && bb.upper[i] != null && c[i] > bb.upper[i]) return true;
      if (side === 'lower' && bb.lower[i] != null && c[i] < bb.lower[i]) return true;
    }
    return false;
  };
  const recentVolumeSpike = (within) => {
    for (let i = Math.max(21, last - within); i <= last; i++) {
      let avg = 0;
      for (let k = i - 20; k < i; k++) avg += v[k];
      avg /= 20;
      if (avg > 0 && v[i] / avg >= 3) return true;
    }
    return false;
  };
  const near = (arr) => arr[last];

  return [
    // 추세
    { id: 'golden', group: '추세', label: '최근 10일 안에 골든크로스 (20일선이 60일선 상향 돌파)', bias: 'up', present: recentCross(m20, m60, 1, 10) },
    { id: 'dead', group: '추세', label: '최근 10일 안에 데드크로스 (20일선이 60일선 하향 돌파)', bias: 'down', present: recentCross(m20, m60, -1, 10) },
    { id: 'align', group: '추세', label: '이동평균선 정배열 (5일 > 20일 > 60일)', bias: 'up', present: m5[last] > m20[last] && m20[last] > m60[last] },
    { id: 'revalign', group: '추세', label: '이동평균선 역배열 (5일 < 20일 < 60일)', bias: 'down', present: m5[last] < m20[last] && m20[last] < m60[last] },
    { id: 'above20', group: '추세', label: '종가가 20일선 위', bias: 'up', present: m20[last] != null && c[last] > m20[last] },
    { id: 'adxtrend', group: '추세', label: 'ADX 25 이상 (뚜렷한 추세 국면)', bias: 'none', present: near(ax.adx) != null && near(ax.adx) >= 25 },
    { id: 'diplus', group: '추세', label: '+DI 가 −DI 보다 위 (상승 방향 우위)', bias: 'up', present: near(ax.plusDI) != null && near(ax.plusDI) > near(ax.minusDI) },

    // 모멘텀
    { id: 'rsihigh', group: '모멘텀', label: 'RSI 70 이상 (과매수 구간)', bias: 'down', present: near(r) != null && near(r) >= 70 },
    { id: 'rsilow', group: '모멘텀', label: 'RSI 30 이하 (과매도 구간)', bias: 'up', present: near(r) != null && near(r) <= 30 },
    { id: 'macdup', group: '모멘텀', label: '최근 10일 안에 MACD 골든크로스', bias: 'up', present: recentCross(m.line, m.signal, 1, 10) },
    { id: 'macddown', group: '모멘텀', label: '최근 10일 안에 MACD 데드크로스', bias: 'down', present: recentCross(m.line, m.signal, -1, 10) },
    { id: 'macdpos', group: '모멘텀', label: 'MACD 히스토그램이 0 위 (단기 우위)', bias: 'up', present: near(m.hist) != null && near(m.hist) > 0 },
    { id: 'stochlow', group: '모멘텀', label: '스토캐스틱 %K 20 이하 (침체 구간)', bias: 'up', present: near(st.k) != null && near(st.k) <= 20 },
    { id: 'stochhigh', group: '모멘텀', label: '스토캐스틱 %K 80 이상 (과열 구간)', bias: 'down', present: near(st.k) != null && near(st.k) >= 80 },
    { id: 'dishigh', group: '모멘텀', label: '이격도 110 이상 (20일선에서 크게 위로 벌어짐)', bias: 'down', present: near(dis) != null && near(dis) >= 110 },
    { id: 'dislow', group: '모멘텀', label: '이격도 92 이하 (20일선에서 크게 아래로 벌어짐)', bias: 'up', present: near(dis) != null && near(dis) <= 92 },

    // 변동성 · 위치
    { id: 'bbup', group: '변동성', label: '최근 5일 안에 볼린저밴드 상단 이탈', bias: 'up', present: recentBand('upper', 5) },
    { id: 'bbdown', group: '변동성', label: '최근 5일 안에 볼린저밴드 하단 이탈', bias: 'down', present: recentBand('lower', 5) },
    { id: 'squeeze', group: '변동성', label: '밴드폭이 최근 60일 중 하위권 (스퀴즈 상태)', bias: 'none', present: (() => {
      const w = bb.width.slice(Math.max(0, last - 60), last + 1).filter((x) => x != null);
      if (w.length < 30 || bb.width[last] == null) return false;
      const sorted = [...w].sort((x, y) => x - y);
      return bb.width[last] <= sorted[Math.floor(sorted.length * 0.2)];
    })() },
    { id: 'cloudup', group: '변동성', label: '주가가 일목 구름대 위', bias: 'up', present: cloud.top[last] != null && c[last] > cloud.top[last] },
    { id: 'clouddown', group: '변동성', label: '주가가 일목 구름대 아래', bias: 'down', present: cloud.bottom[last] != null && c[last] < cloud.bottom[last] },

    // 거래량
    { id: 'volspike', group: '거래량', label: '최근 5일 안에 거래량 급증 (평균 3배 이상)', bias: 'none', present: recentVolumeSpike(5) },
    { id: 'voldry', group: '거래량', label: '최근 5일 평균 거래량이 20일 평균의 70% 이하 (거래 위축)', bias: 'none', present: (() => {
      if (last < 25) return false;
      const a5 = v.slice(last - 4, last + 1).reduce((x, y) => x + y, 0) / 5;
      const a20 = v.slice(last - 19, last + 1).reduce((x, y) => x + y, 0) / 20;
      return a20 > 0 && a5 / a20 <= 0.7;
    })() },
  ];
}
export async function renderQuiz(app) {
  destroyQuiz();
  clear(app).append(el('p.loading', { text: '문제를 준비하는 중…' }));

  const index = await loadStockList();
  const session = { total: 0, correct: 0, notes: [] };

  const box = el('div.chart-box.tall');
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

  async function newQuestion() {
    clear(resultArea);
    const row = index[Math.floor(Math.random() * index.length)];
    const stock = await loadStock(row.ticker);
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
      signals: evaluateSignals(setup),
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
    chart.setCandles(setup);
    chart.setMarkers([]);
    chart.fit();

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
    chart.setCandles(full);
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
        el('p.small.muted', { style: { margin: '10px 0 4px' }, text: '이 구간에서 실제로 어떤 신호가 있었는지 확인해보세요. 내가 근거로 삼은 항목을 체크하면 그 신호가 이번에 유효했는지 알려줍니다.' }),
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
          verdict.textContent = '이 구간에는 없던 신호입니다.';
          verdict.className = 'verdict muted';
          label.className = 'miss';
          return;
        }
        if (s.bias === 'none') {
          verdict.textContent = `있었음 — 방향을 알려주는 신호는 아닙니다. 실제 결과는 ${signed(current.changePct)}.`;
          verdict.className = 'verdict muted';
          label.className = 'hit';
          return;
        }
        const matched = (s.bias === 'up' && current.changePct > 0) || (s.bias === 'down' && current.changePct < 0);
        verdict.textContent = matched
          ? `있었음 — 이번에는 방향이 맞았습니다 (${signed(current.changePct)}).`
          : `있었음 — 이번에는 방향이 빗나갔습니다 (${signed(current.changePct)}).`;
        verdict.className = 'verdict ' + (matched ? 'up' : 'down');
        label.className = 'hit';
      };

      input.addEventListener('change', evaluate);
      wrap.append(label);
    }
    wrap.append(
      el('p.small.muted', { style: { margin: '8px 0 0' }, text: `이번 구간에 실제로 있던 신호는 ${current.signals.length}개 중 ${presentSignals.length}개입니다. 신호가 여러 개 있어도 방향이 빗나가는 경우가 흔하다는 점을 함께 확인하세요.` })
    );
    return wrap;
  }

  clear(app).append(
    el('h1.page-title', { text: '구간 맞히기 퀴즈' }),
    el('p.page-sub', { text: '실제 과거 데이터에서 무작위로 뽑은 구간입니다. 종목과 시기는 답을 공개할 때까지 가려집니다.' }),
    el('div.quiz-grid', null, [
      el('div.panel', null, [questionMeta, box, resultArea]),
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
          el('h3', { style: { margin: '0 0 10px', fontSize: '15px' }, text: '오답노트' }),
          el('p.small.muted', { style: { margin: '0 0 10px' }, text: '새로고침하면 사라집니다 (영구 저장은 다음 단계).' }),
          notesArea,
        ]),
      ]),
    ])
  );

  updateScore();
  updateNotes();
  newQuestion();
}
