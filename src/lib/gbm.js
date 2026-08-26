/**
 * 가상 차트 생성기 (설명서 5.3)
 * 기하 브라운 운동(GBM)으로 종가 경로를 만들고, 하루 안의 흔들림을 더해 캔들로 바꾼다.
 *
 *   S(t+1) = S(t) × exp( (μ − σ²/2)·dt + σ·√dt·Z )
 *
 * μ(drift, 연 수익률)와 σ(volatility, 연 변동성)를 조절해 추세 강도와 변동성을 바꾼다.
 */

/** 시드 기반 난수 (같은 시드면 같은 차트 — "이 차트 다시 보기"가 가능해진다) */
export function makeRandom(seed = Date.now()) {
  let s = seed >>> 0;
  return function random() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 표준정규분포 난수 (Box-Muller) */
function gaussian(random) {
  let u = 0;
  let v = 0;
  while (u === 0) u = random();
  while (v === 0) v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * @param {object} opt
 * @param {number} opt.days        캔들 개수
 * @param {number} opt.volatility  연 변동성 (0.1 = 10%)
 * @param {number} opt.drift       연 기대수익률 (0.1 = 10%)
 * @param {number} opt.start       시작가
 * @param {number} opt.seed        난수 시드
 * @returns {{candles: Array, seed: number}}
 */
export function generateCandles(opt = {}) {
  const p = { days: 250, volatility: 0.3, drift: 0.05, start: 10000, seed: Date.now(), ...opt };
  const random = makeRandom(p.seed);
  const dt = 1 / 252; // 1거래일
  const drift = (p.drift - (p.volatility * p.volatility) / 2) * dt;
  const diffusion = p.volatility * Math.sqrt(dt);

  const candles = [];
  let prevClose = p.start;

  // 실제 데이터와 형식을 맞추기 위해 날짜를 붙인다 (주말 건너뜀)
  const day = new Date(Date.UTC(2020, 0, 1));
  const nextBusinessDay = () => {
    do {
      day.setUTCDate(day.getUTCDate() + 1);
    } while (day.getUTCDay() === 0 || day.getUTCDay() === 6);
    return day.toISOString().slice(0, 10);
  };

  for (let i = 0; i < p.days; i++) {
    const close = prevClose * Math.exp(drift + diffusion * gaussian(random));
    const open = prevClose * (1 + (random() - 0.5) * diffusion * 0.6);
    // 고가/저가는 시가·종가 바깥으로 하루 변동성만큼 더 벌어지게
    const wick = Math.abs(close - open) + prevClose * diffusion * random() * 0.8;
    const high = Math.max(open, close) + wick * random();
    const low = Math.min(open, close) - wick * random();

    // 큰 변동일수록 거래량이 많아지는 경향을 흉내
    const move = Math.abs(close - prevClose) / prevClose;
    const volume = Math.round(1_000_000 * (0.5 + random()) * (1 + move * 25));

    candles.push({
      date: nextBusinessDay(),
      open: round(open),
      high: round(high),
      low: round(low),
      close: round(close),
      volume,
    });
    prevClose = close;
  }

  return { candles, seed: p.seed };
}

const round = (v) => Math.round(v * 100) / 100;
