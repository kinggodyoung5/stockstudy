/**
 * 계획을 숫자로 적는 연습의 계산. 매수 쪽 계획만 다룬다.
 *
 * 이 파일은 계획이 좋은지 나쁜지 판정하지 않는다. 거리·비율·수량을 계산하고,
 * 제출한 뒤에 이후 봉에서 무엇에 먼저 닿았는지 사실만 돌려준다.
 * 같은 봉에서 무효 가격과 지켜볼 가격에 모두 닿으면 일봉으로는 순서를 알 수 없으므로 'same-bar' 로 둔다.
 */
import { makeRandom } from './gbm.js';

export const PLAN_DAYS = 20;

/** 입력 검사. 문제가 있으면 문장을, 없으면 null 을 돌려준다. */
export function planError({ close, invalid, target }) {
  if (!Number.isFinite(invalid) || invalid <= 0) return '무효 가격을 숫자로 적으세요.';
  if (invalid >= close) return '매수 계획에서 무효 가격은 현재가보다 낮아야 합니다.';
  if (target != null && (!Number.isFinite(target) || target <= close)) return '지켜볼 가격은 현재가보다 높게 적거나 비워 두세요.';
  return null;
}

/** 현재가에서 무효 가격·지켜볼 가격까지의 거리 */
export function planMetrics({ close, atr, invalid, target = null }) {
  const risk = close - invalid;
  return {
    risk,
    riskPct: risk / close * 100,
    riskAtr: atr > 0 ? risk / atr : null,
    rewardPct: target != null ? (target - close) / close * 100 : null,
    ratio: target != null ? (target - close) / risk : null,
  };
}

/** 한 번에 잃어도 되는 금액에서 거꾸로 정한 수량. 수량은 내린다. */
export function sizeFor({ account, riskPercent, close, invalid }) {
  const budget = account * riskPercent / 100, perShare = close - invalid;
  const shares = perShare > 0 ? Math.floor(budget / perShare) : 0;
  return { budget, shares, amount: shares * close, loss: shares * perShare };
}

/** 계산값을 보고 알려줄 사실. 틀렸다고 말하지 않는다. */
export function planNotices(m) {
  const out = [];
  if (m.riskAtr != null && m.riskAtr < 1) out.push('무효 가격이 ATR 한 배보다 가깝습니다. 평소 하루 흔들림에도 닿을 수 있는 거리입니다.');
  if (m.ratio != null && m.ratio < 1) out.push('지켜볼 가격까지의 거리가 무효 가격까지의 거리보다 짧습니다.');
  return out;
}

/**
 * 관찰 마감일 i 다음 봉부터 days 개를 차례로 본다.
 * 반환: { first: 'invalid' | 'target' | 'same-bar' | 'none' | 'incomplete', bar, date, gapThrough, endClose, endR }
 *   bar: 처음 닿은 봉이 마감일 뒤 몇 번째인지(1부터). endR: 마지막으로 본 봉 종가의 위험 1단위 배수.
 */
export function planOutcome(candles, i, { invalid, target = null }, days = PLAN_DAYS) {
  const close = candles[i].close, risk = close - invalid;
  const last = Math.min(candles.length - 1, i + days);
  for (let k = i + 1; k <= last; k++) {
    const c = candles[k];
    const hitInvalid = c.low <= invalid, hitTarget = target != null && c.high >= target;
    if (hitInvalid || hitTarget) {
      const first = hitInvalid && hitTarget ? 'same-bar' : hitInvalid ? 'invalid' : 'target';
      return { first, bar: k - i, date: c.date, gapThrough: hitInvalid && c.open < invalid,
        endClose: c.close, endR: (c.close - close) / risk };
    }
  }
  const seen = last - i;
  return { first: seen < days ? 'incomplete' : 'none', bar: seen, date: candles[last].date, gapThrough: false,
    endClose: candles[last].close, endR: (candles[last].close - close) / risk };
}

/** 처음 제출한 계획을 잠근다. 이미 있으면 그대로 돌려준다. */
export function lockFirst(previous, record) {
  return previous?.submittedAt ? previous : record;
}

/* ───────────── 기대값 실험 (가상 계산) ───────────── */

/**
 * 같은 승률·손익비로 여러 번 돌려 본 계좌 곡선.
 * 한 번에 계좌의 riskPercent% 를 걸고, 맞히면 reward 배, 틀리면 1배를 잃는다(복리).
 * 반환: { expectancyR, curves(앞 20개), finals(정렬), median, p10, p90, streak: { median, max }, ruined }
 */
export function simulateExpectancy({ winRate, reward, riskPercent, trades, runs = 200, seed = 1 }) {
  const random = makeRandom(seed);
  const curves = [], finals = [], streaks = [];
  let ruined = 0;
  for (let r = 0; r < runs; r++) {
    let equity = 100, streak = 0, longest = 0;
    const curve = [equity];
    for (let t = 0; t < trades; t++) {
      const win = random() < winRate;
      equity *= 1 + (win ? reward : -1) * riskPercent / 100;
      streak = win ? 0 : streak + 1;
      longest = Math.max(longest, streak);
      curve.push(equity);
    }
    if (equity < 50) ruined++;
    finals.push(equity); streaks.push(longest);
    if (curves.length < 20) curves.push(curve);
  }
  finals.sort((a, b) => a - b); streaks.sort((a, b) => a - b);
  const at = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
  return { expectancyR: winRate * reward - (1 - winRate), curves, finals,
    median: at(finals, 0.5), p10: at(finals, 0.1), p90: at(finals, 0.9),
    streak: { median: at(streaks, 0.5), max: streaks.at(-1) }, ruined };
}
