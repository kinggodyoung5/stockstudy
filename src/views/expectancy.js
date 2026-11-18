/**
 * 기대값 실험 (가상 차트 화면 안의 칸).
 * 승률·손익비·한 번의 위험을 정해 같은 조건으로 200번 돌려 본 계좌 곡선을 그린다.
 * 가정한 숫자로 돌린 계산이며 실제 매매 결과가 아니다.
 */
import { simulateExpectancy } from '../lib/plan.js';
import { el, clear } from '../lib/ui.js';

const n = (v, d = 1) => Number(v).toLocaleString('ko-KR', { maximumFractionDigits: d });

/** 계좌 곡선 묶음을 SVG 로 그린다. 시작 금액은 100. */
function curvesSvg(curves) {
  const W = 640, H = 220, pad = 34;
  const all = curves.flat(), max = Math.max(150, ...all), min = Math.min(50, ...all);
  const x = (k, len) => pad + (W - pad * 2) * k / (len - 1);
  const y = (v) => H - pad - (H - pad * 2) * (v - min) / (max - min);
  const lines = curves.map((c) => `<polyline fill="none" stroke="#5b8def" stroke-opacity="0.45" stroke-width="1.2" points="${c.map((v, k) => `${x(k, c.length).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}"/>`).join('');
  const base = `<line x1="${pad}" x2="${W - pad}" y1="${y(100)}" y2="${y(100)}" stroke="#f2b134" stroke-dasharray="5 5"/>`;
  const label = (v) => `<text x="${pad - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#8b95a9">${Math.round(v)}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="같은 조건으로 돌린 계좌 곡선 20개" xmlns="http://www.w3.org/2000/svg">${base}${lines}${label(max)}${label(100)}${label(min)}
<text x="${W - pad}" y="${H - 8}" text-anchor="end" font-size="11" fill="#8b95a9">매매 횟수 →</text></svg>`;
}

export function expectancyPanel() {
  const state = { winRate: 40, reward: 2, riskPercent: 1, trades: 100, seed: 1 };
  const result = el('div.exp-result', { 'aria-live': 'polite' });
  const field = (key, label, min, max, step) => {
    const input = el('input', { type: 'number', id: 'exp-' + key, min, max, step, value: state[key] });
    input.addEventListener('change', () => {
      const v = Number(input.value);
      if (Number.isFinite(v) && v >= min && v <= max) state[key] = v; else input.value = state[key];
      run();
    });
    return el('label.exp-field', { for: 'exp-' + key }, [el('span.small', { text: label }), input]);
  };
  function run() {
    const r = simulateExpectancy({ winRate: state.winRate / 100, reward: state.reward, riskPercent: state.riskPercent, trades: state.trades, runs: 200, seed: state.seed });
    const graph = el('div.exp-graph');
    graph.innerHTML = curvesSvg(r.curves);   // 숫자로만 만든 그림이다. 사용자 글은 들어가지 않는다.
    clear(result).append(
      el('dl.assess-kv', null, [
        el('dt', { text: '한 번의 기대값' }), el('dd', { text: `${r.expectancyR >= 0 ? '+' : ''}${n(r.expectancyR, 2)}R` }),
        el('dt', { text: '끝 금액 (시작 100)' }), el('dd', { text: `가운데 ${n(r.median)} · 아래 10% ${n(r.p10)} · 위 10% ${n(r.p90)}` }),
        el('dt', { text: '가장 긴 연속 손실' }), el('dd', { text: `가운데 ${r.streak.median}번 · 가장 길게 ${r.streak.max}번` }),
        el('dt', { text: '절반 아래로 줄어든 경우' }), el('dd', { text: `200번 중 ${r.ruined}번` }),
      ]),
      graph,
      el('p.small.muted', { text: '파란 선 20개는 같은 조건으로 돌린 계좌 곡선입니다. 노란 점선이 시작 금액 100입니다. 기대값이 같아도 곡선마다 결과가 크게 다릅니다.' }),
    );
  }
  const again = el('button.btn', { text: '다시 돌리기', onclick: () => { state.seed = Math.floor(Math.random() * 1e9); run(); } });
  const panel = el('div.panel', { style: { marginTop: '18px' } }, [
    el('h3', { style: { margin: '0 0 6px', fontSize: '17px' }, text: '기대값 실험: 승률과 손익비' }),
    el('p.small.muted', { text: '맞히면 위험의 몇 배를 얻고 틀리면 위험만큼 잃는다고 가정하고, 같은 조건으로 200번 돌려 봅니다. 가정한 숫자로 돌린 계산이며 실제 매매 결과가 아닙니다. 수수료, 세금, 갭으로 더 잃는 경우는 넣지 않았습니다.' }),
    el('div.row.exp-fields', null, [
      field('winRate', '승률 (%)', 5, 95, 1), field('reward', '맞힐 때 얻는 양 (R)', 0.2, 10, 0.1),
      field('riskPercent', '한 번의 위험 (계좌의 %)', 0.1, 20, 0.1), field('trades', '매매 횟수', 10, 500, 10), again,
    ]),
    result,
    el('a.btn', { href: '#/learn/expectancy', text: '레슨: 승률과 손익비, 표본' }),
  ]);
  run();
  return panel;
}
