import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openCourseCase, courseRecord } from '../src/lib/chart-course.js';
import { diagnose, overallStatus, parseNumber, checkNumeric, reviewSelf, SELF_CHECKS, CONFIDENCE } from '../src/lib/course-feedback.js';
import { expandStock } from '../src/lib/data-quality.js';

const read = (file) => JSON.parse(fs.readFileSync(new URL('../' + file, import.meta.url)));
const course = read('data/chart-course.json');
const cache = new Map();
const stockOf = (t) => cache.get(t) || cache.set(t, expandStock(read(`data/stocks/${t}.json`))).get(t);
const questionOf = (ref) => openCourseCase(stockOf(ref.ticker), ref).question;
const firstOf = (type) => course.cases.find((r) => r.type === type);

test('480사례: 정답은 틀린 관찰이 없고, 오답은 반드시 어느 관찰·조건이 틀렸는지 짚는다', () => {
  for (const ref of course.cases) {
    const q = questionOf(ref), tag = `${ref.type} ${ref.ticker} ${ref.date}`;
    if (q.conditions) {
      assert.equal(overallStatus(q.conditions), q.verdicts[q.answer], tag);
      assert.equal(q.verdicts.length, q.options.length, tag);
      for (let k = 0; k < q.options.length; k++) {
        const d = diagnose(q, k);
        assert.equal(d.correct, k === q.answer, tag);
        if (!d.correct) { assert.ok(d.message, tag); assert.ok(d.decisive.length, tag); }
      }
      continue;
    }
    assert.equal(q.claims.length, q.options.length, tag);
    for (const r of q.reads) {
      assert.ok(r.truth in r.values, `${tag} ${r.id}`);
      assert.ok(r.text && r.look, `${tag} ${r.id}`);
    }
    for (const claim of q.claims) for (const [id, v] of Object.entries(claim)) {
      const r = q.reads.find((x) => x.id === id);
      assert.ok(r && v in r.values, `${tag} ${id}=${v}`);
    }
    assert.equal(diagnose(q, q.answer).wrong.length, 0, tag);
    for (let k = 0; k < q.options.length; k++) if (k !== q.answer) assert.ok(diagnose(q, k).wrong.length > 0, `${tag} 오답 ${k}`);
  }
});

test('조건 판정: 이미 깨진 것은 불충족, 날짜가 안 지난 것은 대기로 따로 설명한다', () => {
  const conds = (...st) => st.map((status, i) => ({ id: 'c' + i, label: '', status, text: '', look: '' }));
  assert.equal(overallStatus(conds('pass', 'pass')), 'pass');
  assert.equal(overallStatus(conds('pass', 'pending')), 'pending');
  assert.equal(overallStatus(conds('pending', 'fail')), 'fail');
  const q = { answer: 1, verdicts: ['pass', 'fail', 'pending'], conditions: conds('pass', 'fail', 'pending'), options: ['a', 'b', 'c'] };
  assert.match(diagnose(q, 2).message, /기다릴 필요가 없습니다/);
  assert.deepEqual(diagnose(q, 2).decisive.map((c) => c.status), ['fail']);
  const pend = { ...q, answer: 2, conditions: conds('pass', 'pending') };
  assert.match(diagnose(pend, 0).message, /아직 날짜가 지나지 않은/);
  // 교재의 실제 사례에서도 세 상태가 모두 설명된다.
  for (const bucket of ['1:pass', '1:fail', '1:pending']) {
    const ref = course.cases.find((r) => r.type === 'cross-status' && r.bucket === bucket);
    assert.equal(overallStatus(questionOf(ref).conditions), bucket.split(':')[1]);
  }
});

test('수치 입력: 요구한 자릿수 한 칸까지 허용하고, 문턱을 넘나드는 반올림은 따로 알린다', () => {
  assert.equal(parseNumber(' 1.85 '), 1.85);
  assert.equal(parseNumber('2.00배'), 2);
  assert.equal(parseNumber('-0.5'), -0.5);
  for (const bad of ['', '1,85', 'abc', '1.2.3', '.5', '1e3', null]) assert.equal(parseNumber(bad), null, String(bad));
  const spec = { decimals: 2, value: 1.996, thresholds: [1, 2] };
  assert.equal(checkNumeric(spec, 'x'), null);
  assert.equal(checkNumeric(spec, '1.99').ok, true);
  assert.equal(checkNumeric(spec, '2.00').ok, true);          // 반올림한 표시값도 맞게 읽은 것
  assert.equal(checkNumeric(spec, '2.00').boundary, 2);       // 다만 2배 문턱의 다른 쪽이라고 알린다
  assert.equal(checkNumeric(spec, '1.99').boundary, null);
  assert.equal(checkNumeric(spec, '2.01').ok, false);         // 0.014 차이는 허용 밖
  assert.equal(checkNumeric({ decimals: 2, value: 1.5 }, '1.51').ok, true);
  assert.equal(checkNumeric({ decimals: 2, value: 1.5 }, '1.52').ok, false);
});

test('거래량 문제의 직접 계산 정답은 화면에 보이는 두 숫자로 만든 값이다', () => {
  for (const ref of course.cases.filter((r) => r.type === 'volume')) {
    const q = questionOf(ref), [vol, avg] = q.facts;
    assert.equal(q.numeric.unit, '배');
    assert.equal(q.numeric.decimals, 2);
    assert.ok(Math.abs(Number(vol[1].replace(/[^\d.]/g, '')) / Number(avg[1].replace(/[^\d.]/g, '')) - q.numeric.value) < 0.005, ref.date);
  }
});

test('기록: 자동 확인은 제출 시점에 저장되고, 자기 점검은 점수와 최초 답을 건드리지 않는다', () => {
  const vref = firstOf('volume'), vq = questionOf(vref);
  const wrong = (vq.answer + 1) % vq.options.length;
  assert.throws(() => courseRecord(null, wrong, vq, '', 1, {}), /숫자로 적으세요/);
  const value = vq.numeric.value.toFixed(2);
  const rec = courseRecord(null, wrong, vq, '', 1000, { numeric: value, confidence: 'sure' });
  assert.equal(rec.v, 2);
  assert.equal(rec.correct, false);
  assert.deepEqual(rec.auto.wrong, diagnose(vq, wrong).wrong.map((r) => r.id));
  assert.equal(rec.auto.numeric.ok, true);
  assert.equal(rec.confidence, 'sure');
  assert.equal(courseRecord(null, vq.answer, vq, '', 1, { numeric: value, confidence: '확실' }).confidence, null);
  // 다시 제출해도 처음 기록 그대로
  assert.equal(courseRecord(rec, vq.answer, vq, '바꾼 답', 2000, { numeric: '9' }), rec);

  const iq = questionOf(firstOf('limits'));
  const first = courseRecord(null, iq.answer, iq, '종가 1000원이 20일선 위', 3000);
  assert.equal(first.self, null);
  const checked = reviewSelf(first, iq.selfChecks, { number: true, counter: false, invented: true }, ' 다시 보니 반대 근거가 없었다 ', 4000);
  assert.deepEqual(Object.keys(checked.self.checks).sort(), [...iq.selfChecks].sort());
  assert.equal(checked.self.checks.number, true);
  assert.equal('invented' in checked.self.checks, false);
  assert.equal(checked.self.note, '다시 보니 반대 근거가 없었다');
  for (const k of ['submittedAt', 'choice', 'correct', 'reflection', 'auto', 'confidence']) assert.deepEqual(checked[k], first[k], k);
  assert.throws(() => reviewSelf(null, iq.selfChecks, {}, ''));
  assert.ok(iq.selfChecks.every((id) => SELF_CHECKS[id]));
  assert.equal(Object.keys(CONFIDENCE).length, 3);
});

test('자기 점검은 서술이 필요한 종합 문제에만 붙고, 객관식 기초 문제의 입력은 늘지 않는다', () => {
  for (const type of new Set(course.cases.map((r) => r.type))) {
    const q = questionOf(firstOf(type));
    assert.equal(!!q.selfChecks, !!q.reflection, type);
    if (q.numeric) assert.equal(type, 'volume');
  }
});

test('이전 형식(v1) 기록도 진단을 다시 계산해 보여줄 수 있고, 저장된 정답 여부는 그대로다', () => {
  const ref = firstOf('candle'), q = questionOf(ref);
  const legacy = { submittedAt: 1, choice: q.answer, correct: true, reflection: '' };
  assert.equal(diagnose(q, legacy.choice).wrong.length, 0);
  assert.equal(legacy.correct, true);
  assert.equal(courseRecord(legacy, 0, q, '', 2), legacy);
});
