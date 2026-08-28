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
