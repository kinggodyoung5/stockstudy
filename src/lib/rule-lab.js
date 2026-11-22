/**
 * 규칙 실험실 (로드맵 Z1). 내 기준 묶음의 진입·전부 정리 기준을 저장된 과거 자료에 돌려 본다.
 *
 * 가정 (화면에 그대로 밝힌다)
 *   - 기준은 그날 종가로 판정하고, 다음 거래일 시가에 사고판다. 장중 가격은 보지 않는다. 갭은 그대로 손익에 들어간다.
 *   - 한 종목에 한 번에 한 포지션, 같은 금액. 추가 검토·일부 정리 기준은 실험실에서 쓰지 않는다.
 *   - 비용: 사고팔 때 수수료, 팔 때 세금, 원하는 가격에 못 사고 밀리는 손실(슬리피지)을 % 로 넣는다. 앱은 값을 정해 주지 않는다.
 *   - 자료 끝까지 정리 기준에 걸리지 않은 거래는 결과에서 빼고 따로 센다.
 *   - 앞 구간과 뒤 구간은 진입일로 나눈다. 앞 구간에서 기준을 정하고 뒤 구간은 한 번만 보라는 뜻이다.
 * 종목 목록에 상장폐지된 회사가 없어 과거 결과가 실제보다 좋게 나올 수 있다(생존 편향).
 */
import { rulesContext, evalGroup } from './rules.js';

export const LAB_MIN_SAMPLE = 30;

/** stocks: [{ ticker, candles }]. opts: { fee, tax, slip (모두 %), split: 'YYYY-MM-DD' } */
export function runLab(stocks, set, opts) {
  const fee = (opts.fee || 0) / 100, tax = (opts.tax || 0) / 100, slip = (opts.slip || 0) / 100;
  const trades = [], open = [];
  for (const s of stocks) {
    const cs = s.candles, ctx = rulesContext(cs);
    let pos = null;
    for (let i = 1; i < cs.length; i++) {
      if (!pos) {
        if (i + 1 >= cs.length) break;
        const hit = evalGroup(ctx, i, set, 'entry').find((r) => r.hit);
        if (hit) pos = { entryIndex: i + 1, entryPrice: cs[i + 1].open, signalDate: cs[i].date, entryRule: hit.index };
        continue;
      }
      if (i < pos.entryIndex) continue;
      const out = evalGroup(ctx, i, set, 'exitAll', pos).find((r) => r.hit);
      if (!out) continue;
      if (i + 1 >= cs.length) { open.push({ ticker: s.ticker, entryDate: cs[pos.entryIndex].date }); pos = null; break; }
      const buy = pos.entryPrice * (1 + slip) * (1 + fee), sell = cs[i + 1].open * (1 - slip) * (1 - fee - tax);
      trades.push({ ticker: s.ticker, signalDate: pos.signalDate, entryDate: cs[pos.entryIndex].date, entryPrice: pos.entryPrice,
        exitSignalDate: cs[i].date, exitDate: cs[i + 1].date, exitPrice: cs[i + 1].open, ret: (sell / buy - 1) * 100,
        days: i + 1 - pos.entryIndex, entryRule: pos.entryRule, exitRule: out.index });
      // 다음 반복(i + 1, 판 날)의 종가부터 다시 진입 기준을 본다.
      pos = null;
    }
    if (pos) open.push({ ticker: s.ticker, entryDate: cs[pos.entryIndex].date });
  }
  const before = trades.filter((t) => t.entryDate < opts.split), after = trades.filter((t) => t.entryDate >= opts.split);
  return { trades, open, segments: { before: summarize(before), after: summarize(after), all: summarize(trades) } };
}

const quant = (sorted, q) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null;

/** 거래 결과 요약. 표본이 LAB_MIN_SAMPLE 보다 적으면 비율·구간은 null 로 둔다(숫자로 쓰지 않는다). */
export function summarize(trades) {
  const r = trades.map((t) => t.ret).sort((a, b) => a - b), k = r.length;
  if (!k) return { n: 0 };
  const mean = r.reduce((a, b) => a + b, 0) / k;
  const sd = k > 1 ? Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / (k - 1)) : 0;
  const enough = k >= LAB_MIN_SAMPLE;
  return { n: k, enough, tickers: new Set(trades.map((t) => t.ticker)).size,
    winShare: enough ? trades.filter((t) => t.ret > 0).length / k * 100 : null,
    mean, median: quant(r, 0.5), p10: quant(r, 0.1), p90: quant(r, 0.9), worst: r[0], best: r[k - 1],
    // 평균의 95% 구간(정규 근사). 거래끼리 겹치는 시기가 있어 실제 불확실성은 이보다 크다.
    ci: enough ? [mean - 1.96 * sd / Math.sqrt(k), mean + 1.96 * sd / Math.sqrt(k)] : null,
    avgDays: trades.reduce((a, t) => a + t.days, 0) / k };
}
