/** 원자료는 보존한다. 오류 봉을 삭제해서 날짜 간격을 압축하거나 가격을 추정하지 않는다. */
export const QUALITY_POLICY = 'quarantine-whole-stock-v2';

export function expandStock(stock) {
  if (stock.format !== 2) return stock;
  const fields = stock.fields || ['date', 'open', 'high', 'low', 'close', 'volume'];
  return { ...stock, candles: stock.candles.map((r) => Object.fromEntries(fields.map((k, i) => [k, r[i]]))) };
}

export function candleProblems(c) {
  const reasons = [];
  if (![c.open, c.high, c.low, c.close].every((v) => Number.isFinite(v) && v > 0)) reasons.push('invalid-price');
  if (c.high < Math.max(c.open, c.close, c.low) || c.low > Math.min(c.open, c.close, c.high)) reasons.push('ohlc-range');
  if (!Number.isFinite(c.volume) || c.volume < 0) reasons.push('invalid-volume');
  if (typeof c.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(c.date)
    || !Number.isFinite(Date.parse(c.date)) || new Date(c.date).toISOString().slice(0, 10) !== c.date) reasons.push('invalid-date');
  return reasons;
}

export function inspectStock(stock) {
  const issues = [];
  const candles = stock.candles || [];
  candles.forEach((c, index) => {
    const reasons = candleProblems(c);
    if (index && c.date <= candles[index - 1].date) reasons.push('date-order-or-duplicate');
    if (reasons.length) issues.push({ index, ...c, reasons });
  });
  const sourceConcerns = stock.dataQuality?.sourceConcerns || [];
  return { ticker: stock.ticker, name: stock.name, candles: candles.length,
    eligible: candles.length > 0 && issues.length === 0 && sourceConcerns.length === 0, sourceConcerns,
    zeroVolume: candles.filter((c) => c.volume === 0).length, issues };
}
