/**
 * 탐지 엔진 통합 레지스트리
 *
 * 규칙은 성격별로 네 파일에 나뉘어 있고, 여기서 하나로 합친다.
 * 새 패턴을 추가할 때는 해당 파일에 규칙 하나만 더하면 되고,
 * 학습 탭·배치 도구·통계는 전부 이 레지스트리만 본다.
 *
 *   patterns.js             이동평균·볼린저·거래량·일목 등 지표 기반
 *   patterns-shape.js       헤드앤숄더·이중천장·삼각수렴 등 도형
 *   patterns-oscillator.js  RSI·MACD·스토캐스틱·다이버전스 등
 *   candlestick.js          망치형·장악형 등 1~3봉 캔들
 */

import { PATTERNS, detectStock as detectIndicator } from './patterns.js';
import { SHAPE_PATTERNS, detectShapePatterns } from './patterns-shape.js';
import { OSC_PATTERNS, detectOscillatorPatterns } from './patterns-oscillator.js';
import { CANDLE_PATTERNS, detectCandlePatterns } from './candlestick.js';

/** 패턴 정의 전체 — id → { name, lesson, summary, rules, bias } */
export const ALL_PATTERNS = {
  ...PATTERNS,
  ...SHAPE_PATTERNS,
  ...OSC_PATTERNS,
  ...CANDLE_PATTERNS,
};

export const ALL_PATTERN_IDS = Object.keys(ALL_PATTERNS);

/** 그룹 정보 — 학습 탭/통계 화면에서 묶어 보여줄 때 쓴다 */
export const PATTERN_GROUPS = [
  { id: 'indicator', name: '지표 기반', ids: Object.keys(PATTERNS) },
  { id: 'shape', name: '도형 패턴', ids: Object.keys(SHAPE_PATTERNS) },
  { id: 'oscillator', name: '오실레이터 · 다이버전스', ids: Object.keys(OSC_PATTERNS) },
  { id: 'candlestick', name: '캔들스틱', ids: Object.keys(CANDLE_PATTERNS) },
];

export const groupOf = (id) => PATTERN_GROUPS.find((g) => g.ids.includes(id))?.id || 'indicator';

/** 한 종목에 모든 규칙을 적용 */
export function detectStock(stock) {
  const merged = {
    ...detectIndicator(stock),
    ...detectShapePatterns(stock),
    ...detectOscillatorPatterns(stock),
    ...detectCandlePatterns(stock),
  };

  // 어느 파일에서 왔든 결과 형태를 똑같이 맞춰준다
  const stamp = {
    ticker: stock.ticker,
    name: stock.name,
    market: stock.market,
    currency: stock.currency,
  };
  for (const [id, hits] of Object.entries(merged)) {
    merged[id] = hits.map((h) => ({ ...stamp, pattern: id, ...h }));
  }
  return merged;
}

/** 여러 종목의 탐지 결과를 패턴별로 합치기 */
export function mergeDetections(list) {
  const out = {};
  for (const id of ALL_PATTERN_IDS) out[id] = [];
  for (const per of list) {
    for (const [id, hits] of Object.entries(per)) {
      if (!out[id]) out[id] = [];
      out[id].push(...hits);
    }
  }
  return out;
}
