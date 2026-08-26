/**
 * 가상 차트 생성기 탭 (설명서 5.3)
 * 변동성·추세·기간을 바꿔가며 "이런 파라미터면 차트가 이렇게 생긴다"를 몸으로 익히는 곳.
 */

import { generateCandles } from '../lib/gbm.js';
import { createStockChart } from '../lib/chart.js';
import { el, clear, overlayBar, signed, dirClass } from '../lib/ui.js';

let chart = null;

export function destroySandbox() {
  if (chart) { try { chart.destroy(); } catch (_) {} chart = null; }
}

export function renderSandbox(app) {
  destroySandbox();

  const params = { days: 250, volatility: 0.35, drift: 0.08, start: 10000, seed: Math.floor(Math.random() * 1e9) };
  const overlays = { ma5: true, ma20: true, ma60: false, bollinger: false, ichimoku: false, volume: true };

  const box = el('div.chart-box.tall');
  const stats = el('div.stat-row');
  const seedLabel = el('span.muted.small');

  const sliders = [
    { key: 'days', label: '기간 (캔들 개수)', min: 60, max: 750, step: 10, format: (v) => `${v}봉` },
    { key: 'volatility', label: '변동성 (연 기준)', min: 5, max: 100, step: 1, scale: 100, format: (v) => `${(v * 100).toFixed(0)}%` },
    { key: 'drift', label: '추세 강도 (연 기대수익률)', min: -50, max: 60, step: 1, scale: 100, format: (v) => `${(v * 100).toFixed(0)}%` },
  ];

  const controls = el('div.controls');
  const valueEls = {};

  for (const s of sliders) {
    const valEl = el('span.val', { text: s.format(params[s.key]) });
    valueEls[s.key] = valEl;
    const input = el('input', {
      type: 'range',
      min: s.min, max: s.max, step: s.step,
      value: s.scale ? params[s.key] * s.scale : params[s.key],
    });
    input.addEventListener('input', () => {
      params[s.key] = s.scale ? Number(input.value) / s.scale : Number(input.value);
      valEl.textContent = s.format(params[s.key]);
      draw();
    });
    controls.append(
      el('div.control', null, [
        el('label', null, [s.label + ' ', valEl]),
        input,
      ])
    );
  }

  const regenBtn = el('button.btn.primary', {
    text: '다시 생성',
    onclick: () => { params.seed = Math.floor(Math.random() * 1e9); draw(); },
  });

  function draw() {
    const { candles, seed } = generateCandles(params);
    if (!chart) {
      chart = createStockChart(box, { width: box.clientWidth, height: box.clientHeight });
    }
    chart.setOverlays(overlays);
    chart.setCandles(candles);
    chart.fit();

    const first = candles[0].close;
    const last = candles[candles.length - 1].close;
    let maxDrawdown = 0;
    let peak = candles[0].high;
    for (const c of candles) {
      if (c.high > peak) peak = c.high;
      const dd = ((c.low - peak) / peak) * 100;
      if (dd < maxDrawdown) maxDrawdown = dd;
    }
    const total = ((last - first) / first) * 100;

    clear(stats).append(
      statCard('전체 수익률', signed(total), dirClass(total)),
      statCard('최고점 대비 최대 낙폭', signed(maxDrawdown), 'down'),
      statCard('시작가 → 종료가', `${Math.round(first).toLocaleString()} → ${Math.round(last).toLocaleString()}`, 'muted'),
      statCard('캔들 수', `${candles.length}봉`, 'muted')
    );
    seedLabel.textContent = `seed ${seed} — 같은 seed·같은 설정이면 항상 같은 차트가 나옵니다`;
  }

  function statCard(label, value, cls) {
    return el('div.stat', null, [el('span', { text: label }), el('b', { class: cls, text: value })]);
  }

  clear(app).append(
    el('h1.page-title', { text: '가상 차트 생성기' }),
    el('p.page-sub', {
      text: '기하 브라운 운동(GBM)으로 만든 가짜 주가입니다. 실제 종목이 아니므로 "이 모양은 원래 이런 뜻" 같은 선입견 없이 순수하게 형태만 볼 수 있습니다.',
    }),
    el('div.panel', null, [
      controls,
      el('div.row', { style: { marginTop: '18px' } }, [
        regenBtn,
        overlayBar(overlays, (next) => { Object.assign(overlays, next); if (chart) chart.setOverlays(overlays); }),
        el('span.spacer'),
        seedLabel,
      ]),
      el('div', { style: { marginTop: '16px' } }, [box]),
      stats,
    ]),
    el('div.panel', { style: { marginTop: '18px' } }, [
      el('h3', { style: { margin: '0 0 8px', fontSize: '15px' }, text: '이렇게 써보세요' }),
      el('ul.small.muted', { style: { margin: '0', paddingLeft: '20px' } }, [
        el('li', { text: '변동성만 5% → 80%로 올려보세요. 같은 추세라도 차트가 얼마나 달라 보이는지 확인할 수 있습니다.' }),
        el('li', { text: '추세 강도를 0%로 두고 여러 번 "다시 생성"을 눌러보세요. 추세가 전혀 없는데도 골든크로스처럼 보이는 모양이 자주 나옵니다.' }),
        el('li', { text: '이동평균선을 켜두고 보면, 순수한 무작위 데이터에서도 지표 신호가 그럴듯하게 나타난다는 점을 알 수 있습니다.' }),
      ]),
    ])
  );

  draw();
}
