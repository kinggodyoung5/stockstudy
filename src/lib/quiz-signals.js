import { ALL_PATTERNS, detectStock, groupOf, PATTERN_GROUPS } from './engine.js';

// 보조 퀴즈도 레슨과 같은 엔진을 사용한다. 모든 계산에 마감일까지의 봉만 전달한다.
export const QUIZ_RULES = ['golden-cross', 'dead-cross', 'ma-alignment', 'volume-spike', 'bollinger-breakout', 'cloud-breakout', 'rsi-overbought', 'rsi-oversold', 'macd-golden-cross', 'macd-dead-cross', 'disparity-overheat', 'disparity-oversold'];
export function evaluateSignals(stock, cutIndex, within = 10) {
  if (!Number.isInteger(cutIndex) || cutIndex < 0 || !stock.candles[cutIndex]) throw new Error('잘못된 관찰 마감일');
  const candles = stock.candles.slice(0, cutIndex + 1);
  const detections = detectStock({ ...stock, candles });
  const from = candles[Math.max(0, candles.length - within)].date;
  return QUIZ_RULES.map((id) => {
    const def = ALL_PATTERNS[id];
    if (!def) throw new Error('퀴즈 규칙 미등록: ' + id);
    const hits = detections[id].filter((h) => {
      const known = h.confirmLag ? h.confirmDate : h.date;
      return known && known >= from && known <= candles.at(-1).date;
    });
    return { id, label: `${def.name} — 최근 ${within}거래일 안에 조건 확인`,
      group: PATTERN_GROUPS.find((g) => g.id === groupOf(id)).name,
      present: hits.length > 0, rules: def.rules, dates: hits.map((h) => h.confirmDate || h.date) };
  });
}
