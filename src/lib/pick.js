/**
 * 직접 짚기 (#/practice/pick, 로드맵 D9). 보기를 고르지 않고 차트를 눌러 답한다.
 *
 *   low / high: 가장 최근에 확인된 저점(고점) 둘을 누른다.
 *     극점은 입문 '확인된 고점·저점 비교'와 같다: 최근 80봉에서 좌우 3봉보다 낮은 저가(높은 고가).
 *     오른쪽 3봉이 아직 지나지 않은 봉은 확인되지 않았다. 누른 봉이 앱의 극점에서 앞뒤 1봉 안이면 맞다.
 *   zone: 세 번 이상 반응한 가격대를 누른다.
 *     가격대는 입문 '가격대의 반응 횟수와 위치'와 같다: 최근 120봉의 지지·저항 후보 가운데
 *     위아래 1.5% 안에 확인된 고점·저점(좌우 5봉)이 세 번 이상인 것. 누른 가격이 그 가격대의 ±1.5% 안이면 맞다.
 *
 * 정답은 관찰 마감일까지의 봉으로만 계산한다. 앱 기준 하나와 비교한 결과이며, 다른 기준의 극점·가격대가 틀렸다는 뜻은 아니다.
 * 채점은 날짜와 가격만 비교한다. 글은 받지 않는다.
 */
import { pivots, supportResistance } from './indicators.js';
import { SR_LEVEL, zoneTouches } from './course-topics/sr-level.js';
import { uniform } from './hash.js';

export const PICK_KEY = 'pick:v1';
export const PICK = { pivotBars: 80, pivotWidth: 3, barTolerance: 1, zoneBars: SR_LEVEL.bars, zonePct: SR_LEVEL.zonePct, minTouches: 3 };
export const PICK_TASKS = {
  low: { title: '확인된 최근 저점 둘', need: 2 },
  high: { title: '확인된 최근 고점 둘', need: 2 },
  zone: { title: '세 번 이상 반응한 가격대', need: 1 },
};
export const pickId = (task, ref) => `${task}|${ref.ticker}|${ref.date}`;

/**
 * 입문 사례에서 짚기 사례를 고른다. 추세 사례는 저점·고점 문제로, 가격대 사례 가운데 세 번 이상인 상태는 가격대 문제로 쓴다.
 * 저점과 고점 중 어느 쪽을 묻는지는 사례마다 고정된 값으로 정한다. 순서도 고정이다.
 */
export function pickRefs(courseCases) {
  const out = [];
  for (const r of courseCases) {
    if (r.type === 'trend') out.push({ task: uniform(`pick|${r.ticker}|${r.date}`) < 0.5 ? 'low' : 'high', ticker: r.ticker, date: r.date });
    else if (r.type === 'sr-level' && (r.bucket === '2' || r.bucket === '3')) out.push({ task: 'zone', ticker: r.ticker, date: r.date });
  }
  return out.sort((a, b) => uniform(`pick-order|${pickId(a.task, a)}`) - uniform(`pick-order|${pickId(b.task, b)}`));
}

/**
 * history: 관찰 마감일까지의 봉(마지막 봉 = 마감일). 문제와 정답을 만든다. 쓸 수 없으면 null.
 * 반환: { task, view, answers, others, confirmedThrough, levels }
 */
export function pickTask(history, task) {
  if (task === 'zone') {
    const view = history.slice(-PICK.zoneBars);
    if (view.length < PICK.zoneBars) return null;
    const start = history.length - view.length, end = history.length - 1;
    const levels = supportResistance(view, { window: SR_LEVEL.pivotWidth, tolerancePct: SR_LEVEL.zonePct, minTouches: 2, maxLevels: 99 })
      .map((l) => ({ price: l.price, touches: zoneTouches(history, start, end, l.price).map((k) => history[k].date) }))
      .filter((l) => l.touches.length >= PICK.minTouches);
    return levels.length ? { task, view, levels } : null;
  }
  const view = history.slice(-PICK.pivotBars);
  if (view.length < PICK.pivotBars) return null;
  const p = pivots(view, PICK.pivotWidth), list = (task === 'low' ? p.lows : p.highs);
  if (list.length < 2) return null;
  return { task, view, answers: list.slice(-2).map((j) => view[j].date), others: list.slice(0, -2).map((j) => view[j].date),
    // 오른쪽 3봉이 지나야 극점으로 확인된다. 이 날 뒤의 봉은 아직 확인될 수 없다.
    confirmedThrough: view[view.length - 1 - PICK.pivotWidth].date };
}

const near = (a, b) => Math.abs(a - b) <= PICK.barTolerance;

/**
 * picks: [{ date, price }] — 누른 봉의 날짜와 가격. 저점·고점 문제는 날짜만, 가격대 문제는 가격만 본다.
 * 반환: { correct, items: [{ date, price, verdict, target }], missed }
 *   verdict: match(앱의 답과 맞음) · unconfirmed(오른쪽 3봉이 안 지남) · older(더 앞의 확인된 극점) · other(앱 기준 극점이 아님)
 *            zone 에서는 match · other. target 은 맞춘 정답(날짜 또는 가격대) 또는 가장 가까운 정답.
 */
export function gradePick(t, picks) {
  const items = [];
  if (t.task === 'zone') {
    for (const pk of picks) {
      const best = t.levels.map((l) => ({ l, d: Math.abs(pk.price - l.price) / l.price * 100 })).sort((a, b) => a.d - b.d)[0];
      items.push({ date: pk.date, price: pk.price, verdict: best.d <= PICK.zonePct ? 'match' : 'other', target: best.l.price, distancePct: best.d });
    }
    return { correct: picks.length === 1 && items[0].verdict === 'match', items, missed: [] };
  }
  const index = new Map(t.view.map((c, k) => [c.date, k])), at = (d) => index.get(d);
  const open = [...t.answers];
  for (const pk of picks) {
    const k = at(pk.date);
    if (k == null) { items.push({ ...pk, verdict: 'other', target: null }); continue; }
    const hit = open.find((d) => near(at(d), k));
    if (hit) { open.splice(open.indexOf(hit), 1); items.push({ ...pk, verdict: 'match', target: hit }); continue; }
    if (pk.date > t.confirmedThrough) { items.push({ ...pk, verdict: 'unconfirmed', target: null }); continue; }
    const older = t.others.find((d) => near(at(d), k));
    if (older) { items.push({ ...pk, verdict: 'older', target: older }); continue; }
    const closest = [...t.answers, ...t.others].sort((a, b) => Math.abs(at(a) - k) - Math.abs(at(b) - k))[0];
    items.push({ ...pk, verdict: 'other', target: closest });
  }
  return { correct: picks.length === 2 && open.length === 0, items, missed: open };
}

/**
 * 기록. 처음 제출(first)은 바꾸지 않는다. 다시 해본 결과는 tries 와 last 에만 남긴다.
 * { v, first: { at, picks, correct }, last: { at, correct }, tries }
 */
export function pickRecord(previous, picks, result, now = Date.now()) {
  const clean = picks.map((p) => ({ date: p.date, price: Math.round(p.price * 10000) / 10000 }));
  if (previous?.first) return { ...previous, last: { at: now, correct: result.correct }, tries: (previous.tries || 1) + 1 };
  return { v: 1, first: { at: now, picks: clean, correct: result.correct }, last: { at: now, correct: result.correct }, tries: 1 };
}

/** 문제 종류별 처음 제출 수와 맞은 수 */
export function pickSummary(items = {}) {
  const out = Object.fromEntries(Object.keys(PICK_TASKS).map((t) => [t, { n: 0, ok: 0 }]));
  for (const [id, r] of Object.entries(items)) {
    const t = id.split('|')[0];
    if (!out[t] || !r?.first) continue;
    out[t].n++; if (r.first.correct) out[t].ok++;
  }
  return out;
}
