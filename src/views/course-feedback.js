/**
 * 제출 뒤 피드백 화면. 입문 과정과 새 구간 평가가 같이 쓴다.
 *
 * 위에서부터 자동 확인 → 해설 → 자기 점검 순서로 둔다.
 * 자동 확인은 정답이 하나로 정해지는 숫자·관계·조건만 다룬다.
 * 자기 점검은 학생이 직접 표시하며 점수로 바꾸지 않는다.
 * 학생이 쓴 글은 textContent 로만 넣는다(HTML 로 해석하지 않는다).
 */
import { el } from '../lib/ui.js';
import { diagnose, STATUS_LABEL, SELF_CHECKS, CONFIDENCE } from '../lib/course-feedback.js';

const STATUS_MARK = { pass: '✓', fail: '✕', pending: '…' };
const fmt = (v) => Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 4 });

function readItem(r, mode) {
  const head = mode === 'wrong'
    ? `고른 읽기 ‘${r.values[r.claimed]}’ · 실제 ‘${r.values[r.truth]}’`
    : r.values[r.truth];
  return el('li', null, [
    el('b', { text: r.label }), ' — ', head,
    el('div.small.muted', { text: `${r.text} · 볼 자리: ${r.look}` }),
  ]);
}

function numericBlock(spec, result) {
  if (!spec) return null;
  if (!result) return el('p.small.muted', { text: '이 기록에는 직접 계산한 값이 없습니다(이전 형식).' });
  const lines = [
    el('p', null, [
      el('b', { text: result.ok ? '직접 계산: 맞게 읽었습니다' : '직접 계산: 다시 계산해보세요' }),
      ` — 입력 ${fmt(result.input)}${spec.unit} · 실제 ${fmt(result.value)}${spec.unit} · 허용 ±${fmt(result.tolerance)}${spec.unit}`,
    ]),
  ];
  if (result.boundary != null) {
    lines.push(el('p.small.warn', { text: result.ok
      ? `입력한 값은 허용 범위 안이지만, 반올림 전 실제 값 ${fmt(result.value)}은 ${fmt(result.boundary)}${spec.unit}의 ${result.value >= result.boundary ? '이상' : '미만'}입니다. 문턱 판정은 반올림 전 값으로 합니다.`
      : `실제 값 ${fmt(result.value)}은 ${fmt(result.boundary)}${spec.unit} 문턱의 ${result.value >= result.boundary ? '이상' : '미만'}입니다.` }));
  }
  return el('div', null, lines);
}

function conditionTable(d) {
  const table = el('table.lesson-table.fb-conditions');
  table.append(el('thead', null, [el('tr', null, [el('th', { text: '조건' }), el('th', { text: '상태' }), el('th', { text: '실제 값 · 볼 자리' })])]));
  const tbody = el('tbody');
  for (const c of d.conditions) {
    tbody.append(el('tr', { class: c.status === d.truth && d.truth !== 'pass' ? 'on' : '' }, [
      el('td', { text: c.label }),
      el('td', { class: 'st-' + c.status, text: `${STATUS_MARK[c.status]} ${STATUS_LABEL[c.status]}` }),
      el('td', null, [c.text, el('div.small.muted', { text: c.look })]),
    ]));
  }
  table.append(tbody);
  return el('div.table-wrap', null, [table]);
}

/**
 * 자동 확인 영역.
 * 저장된 auto 가 있으면 그 판정을 그대로 쓴다(제출 시점 기준). 이전 형식 기록이면
 * 설명을 지금 계산해 보여주되, 저장된 정답 여부는 바꾸지 않는다고 밝힌다.
 */
export function autoCheck(q, record) {
  const d = diagnose(q, record.choice);
  const legacy = !record.auto;
  const box = el('section.fb-auto', null, [
    el('h4', { text: '자동 확인 · 숫자와 관계, 정해진 조건' }),
    el('p', null, [el('b', { text: record.correct ? '선택: 맞음' : '선택: 다시 볼 부분이 있음' }), ` — ‘${q.options[record.choice]}’`]),
    numericBlock(q.numeric, record.auto?.numeric || null),
  ]);
  if (d.kind === 'conditions') {
    if (!record.correct) box.append(el('p', { text: d.message || '' }));
    box.append(conditionTable(d));
  } else {
    if (d.wrong.length) box.append(el('p.fb-head', { text: '다시 볼 관찰' }), el('ul.fb-list.fb-wrong', null, d.wrong.map((r) => readItem(r, 'wrong'))));
    if (d.right.length) box.append(el('p.fb-head', { text: '맞게 읽은 관찰' }), el('ul.fb-list.fb-right', null, d.right.map((r) => readItem(r, 'right'))));
    if (d.context.length && !record.correct) box.append(el('p.fb-head', { text: '함께 볼 값' }), el('ul.fb-list', null, d.context.map((r) => readItem(r, 'right'))));
  }
  if (record.confidence) box.append(el('p.small.muted', { text: `제출할 때 고른 확신: ${CONFIDENCE[record.confidence]}` }));
  if (legacy) box.append(el('p.small.muted', { text: '이 기록은 이전 형식이라 관찰별 설명을 지금 다시 계산해 보여줍니다. 저장된 정답 여부는 바꾸지 않았습니다.' }));
  return box;
}

/**
 * 자기 점검 영역. 처음 쓴 근거는 읽기 전용으로 보여주고, 체크와 사후 메모는 따로 저장한다.
 * onSave(checks, note) 는 새 기록을 돌려주거나 예외를 던진다.
 */
export function selfCheck(q, record, onSave) {
  const ids = q.selfChecks || [];
  const status = el('p.small.muted', { 'aria-live': 'polite' });
  const boxes = ids.map((id) => {
    const input = el('input', { type: 'checkbox', id: 'self-' + id, checked: record.self?.checks?.[id] === true });
    return { id, input, row: el('label.fb-self-item', { for: 'self-' + id }, [input, el('span', { text: SELF_CHECKS[id] })]) };
  });
  const note = el('textarea', { id: 'self-note', rows: 3, maxlength: 1000, placeholder: '해설을 보고 바뀐 생각이 있으면 적으세요. 처음 쓴 근거는 그대로 남습니다.' });
  note.value = record.self?.note || '';
  const save = el('button.btn', { text: ids.length ? '자기 점검 저장' : '생각 저장' });
  save.addEventListener('click', () => {
    try {
      const saved = onSave(Object.fromEntries(boxes.map((b) => [b.id, b.input.checked])), note.value);
      status.textContent = saved?.self ? '저장했습니다. 처음 답과 근거는 바뀌지 않았고, 이 기록은 점수에 들어가지 않습니다.' : '';
    } catch (error) { status.textContent = error.message; }
  });
  if (!ids.length) {
    // 객관식만 있는 문제: 체크 항목 없이 해설 뒤의 생각만 따로 남긴다.
    note.setAttribute('aria-label', '해설을 본 뒤의 생각');
    return el('section.fb-self', null, [
      el('h4', { text: '해설을 본 뒤의 생각 (선택)' }),
      el('p.small.muted', { text: '헷갈렸던 점이나 다음에 볼 자리를 적어두면 복습할 때 보입니다. 처음 고른 답은 그대로 남습니다.' }),
      note, save, status,
    ]);
  }
  return el('section.fb-self', null, [
    el('h4', { text: '자기 점검 · 자동 채점하지 않습니다' }),
    el('p.small.muted', { text: '처음 쓴 근거를 해설의 숫자와 대조해 직접 표시하세요. 표시한 개수로 점수를 매기지 않습니다.' }),
    el('blockquote.fb-quote', { text: record.reflection || '(처음 쓴 근거 없음)' }),
    ...boxes.map((b) => b.row),
    el('label.practice-label', { for: 'self-note', text: '해설을 본 뒤의 생각 (선택)' }), note, save, status,
  ]);
}
