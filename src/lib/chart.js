/**
 * lightweight-charts 래퍼
 * 지표 계산은 indicators.js / oscillators.js 가 하고, 이 파일은 "그려주는 일"만 한다.
 *
 * 오실레이터(RSI·MACD 등)는 값의 단위가 가격과 달라 같은 축에 겹칠 수 없다.
 * 그래서 별도의 차트를 아래에 쌓고, 시간축만 서로 동기화한다.
 */

import { sma, bollinger, ichimoku, closes } from './indicators.js';

const LWC = () => window.LightweightCharts;

export const OVERLAY_LABELS = {
  ma5: '5일선',
  ma20: '20일선',
  ma60: '60일선',
  ma120: '120일선',
  ma200: '200일선',
  bollinger: '볼린저밴드',
  ichimoku: '일목균형표',
  volume: '거래량',
};

const COLORS = {
  up: '#e04b4b',      // 국내 관례: 상승 빨강
  down: '#2f7fe0',    // 하락 파랑
  ma5: '#f2b134',
  ma20: '#4dd0a7',
  ma60: '#a98bff',
  ma120: '#5b8def',
  ma200: '#ff8a3d',
  bbMid: '#8892a6',
  bbBand: '#5b8def',
  spanA: '#4dd0a7',
  spanB: '#e04b4b',
  tenkan: '#f2b134',
  kijun: '#5b8def',
  chikou: '#8892a6',
  neckline: '#ff8a3d',
  support: '#4dd0a7',
  resistance: '#e04b4b',
  fib: '#a98bff',
  warn: '#f2b134',
  guide: 'rgba(255,255,255,0.18)',
};

const MA_PERIODS = { ma5: 5, ma20: 20, ma60: 60, ma120: 120, ma200: 200 };

function baseOptions(extra = {}) {
  return {
    layout: {
      background: { type: 'solid', color: 'transparent' },
      textColor: '#a9b2c3',
      fontFamily: "'Pretendard', -apple-system, 'Malgun Gothic', sans-serif",
    },
    grid: {
      vertLines: { color: 'rgba(255,255,255,0.04)' },
      horzLines: { color: 'rgba(255,255,255,0.06)' },
    },
    rightPriceScale: { borderColor: 'rgba(255,255,255,0.12)' },
    timeScale: { borderColor: 'rgba(255,255,255,0.12)', rightOffset: 4 },
    crosshair: { mode: 0 },
    localization: {
      locale: 'ko-KR',
      priceFormatter: (p) => (Math.abs(p) >= 1000 ? Math.round(p).toLocaleString('ko-KR') : +p.toFixed(2)),
    },
    ...extra,
  };
}

/** 값 배열(null 포함) → lightweight-charts 데이터 */
function toSeries(candles, values, extra) {
  const out = [];
  for (let i = 0; i < candles.length; i++) {
    if (values[i] == null || !Number.isFinite(values[i])) continue;
    out.push({ time: candles[i].date, value: values[i], ...(extra ? extra(values[i], i) : null) });
  }
  return out;
}

/** 가격 차트 */
export function createStockChart(container, opts = {}) {
  const { logScale = false, ...rest } = opts;
  const chart = LWC().createChart(container, baseOptions(rest));
  if (logScale) chart.priceScale('right').applyOptions({ mode: 1 }); // 1 = logarithmic

  const candleSeries = chart.addCandlestickSeries({
    upColor: COLORS.up,
    downColor: COLORS.down,
    borderUpColor: COLORS.up,
    borderDownColor: COLORS.down,
    wickUpColor: COLORS.up,
    wickDownColor: COLORS.down,
  });

  const volumeSeries = chart.addHistogramSeries({
    priceFormat: { type: 'volume' },
    priceScaleId: 'vol',
  });
  chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, visible: false });

  const lines = {};       // key → LineSeries
  const priceLines = {};  // key → [PriceLine]
  let candles = [];
  let overlays = {};
  // 지표 설정. 사용자가 기간을 바꿔가며 "파라미터에 따라 신호가 달라진다"를 확인할 수 있게 열어둔다.
  let params = { ma: { ...MA_PERIODS }, bb: { period: 20, mult: 2 } };

  const ro = new ResizeObserver(() => {
    chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
  });
  ro.observe(container);

  function lineOf(key, options) {
    if (!lines[key]) {
      lines[key] = chart.addLineSeries({
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        ...options,
      });
    }
    return lines[key];
  }

  function dropLine(key) {
    if (lines[key]) {
      chart.removeSeries(lines[key]);
      delete lines[key];
    }
  }

  function setCandles(next) {
    candles = next;
    candleSeries.setData(
      candles.map((c) => ({ time: c.date, open: c.open, high: c.high, low: c.low, close: c.close }))
    );
    volumeSeries.setData(
      candles.map((c, i) => ({
        time: c.date,
        value: c.volume,
        color: i > 0 && c.close < candles[i - 1].close ? 'rgba(47,127,224,0.45)' : 'rgba(224,75,75,0.45)',
      }))
    );
    applyOverlays(overlays);
  }

  function applyOverlays(next) {
    overlays = { ...next };
    if (!candles.length) return;
    const c = closes(candles);

    for (const key of Object.keys(MA_PERIODS)) {
      if (overlays[key]) {
        lineOf(key, { color: COLORS[key], lineWidth: key === 'ma200' ? 2 : 1 })
          .setData(toSeries(candles, sma(c, params.ma[key])));
      } else dropLine(key);
    }

    if (overlays.bollinger) {
      const bb = bollinger(c, params.bb.period, params.bb.mult);
      lineOf('bbUpper', { color: COLORS.bbBand }).setData(toSeries(candles, bb.upper));
      lineOf('bbMid', { color: COLORS.bbMid, lineStyle: 2 }).setData(toSeries(candles, bb.mid));
      lineOf('bbLower', { color: COLORS.bbBand }).setData(toSeries(candles, bb.lower));
    } else {
      ['bbUpper', 'bbMid', 'bbLower'].forEach(dropLine);
    }

    if (overlays.ichimoku) {
      const ich = ichimoku(candles);
      lineOf('spanA', { color: COLORS.spanA, lineWidth: 2 }).setData(toSeries(candles, ich.spanA));
      lineOf('spanB', { color: COLORS.spanB, lineWidth: 2 }).setData(toSeries(candles, ich.spanB));
      lineOf('tenkan', { color: COLORS.tenkan }).setData(toSeries(candles, ich.tenkan));
      lineOf('kijun', { color: COLORS.kijun }).setData(toSeries(candles, ich.kijun));
      lineOf('chikou', { color: COLORS.chikou, lineStyle: 2 }).setData(toSeries(candles, ich.chikou));
    } else {
      ['spanA', 'spanB', 'tenkan', 'kijun', 'chikou'].forEach(dropLine);
    }

    chart.priceScale('vol').applyOptions({ visible: !!overlays.volume });
    volumeSeries.applyOptions({ visible: !!overlays.volume });
  }

  /** 수평 가격선 (지지·저항, 피보나치 등). 같은 key로 다시 부르면 갈아끼운다. */
  function setPriceLines(key, defs) {
    (priceLines[key] || []).forEach((pl) => candleSeries.removePriceLine(pl));
    priceLines[key] = (defs || []).map((d) =>
      candleSeries.createPriceLine({
        price: d.price,
        color: d.color || COLORS.neckline,
        lineWidth: d.width || 1,
        lineStyle: d.style == null ? 2 : d.style,
        axisLabelVisible: true,
        title: d.title || '',
      })
    );
  }

  /** 임의의 직선(넥라인, 추세선 등) */
  function drawSegment(key, points, color = COLORS.neckline) {
    lineOf(key, { color, lineWidth: 2, lineStyle: 2 }).setData(
      points.map((p) => ({ time: p.date, value: p.value }))
    );
  }

  function setMarkers(markers) {
    candleSeries.setMarkers(
      (markers || []).map((m) => ({
        time: m.date,
        position: m.position || 'aboveBar',
        color: m.color || '#ffffff',
        shape: m.shape || 'arrowDown',
        text: m.text || '',
      }))
    );
  }

  return {
    chart,
    candleSeries,
    setCandles,
    setOverlays: applyOverlays,
    setParams: (p) => { params = { ...params, ...p }; applyOverlays(overlays); },
    getParams: () => params,
    setMarkers,
    setPriceLines,
    drawSegment,
    dropLine,
    setLogScale: (on) => chart.priceScale('right').applyOptions({ mode: on ? 1 : 0 }),
    fit: () => chart.timeScale().fitContent(),
    setVisibleRange: (from, to) => chart.timeScale().setVisibleRange({ from, to }),
    destroy: () => {
      ro.disconnect();
      chart.remove();
    },
  };
}

/**
 * 오실레이터 패널
 * def 는 oscillators.js 의 OSCILLATORS[id] 형태 — 무엇을 어떤 색으로 그릴지 그 안에 다 있다.
 */
export function createOscillatorPanel(container, def, candles, oscParams) {
  const chart = LWC().createChart(
    container,
    baseOptions({
      width: container.clientWidth,
      height: container.clientHeight,
      timeScale: { borderColor: 'rgba(255,255,255,0.12)', visible: false, rightOffset: 4 },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.12)', scaleMargins: { top: 0.12, bottom: 0.08 } },
      handleScale: { axisPressedMouseMove: false },
    })
  );

  const ro = new ResizeObserver(() => {
    chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
  });
  ro.observe(container);

  const series = [];
  for (const spec of def.compute(candles, oscParams || def.params || {})) {
    if (spec.type === 'histogram') {
      const s = chart.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
      s.setData(
        toSeries(candles, spec.values, (v) => ({
          color: spec.signed ? (v >= 0 ? 'rgba(224,75,75,0.55)' : 'rgba(47,127,224,0.55)') : spec.color,
        }))
      );
      series.push(s);
    } else {
      const s = chart.addLineSeries({
        color: spec.color,
        lineWidth: spec.width || 1,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: false,
      });
      s.setData(toSeries(candles, spec.values));
      series.push(s);
    }
  }

  // 과매수/과매도 기준선
  if (def.guides && series.length) {
    for (const g of def.guides) {
      series[series.length - 1].createPriceLine({
        price: g,
        color: COLORS.guide,
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: '',
      });
    }
  }

  if (def.range) {
    chart.priceScale('right').applyOptions({ autoScale: false });
    series[0].applyOptions({ autoscaleInfoProvider: () => ({ priceRange: { minValue: def.range[0], maxValue: def.range[1] } }) });
  }

  return {
    chart,
    fit: () => chart.timeScale().fitContent(),
    destroy: () => { ro.disconnect(); chart.remove(); },
  };
}

/**
 * 여러 차트의 시간축을 하나로 묶는다.
 * 한쪽을 움직이면 나머지가 따라오되, 되먹임으로 무한 루프가 돌지 않게 잠금을 건다.
 */
export function syncTimeScales(charts) {
  let locked = false;
  const unsubs = [];
  for (const src of charts) {
    const handler = (range) => {
      if (locked || !range) return;
      locked = true;
      for (const dst of charts) {
        if (dst !== src) dst.timeScale().setVisibleLogicalRange(range);
      }
      locked = false;
    };
    src.timeScale().subscribeVisibleLogicalRangeChange(handler);
    unsubs.push(() => src.timeScale().unsubscribeVisibleLogicalRangeChange(handler));
  }
  return () => unsubs.forEach((f) => f());
}

export { COLORS };
