/**
 * lightweight-charts 래퍼
 * 지표 계산은 indicators.js가 하고, 이 파일은 "그려주는 일"만 한다.
 * (React로 옮길 때 이 파일만 useEffect 안으로 들어가면 된다)
 */

import { sma, bollinger, ichimoku, closes } from './indicators.js';

const LWC = () => window.LightweightCharts;

export const OVERLAY_LABELS = {
  ma5: '5일선',
  ma20: '20일선',
  ma60: '60일선',
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
  bbMid: '#8892a6',
  bbBand: '#5b8def',
  spanA: '#4dd0a7',
  spanB: '#e04b4b',
  tenkan: '#f2b134',
  kijun: '#5b8def',
  chikou: '#8892a6',
  neckline: '#ff8a3d',
};

function baseOptions() {
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
      priceFormatter: (p) => (Math.abs(p) >= 1000 ? Math.round(p).toLocaleString('ko-KR') : p.toFixed(2)),
    },
  };
}

/** 지표선 계열을 담아두고 토글할 때 붙였다 뗐다 한다 */
export function createStockChart(container, opts = {}) {
  const chart = LWC().createChart(container, { ...baseOptions(), ...opts });

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

  const lines = {}; // key → LineSeries
  let candles = [];
  let overlays = {};

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

  /** 값 배열(null 포함)을 lightweight-charts 데이터로 */
  function toLine(values) {
    const out = [];
    for (let i = 0; i < candles.length; i++) {
      if (values[i] == null || !Number.isFinite(values[i])) continue;
      out.push({ time: candles[i].date, value: values[i] });
    }
    return out;
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

    // 이동평균선
    for (const [key, period] of [['ma5', 5], ['ma20', 20], ['ma60', 60]]) {
      if (overlays[key]) lineOf(key, { color: COLORS[key], lineWidth: 2 }).setData(toLine(sma(c, period)));
      else dropLine(key);
    }

    // 볼린저밴드
    if (overlays.bollinger) {
      const bb = bollinger(c, 20, 2);
      lineOf('bbUpper', { color: COLORS.bbBand, lineWidth: 1 }).setData(toLine(bb.upper));
      lineOf('bbMid', { color: COLORS.bbMid, lineWidth: 1, lineStyle: 2 }).setData(toLine(bb.mid));
      lineOf('bbLower', { color: COLORS.bbBand, lineWidth: 1 }).setData(toLine(bb.lower));
    } else {
      ['bbUpper', 'bbMid', 'bbLower'].forEach(dropLine);
    }

    // 일목균형표 (구름대는 선행스팬1·2 두 선 사이 영역으로 읽는다)
    if (overlays.ichimoku) {
      const ich = ichimoku(candles);
      lineOf('spanA', { color: COLORS.spanA, lineWidth: 2 }).setData(toLine(ich.spanA));
      lineOf('spanB', { color: COLORS.spanB, lineWidth: 2 }).setData(toLine(ich.spanB));
      lineOf('tenkan', { color: COLORS.tenkan, lineWidth: 1 }).setData(toLine(ich.tenkan));
      lineOf('kijun', { color: COLORS.kijun, lineWidth: 1 }).setData(toLine(ich.kijun));
      lineOf('chikou', { color: COLORS.chikou, lineWidth: 1, lineStyle: 2 }).setData(toLine(ich.chikou));
    } else {
      ['spanA', 'spanB', 'tenkan', 'kijun', 'chikou'].forEach(dropLine);
    }

    chart.priceScale('vol').applyOptions({ visible: !!overlays.volume });
    volumeSeries.applyOptions({ visible: !!overlays.volume });
  }

  /** 임의의 직선(넥라인 등) 그리기 */
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
    setMarkers,
    drawSegment,
    dropLine,
    fit: () => chart.timeScale().fitContent(),
    setVisibleRange: (from, to) => chart.timeScale().setVisibleRange({ from, to }),
    destroy: () => {
      ro.disconnect();
      chart.remove();
    },
  };
}

export { COLORS };
