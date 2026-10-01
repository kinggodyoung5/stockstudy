/**
 * 입문 문제의 피드백 — "틀림" 대신 어느 관찰을 다시 봐야 하는지 알려준다.
 *
 * 두 가지를 엄격히 나눈다.
 *   자동 확인: 숫자·위치 관계·명시된 조건. 정답이 하나로 정해진다.
 *   자기 점검: 서술한 근거의 타당성. 학생이 해설을 보고 직접 표시한다.
 * 자기 점검은 점수로 바꾸지 않고, 자동 확인 결과와 섞어 저장하지 않는다.
 * 글자 수·단어 포함 여부로 글의 질을 판정하지 않는다.
 *
 * 문제(chart-course.js)는 두 형태 중 하나로 근거를 들고 온다.
 *   reads + claims: 학생이 읽을 관찰(truth)과 선택지마다 그 관찰을 어떻게 주장하는지.
 *   conditions + verdicts: 조건별 충족·불충족·대기와, 선택지마다 주장하는 종합 판정.
 */

export const STATUS_LABEL = { pass: '충족', fail: '불충족', pending: '확인 대기' };

export const CONFIDENCE = { sure: '확실하다', half: '반반이다', unsure: '모르겠다' };

export const SELF_CHECKS = {
  number: '근거에 차트의 숫자·날짜·선 이름을 하나 이상 적었다',
  separate: '본 것(관찰)과 그 뜻(해석)을 나눠 적었다',
  counter: '반대 근거나 아직 모르는 점을 적었다',
  invalidation: '해석을 바꿀 조건을 가격·종가·지표로 적었다',
  noforecast: '“오른다·내린다”를 확정된 사실처럼 쓰지 않았다',
};

/** 조건 목록의 종합 판정. 하나라도 깨졌으면 불충족, 아니면 대기가 남았는지 본다. */
export function overallStatus(conditions) {
  if (conditions.some((c) => c.status === 'fail')) return 'fail';
  if (conditions.some((c) => c.status === 'pending')) return 'pending';
  return 'pass';
}

const VERDICT_TEXT = {
  'pass>fail': '이미 깨진 조건이 있습니다. 모양이 보여도 이 앱의 조건에는 맞지 않습니다.',
  'pass>pending': '깨진 조건은 없지만 아직 날짜가 지나지 않은 조건이 있습니다. 지금 충족으로 세면 나중에 실패할 수 있는 신호를 미리 센 셈입니다.',
  'fail>pass': '모든 조건이 확인됐습니다. 조건을 하나씩 다시 대조해보세요.',
  'fail>pending': '깨진 조건은 없습니다. 아직 기다려야 하는 조건이 있을 뿐입니다.',
  'pending>fail': '기다릴 필요가 없습니다. 이미 깨진 조건이 있어 앞으로 무슨 일이 생겨도 충족이 될 수 없습니다.',
  'pending>pass': '확인 기간이 이미 지났습니다. 기다리던 조건도 충족됐습니다.',
};

/**
 * 선택 하나를 진단한다. 저장할 때와 화면에 그릴 때 같은 함수를 쓴다.
 * @returns reads 형: { correct, kind, right, wrong, context }
 *          conditions 형: { correct, kind, claimed, truth, decisive, conditions, message }
 */
export function diagnose(q, choice) {
  const correct = choice === q.answer;
  if (q.conditions) {
    const truth = overallStatus(q.conditions), claimed = q.verdicts[choice];
    const decisive = truth === 'pass' ? q.conditions : q.conditions.filter((c) => c.status === truth);
    const message = correct ? null : q.trap?.[choice] || VERDICT_TEXT[`${claimed}>${truth}`] || null;
    return { correct, kind: 'conditions', claimed, truth, decisive, conditions: q.conditions, message };
  }
  const claim = q.claims[choice] || {};
  const right = [], wrong = [], context = [];
  for (const r of q.reads) {
    if (!(r.id in claim)) context.push(r);
    else if (claim[r.id] === r.truth) right.push(r);
    else wrong.push({ ...r, claimed: claim[r.id] });
  }
  return { correct, kind: 'reads', right, wrong, context };
}

/** 단위 글자와 앞뒤 공백만 허용한다. 쉼표는 소수점 혼동이 있어 받지 않는다. */
export function parseNumber(raw) {
  const s = String(raw ?? '').trim().replace(/\s+/g, '').replace(/(배|%)$/, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

/**
 * 수치 입력 채점. 허용 오차는 요구한 자릿수 한 칸(소수 둘째 자리면 0.01)이다.
 * 반올림한 값이 문턱의 다른 쪽에 놓이는 경우는 boundary 로 따로 알려준다.
 * 수치를 맞게 읽었다는 판정과, 문턱 조건의 판정(반올림 전 값 기준)은 별개다.
 */
export function checkNumeric(spec, raw) {
  const input = parseNumber(raw);
  if (input == null) return null;
  const tolerance = 10 ** -spec.decimals;
  const ok = Math.abs(input - spec.value) <= tolerance + 1e-9;
  const boundary = (spec.thresholds || []).find((t) => (input >= t) !== (spec.value >= t)) ?? null;
  return { input, value: spec.value, tolerance, ok, boundary };
}

/** 해설을 본 뒤 남기는 자기 점검. 최초 답·최초 근거·자동 확인 결과는 건드리지 않는다. */
export function reviewSelf(record, ids, checks, note, now = Date.now()) {
  if (!record?.submittedAt) throw new Error('먼저 답을 제출해야 자기 점검을 남길 수 있습니다.');
  const picked = Object.fromEntries(ids.filter((id) => SELF_CHECKS[id]).map((id) => [id, checks?.[id] === true]));
  return { ...record, self: { at: now, checks: picked, note: String(note || '').trim().slice(0, 1000) } };
}
