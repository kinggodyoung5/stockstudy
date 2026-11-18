/**
 * 돌파한 날 읽기와 돌파 뒤 되돌림. 저항 후보는 입문 '저항 후보와 종가 돌파'와 같은 "직전 20봉 최고가"다.
 *   breakout-volume: 종가로 넘은 날의 거래량 배수와 종가가 끝난 위치 (관찰형)
 *   retest: 3~15봉 전에 종가로 넘은 뒤, 오늘까지 그 가격으로 되돌아왔는지 (관찰형)
 */

export const BREAKOUT = { lookback: 20, volumeRatio: 1.5, topShare: 2 / 3, retestPct: 1, from: 3, to: 15, quiet: 5 };

/** k 일 직전 20봉의 최고가. k 일 자신은 빼고 본다. */
export const priorHigh = (cs, k) => Math.max(...cs.slice(k - BREAKOUT.lookback, k).map((c) => c.high));
export const isBreakout = (cs, k) => k >= BREAKOUT.lookback && cs[k].close > priorHigh(cs, k);

export function buildBreakoutVolume(ctx, i, q, h) {
  const cs = ctx.candles, today = cs[i], v = ctx.volume[i];
  if (!isBreakout(cs, i) || v?.ratio == null) return null;
  const level = priorHigh(cs, i), range = today.high - today.low;
  if (!range || v.ratio === BREAKOUT.volumeRatio) return null;
  const pos = (today.close - today.low) / range;
  if (pos === BREAKOUT.topShare) return null;
  const heavy = v.ratio >= BREAKOUT.volumeRatio, top = pos > BREAKOUT.topShare;
  h.choose(['거래량은 평균의 1.5배 이상, 종가는 그날 범위의 위쪽 3분의 1', '거래량은 평균의 1.5배 이상, 종가는 위쪽 3분의 1 밖',
    '거래량은 평균의 1.5배 미만, 종가는 그날 범위의 위쪽 3분의 1', '거래량은 평균의 1.5배 미만, 종가는 위쪽 3분의 1 밖'],
  (heavy ? 0 : 2) + (top ? 0 : 1));
  const cut = today.low + range * BREAKOUT.topShare;
  h.read('volume', '오늘 거래량 ÷ 직전 20봉 평균', heavy ? 'heavy' : 'light', { heavy: '1.5배 이상', light: '1.5배 미만' },
    `${h.n(today.volume)} ÷ ${h.n(v.avg)} = ${h.n(v.ratio)}배`, '마지막 거래량 막대와 앞 20개 막대의 평균 높이');
  h.read('close', '종가가 끝난 위치', top ? 'top' : 'lower', { top: '위쪽 3분의 1', lower: '위쪽 3분의 1 밖' },
    `종가 ${h.n(today.close)} · 위쪽 3분의 1이 시작하는 가격 ${h.n(cut)} (저가 ${h.n(today.low)} + 범위 ${h.n(range)} × 2/3)`, '마지막 봉의 길이와 몸통 위쪽 끝');
  q.claims = [{ volume: 'heavy', close: 'top' }, { volume: 'heavy', close: 'lower' }, { volume: 'light', close: 'top' }, { volume: 'light', close: 'lower' }];
  q.overlays = { volume: true };
  q.viewBars = 60;
  q.lines = [{ name: '직전 20봉 최고가', value: level, from: cs[i - BREAKOUT.lookback].date }];
  q.prompt = '종가가 직전 20봉 최고가를 넘은 날입니다. 거래량과 종가가 끝난 위치를 함께 읽으면?';
  q.hint = '거래량은 오늘을 뺀 직전 20봉 평균과 비교합니다. 이 연습의 1.5배와 3분의 1은 읽는 연습을 위한 기준이며, 거래량 급증 탐지 규칙의 2배와 다릅니다. 둘 다 돌파가 유지된다는 보장은 아닙니다.';
  q.facts = [h.price('직전 20봉 최고가', level), h.price('오늘 고가', today.high), h.price('오늘 저가', today.low), h.price('오늘 종가', today.close),
    h.num('오늘 거래량', today.volume, '주'), h.num('직전 20봉 평균 거래량', v.avg, '주')];
  q.margin = Math.min(Math.abs(v.ratio - BREAKOUT.volumeRatio), Math.abs(pos - BREAKOUT.topShare));
  q.explanation = `거래량은 평균의 ${h.n(v.ratio)}배, 종가는 그날 범위의 아래에서 ${h.n(pos * 100)}% 지점에서 끝났습니다. ${
    top ? '고가 근처에서 끝났다는 것은 마감까지 그 가격대에서 거래가 이어졌다는 사실입니다.' : '넘기는 했지만 고가에서 꽤 내려와 끝났습니다.'} 거래량이 많았던 돌파가 꼭 유지되는 것은 아닙니다. 다음 며칠 종가가 돌파한 가격 위에 머무는지는 별도로 봅니다.`;
  return q;
}

/** 오늘에서 3~15봉 전의 돌파일 가운데 가장 최근 것. 그 앞 5봉 안에 다른 돌파가 없어야 한다. */
export function retestBase(cs, i) {
  for (let b = i - BREAKOUT.from; b >= i - BREAKOUT.to; b--) {
    if (!isBreakout(cs, b)) continue;
    for (let k = b - BREAKOUT.quiet; k < b; k++) if (isBreakout(cs, k)) return null;
    return b;
  }
  return null;
}

export function buildRetest(ctx, i, q, h) {
  const cs = ctx.candles, today = cs[i], b = retestBase(cs, i);
  if (b == null) return null;
  const L = priorHigh(cs, b), after = cs.slice(b + 1, i + 1);
  const minLow = Math.min(...after.map((c) => c.low)), minClose = Math.min(...after.map((c) => c.close));
  const touchLine = L * (1 + BREAKOUT.retestPct / 100);
  const state = minClose < L ? 'fail' : minLow < touchLine ? 'retest' : 'hold';
  h.choose(['돌파 뒤 돌파 가격 근처까지 되돌아오지 않았다', '돌파 가격 근처까지 되돌아왔지만 종가는 모두 그 위에서 끝났다',
    '종가가 돌파 가격 아래로 끝난 날이 있다'], { hold: 0, retest: 1, fail: 2 }[state], state);
  const firstFail = after.findIndex((c) => c.close < L), firstTouch = after.findIndex((c) => c.low < touchLine);
  h.read('state', '돌파일 다음 날부터 오늘까지', state,
    { hold: '되돌림 없이 유지', retest: '되돌린 뒤 유지', fail: '돌파 가격 아래로 되돌아옴' },
    `돌파 가격 ${h.n(L)} · 그 뒤 최저가 ${h.n(minLow)} · 그 뒤 가장 낮은 종가 ${h.n(minClose)}`, '‘돌파일’ 오른쪽 봉들의 저가·종가와 가로선');
  q.claims = [{ state: 'hold' }, { state: 'retest' }, { state: 'fail' }];
  q.viewBars = 60;
  q.lines = [{ name: '돌파한 가격 (돌파일 직전 20봉 최고가)', value: L, from: cs[b - BREAKOUT.lookback].date }];
  q.markers = [{ date: cs[b].date, text: '돌파일', position: 'aboveBar' }];
  q.revealMarkers = [
    firstTouch >= 0 ? { date: after[firstTouch].date, text: '되돌림', position: 'belowBar', color: '#4dd0a7' } : null,
    firstFail >= 0 ? { date: after[firstFail].date, text: '종가 이탈', position: 'belowBar', color: '#2f7fe0' } : null,
  ].filter(Boolean);
  q.prompt = `${cs[b].date}에 종가가 직전 20봉 최고가를 넘었습니다. 그 뒤 오늘까지 가격은 어떻게 움직였나요?`;
  q.hint = '되돌림은 저가가 돌파 가격의 1% 안쪽까지 내려온 것으로 봅니다. 돌파 실패는 종가가 돌파 가격 아래로 끝난 것으로 봅니다. 저가로 내려온 것과 종가로 내려온 것을 구분하세요.';
  q.facts = [h.price('돌파 가격', L), h.price('돌파일 종가', cs[b].close), h.price('그 뒤 최저가', minLow), h.price('그 뒤 가장 낮은 종가', minClose), h.price('오늘 종가', today.close)];
  q.margin = Math.min(Math.abs(minLow - touchLine), Math.abs(minClose - L)) / L * 100;
  q.explanation = `돌파 가격은 ${h.n(L)}이고, 그 뒤 최저가는 ${h.n(minLow)}, 가장 낮은 종가는 ${h.n(minClose)}입니다. ${
    state === 'fail' ? '종가가 돌파 가격 아래로 끝난 날이 있어 이 연습에서는 돌파 실패로 봅니다.'
      : state === 'retest' ? '저가는 돌파 가격 근처까지 내려왔지만 종가는 그 위에서 끝났습니다. 되돌림이 나왔다는 것과 돌파가 실패했다는 것은 다른 사실입니다.'
        : '돌파 가격 근처까지 내려오지 않았습니다.'} 이후에 어떻게 될지는 이 문제의 답이 아닙니다.`;
  return q;
}
