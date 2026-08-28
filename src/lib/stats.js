/**
 * 패턴 성과 통계
 *
 * 탐지된 각 사례에는 이미 "신호 이후 20거래일 실제 성과"가 붙어 있다.
 * 그걸 패턴 단위로 모으면 "이 신호는 실제로 얼마나 맞았나"를 숫자로 볼 수 있다.
 *
 * 주의: 이건 매매 전략의 백테스트가 아니다. 수수료·슬리피지·분산투자·자금관리가
 * 전혀 반영되지 않은 단순 집계이며, 표본이 적은 패턴은 우연일 가능성이 크다.
 * 이 화면의 목적은 "신호는 확률이지 보장이 아니다"를 체감하는 것이다.
 */

const round = (v, d = 2) => (v == null || !Number.isFinite(v) ? null : +Number(v).toFixed(d));

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * 사례 목록 → 성과 요약
 * winRate 는 "신호 이후 20거래일 뒤 종가가 올랐는가"의 비율이다.
 * 하락 신호(bias: down)라도 여기서는 항상 "상승 비율"로 계산한다 — 해석은 화면에서 한다.
 */
export function summarize(hits) {
  const changes = hits.map((h) => h.outcome && h.outcome.changePct).filter((v) => v != null);
  if (!changes.length) return null;

  const ups = changes.filter((v) => v > 0).length;
  const maxUps = hits.map((h) => h.outcome && h.outcome.maxUpPct).filter((v) => v != null);
  const maxDowns = hits.map((h) => h.outcome && h.outcome.maxDownPct).filter((v) => v != null);

  const mean = changes.reduce((a, b) => a + b, 0) / changes.length;
  const variance = changes.reduce((a, b) => a + (b - mean) ** 2, 0) / changes.length;

  return {
    samples: changes.length,
    winRate: round((ups / changes.length) * 100, 1),
    avgChange: round(mean),
    medianChange: round(median(changes)),
    stdev: round(Math.sqrt(variance)),
    best: round(Math.max(...changes)),
    worst: round(Math.min(...changes)),
    avgMaxUp: round(maxUps.reduce((a, b) => a + b, 0) / (maxUps.length || 1)),
    avgMaxDown: round(maxDowns.reduce((a, b) => a + b, 0) / (maxDowns.length || 1)),
  };
}

/**
 * 같은 기간 전체 시장의 "그냥 아무 날이나 샀을 때" 성과 — 비교 기준선.
 * 이게 없으면 승률 55%가 좋은 건지 나쁜 건지 알 수 없다.
 */
export function baseline(stocks, days = 20) {
  const changes = [];
  for (const stock of stocks) {
    const c = stock.candles;
    for (let i = 0; i + days < c.length; i += 5) {
      changes.push(((c[i + days].close - c[i].close) / c[i].close) * 100);
    }
  }
  if (!changes.length) return null;
  const mean = changes.reduce((a, b) => a + b, 0) / changes.length;
  return {
    samples: changes.length,
    winRate: round((changes.filter((v) => v > 0).length / changes.length) * 100, 1),
    avgChange: round(mean),
    medianChange: round(median(changes)),
  };
}

/**
 * 표본 수를 감안한 신뢰도 표시.
 * 표본이 적으면 승률이 아무리 높아도 우연일 수 있다는 걸 명시적으로 알려준다.
 */
export function confidence(samples) {
  if (samples == null) return { level: 'none', label: '표본 없음' };
  if (samples < 20) return { level: 'low', label: '표본 부족 (20건 미만) — 우연일 가능성이 큼' };
  if (samples < 60) return { level: 'mid', label: '표본 적음 (60건 미만) — 참고용' };
  return { level: 'ok', label: `표본 ${samples}건` };
}

/** 승률이 기준선 대비 얼마나 나은지 (퍼센트포인트) */
export const edgeOver = (stats, base) =>
  stats && base ? round(stats.winRate - base.winRate, 1) : null;

/**
 * 종목 분류 (프로파일)
 *
 * "차트 분석이 어느 종목군에서 다르게 동작하는가"를 보려면 종목을 나눠야 한다.
 * 시가총액이 먼저 떠오르지만, 시총은 간접 지표다. 패턴의 동작을 실제로 좌우하는 것은
 *
 *   1) 유동성 — 거래가 얇으면 호가가 띄엄띄엄해 가격이 계단처럼 움직이고,
 *      돌파·이탈 판정이 쉽게 흔들린다. 시총이 커도 거래가 안 되는 종목이 있다.
 *   2) 변동성 — 문턱값(2% 이상, 3배 이상 …)이 종목의 평소 폭에 대해 상대적으로
 *      얼마나 큰 값인지가 달라진다. 잘 흔들리는 종목은 신호가 늘 켜져 있다.
 *   3) 시장·제도 — 국내는 상·하한가(±30%)가 있고 호가 단위가 다르다.
 *      코스닥은 코스피보다 개인 비중과 변동성이 높다.
 *
 * 시총은 1)과 2)의 대략적인 대리 변수일 뿐이고, 게다가 따로 수집해야 한다.
 * 반면 유동성과 변동성은 지금 가진 OHLCV 만으로 바로 계산된다.
 */

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

/** 최근 1년 기준 종목 프로파일 */
export function profileOf(stock, atrPctSeries, lookback = 252) {
  const c = stock.candles;
  const tail = c.slice(-lookback);
  const board = stock.ticker.endsWith('.KQ') ? 'KOSDAQ'
    : stock.ticker.endsWith('.KS') ? 'KOSPI'
    : 'US';
  return {
    ticker: stock.ticker,
    name: stock.name,
    board,
    // 거래대금: 통화가 달라 시장 간 절대 비교는 안 되므로, 아래에서 시장 안 순위로 바꾼다
    turnover: mean(tail.map((x) => x.close * x.volume)),
    atrPct: round(mean(atrPctSeries.slice(-lookback).filter((v) => v != null))),
    days: c.length,
  };
}

/** 값을 3등분해 low / mid / high 로 (같은 시장 안에서 순위를 매길 수도 있다) */
function tercile(items, valueOf, groupOf) {
  const groups = new Map();
  for (const it of items) {
    const g = groupOf ? groupOf(it) : '_';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(it);
  }
  const out = new Map();
  for (const arr of groups.values()) {
    const sorted = [...arr].sort((a, b) => valueOf(a) - valueOf(b));
    sorted.forEach((it, i) => {
      const r = i / Math.max(1, sorted.length - 1);
      out.set(it.ticker, r < 1 / 3 ? 'low' : r < 2 / 3 ? 'mid' : 'high');
    });
  }
  return out;
}

/**
 * 프로파일 목록 → 분류 축별 버킷 배정
 * 유동성은 통화가 다르므로 **같은 시장 안에서** 순위를 매긴다.
 */
export function assignBuckets(profiles) {
  const liq = tercile(profiles, (p) => p.turnover, (p) => p.board);
  const vol = tercile(profiles, (p) => p.atrPct);
  for (const p of profiles) {
    p.liquidity = liq.get(p.ticker);
    p.volatility = vol.get(p.ticker);
  }
  return profiles;
}

export const AXES = {
  liquidity: {
    name: '유동성 (거래대금)',
    why: '거래가 얇으면 가격이 띄엄띄엄 움직여 돌파·이탈 판정이 쉽게 흔들립니다. 같은 시장 안에서 일평균 거래대금 순위로 3등분했습니다.',
    keys: ['high', 'mid', 'low'],
    labels: { high: '상위 1/3 (활발)', mid: '중위 1/3', low: '하위 1/3 (한산)' },
  },
  volatility: {
    name: '변동성 (ATR%)',
    why: '평소 크게 흔들리는 종목에서는 "2% 이상 움직였다" 같은 조건이 평범한 하루에도 걸립니다. 최근 1년 평균 ATR%로 3등분했습니다.',
    keys: ['low', 'mid', 'high'],
    labels: { low: '하위 1/3 (얌전)', mid: '중위 1/3', high: '상위 1/3 (요동)' },
  },
  board: {
    name: '시장',
    why: '국내는 상·하한가(±30%) 제도가 있고 호가 단위가 다릅니다. 코스닥은 코스피보다 변동성이 큰 편입니다.',
    keys: ['KOSPI', 'KOSDAQ', 'US'],
    labels: { KOSPI: '코스피', KOSDAQ: '코스닥', US: '미국' },
  },
};
