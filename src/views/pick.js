/**
 * 직접 짚기 (#/practice/pick). 보기를 고르지 않고 차트를 눌러 저점·고점이나 가격대를 짚는다.
 * 채점은 날짜와 가격만 비교한다(src/lib/pick.js). 앱 기준 하나와 비교한 결과라는 점을 화면에 밝힌다.
 * 키보드나 터치가 불편하면 봉 목록과 가격 입력으로 같은 답을 할 수 있다.
 */
import { loadChartCourse, loadStock } from '../lib/data.js';
import { createStockChart } from '../lib/chart.js';
import { PICK, PICK_KEY, PICK_TASKS, pickRefs, pickTask, gradePick, pickRecord, pickSummary, pickId } from '../lib/pick.js';
import { el, clear } from '../lib/ui.js';
import * as storage from '../lib/storage.js';

let generation = 0, cleanup = null;
function clearChart() { if (cleanup) { cleanup(); cleanup = null; } }
export function destroyPick() { generation++; clearChart(); }

const n = (v) => Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
const pad = (v) => String(v).padStart(2, '0');
/** lightweight-charts 가 돌려주는 시간은 'YYYY-MM-DD' 글자이거나 { year, month, day } 다. */
const dateOf = (t) => (typeof t === 'string' ? t : t && typeof t === 'object' ? `${t.year}-${pad(t.month)}-${pad(t.day)}` : null);
const FILTERS = { all: '모두', pivot: '저점·고점', zone: '가격대' };

function loadState() {
  const raw = storage.load(PICK_KEY, null);
  return raw && raw.v === 1 && raw.items && typeof raw.items === 'object' ? raw : { v: 1, items: {} };
}

export async function renderPick(app) {
  destroyPick();
  const token = generation;
  const course = await loadChartCourse();
  if (token !== generation || !app.isConnected) return;
  const all = pickRefs(course.cases);
  let state = loadState(), filter = 'all', cursor = 0, serial = 0;
  const refsOf = () => all.filter((r) => filter === 'all' || (filter === 'zone' ? r.task === 'zone' : r.task !== 'zone'));
  const area = el('section.panel.practice-card.pick');
  const summary = el('p.small.muted', { 'aria-live': 'polite' });
  const saveNote = el('p.small.muted', { 'aria-live': 'polite' });
  const nextButton = el('button.btn', { text: '다른 사례', onclick: () => { cursor = (cursor + 1) % refsOf().length; draw(); } });
  const filterBox = el('div.row', { role: 'group', 'aria-label': '문제 종류' }, Object.entries(FILTERS).map(([k, label]) =>
    el('button.btn', { type: 'button', text: label, 'aria-pressed': String(k === filter), onclick: (e) => {
      filter = k; cursor = 0;
      filterBox.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
      draw();
    } })));

  function persist() {
    if (storage.save(PICK_KEY, state)) return true;
    saveNote.textContent = '저장하지 못했습니다. 브라우저 저장이 막혀 있거나 공간이 부족할 수 있습니다.';
    saveNote.className = 'small warn';
    return false;
  }
  function renderSummary() {
    const s = pickSummary(state.items), parts = Object.entries(s).filter(([, v]) => v.n).map(([t, v]) => `${PICK_TASKS[t].title} ${v.n}개 중 ${v.ok}개`);
    summary.textContent = parts.length ? `처음 제출 기준, 앱 기준과 맞은 수: ${parts.join(' · ')}.` : '아직 짚어 본 사례가 없습니다.';
  }

  async function draw() {
    const drawToken = ++serial, refs = refsOf();
    clearChart(); nextButton.disabled = true;
    clear(area).append(el('p.loading', { text: '실제 차트를 준비하는 중…' }));
    try {
      const ref = refs[cursor % refs.length], stock = await loadStock(ref.ticker);
      if (token !== generation || drawToken !== serial || !app.isConnected) return;
      const history = stock.candles.slice(0, stock.candles.findIndex((c) => c.date === ref.date) + 1);
      const t = pickTask(history, ref.task);
      if (!t) throw new Error('이 사례로는 문제를 만들 수 없습니다. 다른 사례를 고르세요.');
      build(stock, ref, history, t);
    } catch (error) {
      if (token === generation && drawToken === serial && app.isConnected) clear(area).append(el('p.error', { text: error.message }));
    } finally {
      if (token === generation && drawToken === serial) nextButton.disabled = false;
    }
  }

  function build(stock, ref, history, t) {
    clearChart();
    const id = pickId(ref.task, ref), existing = state.items[id]?.first ? state.items[id] : null;
    const zone = t.task === 'zone', need = PICK_TASKS[t.task].need, low = t.task === 'low';
    const word = zone ? '가격대' : low ? '저점' : '고점', edge = low ? 'low' : 'high', eul = zone ? '를' : '을';
    let picks = [], submitted = false;

    const chartBox = el('div.chart-box', { 'aria-label': `관찰 마감일까지의 실제 일봉 차트. 차트를 눌러 ${word}${eul} 고릅니다.` });
    const chosen = el('div.pick-chosen', { 'aria-live': 'polite' });
    const feedback = el('div.practice-feedback', { 'aria-live': 'polite' });
    const submit = el('button.btn.primary', { type: 'button', text: '제출하고 앱 기준과 비교', disabled: true });

    clear(area).append(...[
      el('p.small.muted', { text: `${stock.name} (${stock.ticker}) · 일봉 · 관찰 마감 ${ref.date} · 최근 ${t.view.length}봉` }),
      el('h2', { text: PICK_TASKS[t.task].title }),
      el('p', { text: zone
        ? '차트에서 세 번 이상 방향이 바뀐 가격대를 하나 골라 그 높이를 누르세요.'
        : `차트에서 가장 최근에 확인된 ${word} 둘을 누르세요. 마지막 봉 근처에서 아직 확인되지 않은 자리는 고르지 않습니다.` }),
      el('details.rulebox', null, [el('summary', { text: '이 연습의 기준 (앱이 정한 하나의 기준)' }), el('ul', null, (zone ? [
        `확인된 고점·저점: 좌우 ${5}봉보다 높은 고가 또는 낮은 저가. 오른쪽 5봉이 끝난 것만 셉니다.`,
        `가격대 위아래 ${PICK.zonePct}% 안에 확인된 고점·저점이 ${PICK.minTouches}번 이상이면 정답 후보입니다. 정답이 여러 개일 수 있습니다.`,
        `누른 가격이 정답 가격대의 ±${PICK.zonePct}% 안이면 맞은 것으로 봅니다.`,
      ] : [
        `${word}: 좌우 ${PICK.pivotWidth}봉보다 ${low ? '낮은 저가' : '높은 고가'}인 봉. 오른쪽 ${PICK.pivotWidth}봉이 지나야 확인됩니다.`,
        `누른 봉이 앱의 ${word}에서 앞뒤 ${PICK.barTolerance}봉 안이면 맞은 것으로 봅니다.`,
        '다른 기간(예: 좌우 5봉)으로 보면 다른 봉도 ' + word + '이 될 수 있습니다. 결과는 “앱 기준과 같은가”입니다.',
      ]).map((x) => el('li', { text: x }))) ]),
      chartBox, chosen, keyboardInput(), el('div.row', null, [submit]), feedback,
      existing ? el('p.small.muted', { text: `처음 제출: ${existing.first.correct ? '앱 기준과 같음' : '앱 기준과 다른 곳이 있음'} · 시도 ${existing.tries}번. 다시 해도 처음 기록은 바뀌지 않습니다.` }) : null,
    ].filter(Boolean));

    const chart = createStockChart(chartBox, { height: chartBox.clientHeight || 380 });
    chart.setOverlays({}); chart.setCandles(t.view, history); chart.fit();
    cleanup = () => chart.destroy();

    const barIndex = (date) => t.view.findIndex((x) => x.date === date);
    function priceOfBar(date) { const c = t.view.find((x) => x.date === date); return c ? c[edge] : null; }
    function addPick(date, price, typed = false) {
      if (submitted || !date || !t.view.some((c) => c.date === date)) return;
      if (zone) picks = [{ date, price, typed }];
      else if (picks.some((p) => p.date === date)) return;
      else if (picks.length >= need) { chosen.querySelector('.pick-warn')?.remove(); chosen.append(el('p.small.warn.pick-warn', { text: `이미 ${need}개를 골랐습니다. 하나를 지운 뒤 다시 고르세요.` })); return; }
      else picks = [...picks, { date, price: priceOfBar(date) }];
      paint();
    }
    function removePick(k) { if (submitted) return; picks = picks.filter((_, j) => j !== k); paint(); }
    function paint(answer = null) {
      const mine = picks.map((p, k) => ({ date: p.date, text: zone ? '내가 고른 곳' : `내 ${k + 1}`, position: low ? 'belowBar' : 'aboveBar', color: '#f2b134', shape: low ? 'arrowUp' : 'arrowDown' }));
      const app = answer && !zone ? answer.map((d, k) => ({ date: d, text: `앱 ${low ? '저' : '고'}${k + 1}`, position: low ? 'belowBar' : 'aboveBar', color: '#4dd0a7', shape: low ? 'arrowUp' : 'arrowDown' })) : [];
      chart.setMarkers([...mine, ...app]);
      chart.setPriceLines('mine', zone && picks[0] ? [{ price: picks[0].price, title: '내가 고른 가격', color: '#f2b134', style: 0 }] : []);
      clear(chosen).append(picks.length
        ? el('ul.pick-list', null, picks.map((p, k) => el('li', null, [
          zone ? `가격 ${n(p.price)}${p.typed ? ' (직접 적음)' : ` (${p.date} 봉 높이에서 누름)`}` : `${k + 1}. ${p.date} · ${low ? '저가' : '고가'} ${n(p.price)}`, ' ',
          submitted ? null : el('button.btn.small', { type: 'button', text: '지우기', onclick: () => removePick(k) })])))
        : el('p.small.muted', { text: zone ? '아직 고르지 않았습니다. 차트의 그 높이를 누르세요.' : `아직 고르지 않았습니다. ${need}개를 고릅니다.` }));
      submit.disabled = submitted || picks.length !== need;
    }

    function keyboardInput() {
      if (zone) {
        const input = el('input', { type: 'number', inputmode: 'decimal', step: 'any', id: 'pick-price', 'aria-label': '가격' });
        const add = el('button.btn', { type: 'button', text: '이 가격으로 정하기', onclick: () => {
          const v = Number(input.value);
          if (Number.isFinite(v) && v > 0) addPick(t.view.at(-1).date, v, true);
        } });
        return el('details', null, [el('summary', { text: '차트를 누르기 어려우면: 가격을 직접 적기' }), el('div.row', null, [el('label', { for: 'pick-price', text: '가격' }), input, add])]);
      }
      const select = el('select', { id: 'pick-bar', 'aria-label': '봉 고르기' }, t.view.map((c) => el('option', { value: c.date, text: `${c.date} · ${low ? '저가' : '고가'} ${n(c[edge])}` })).reverse());
      const add = el('button.btn', { type: 'button', text: '이 봉 고르기', onclick: () => addPick(select.value) });
      return el('details', null, [el('summary', { text: '차트를 누르기 어려우면: 봉 목록에서 고르기' }), el('div.row', null, [el('label', { for: 'pick-bar', text: '봉' }), select, add])]);
    }

    chart.chart.subscribeClick((param) => {
      if (!param?.time || !param.point) return;
      const date = dateOf(param.time);
      addPick(date, zone ? chart.candleSeries.coordinateToPrice(param.point.y) : null);
    });

    submit.addEventListener('click', () => {
      if (submitted || picks.length !== need) return;
      submitted = true;
      const result = gradePick(t, picks);
      state = { ...state, items: { ...state.items, [id]: pickRecord(state.items[id], picks, result) } };
      persist(); renderSummary();
      paint(zone ? null : t.answers);
      if (zone) chart.setPriceLines('app', t.levels.map((l) => ({ price: l.price, title: `앱 가격대 (${l.touches.length}번)`, color: '#4dd0a7' })));
      clear(feedback).append(...[
        el('p', null, [el('b', { text: result.correct ? '앱 기준과 같습니다.' : '앱 기준과 다른 곳이 있습니다.' })]),
        el('ul', null, result.items.map((it) => el('li', { text: message(it) }))),
        result.missed?.length ? el('p.small', { text: `고르지 않은 앱의 ${word}: ${result.missed.map((d) => `${d} (${low ? '저가' : '고가'} ${n(priceOfBar(d))})`).join(', ')}` }) : null,
        zone ? el('p.small', { text: `앱의 가격대: ${t.levels.map((l) => `${n(l.price)} (반응 ${l.touches.length}번: ${l.touches.join(', ')})`).join(' · ')}` }) : null,
        el('p.small.muted', { text: '앱이 정한 기준 하나와 비교한 결과입니다. 다른 기간으로 보면 다른 자리도 근거가 될 수 있습니다. 어느 쪽이든, 그 자리를 고른 이유를 날짜와 가격으로 말할 수 있는지가 중요합니다.' }),
        el('div.row', null, [el('button.btn', { type: 'button', text: '같은 차트 다시 해보기', onclick: () => build(stock, ref, history, t) }),
          el('button.btn', { type: 'button', text: '다른 사례', onclick: () => nextButton.click() })]),
      ].filter(Boolean));
    });

    function message(it) {
      if (zone) return it.verdict === 'match'
        ? `맞습니다. 고른 가격 ${n(it.price)} · 앱의 가격대 ${n(it.target)} · 차이 ${n(it.distancePct)}% (±${PICK.zonePct}% 안).`
        : `고른 가격 ${n(it.price)} · 가장 가까운 앱의 가격대 ${n(it.target)} · 차이 ${n(it.distancePct)}%. 그 가격대 위아래 ${PICK.zonePct}% 안에서 방향이 바뀐 봉을 세어 보세요.`;
      const head = `${it.date} (${low ? '저가' : '고가'} ${n(it.price)}): `;
      if (it.verdict === 'match') return head + (it.target === it.date ? `앱의 ${word}과 같은 봉입니다.` : `앱의 ${word} ${it.target}과 1봉 차이로, 맞은 것으로 봅니다.`);
      if (it.verdict === 'unconfirmed') return head + `오른쪽 ${PICK.pivotWidth}봉이 아직 지나지 않아 확인된 ${word}이 아닙니다. 이 차트에서는 ${t.confirmedThrough}까지의 봉만 확인될 수 있습니다.`;
      if (it.verdict === 'older') return head + `확인된 ${word}이지만 가장 최근 둘이 아닙니다. 그 뒤에 확인된 ${word}이 있습니다.`;
      return head + `앱 기준(좌우 ${PICK.pivotWidth}봉보다 ${low ? '낮은 저가' : '높은 고가'})으로는 ${word}이 아닙니다.${it.target ? ` 가장 가까운 앱의 ${word}은 ${it.target}이고, ${Math.abs(barIndex(it.target) - barIndex(it.date))}봉 떨어져 있습니다.` : ''}`;
    }
    paint();
  }

  clear(app).append(
    el('h1.page-title', { text: '직접 짚기' }),
    el('p.page-sub', { text: '보기를 고르지 않고 차트를 눌러 답합니다. 저점·고점과 가격대를 내 눈으로 찾은 뒤, 앱이 정한 기준과 비교합니다. 이 연습의 차트는 입문 과정의 ‘확인된 고점·저점 비교’와 ‘가격대의 반응 횟수’ 사례에서 표시를 지운 것입니다.' }),
    el('div.row', { style: { marginBottom: '12px' } }, [filterBox, nextButton, el('a.btn', { href: '#/practice/chart', text: '실제 차트 8단계로' })]),
    summary, area, saveNote);
  renderSummary();
  draw();
}
