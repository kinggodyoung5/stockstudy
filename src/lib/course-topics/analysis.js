/**
 * 8단계 종합 읽기: 엇갈리는 근거, 관찰·해석·무효 조건.
 * chart-course.js 의 makeCourseQuestion() 에서 옮겼다. 계산과 문구는 그대로다. i 뒤의 봉을 읽지 않는다.
 */
import { uniform } from '../hash.js';
import { n, sign } from './format.js';

/** integrated: 세 관찰을 빠뜨리지 않은 문장 */
export function buildIntegrated(ctx, i, q, tools) {
  const { candles: cs, c, m5, m20, m60 } = ctx, today = cs[i], prev = cs[i - 1];
  const { price, num, choose, read } = tools;
  const above = c[i] > m20[i], rising = m20[i] > m20[i - 5], positive = ctx.macd.hist[i] > 0;
  if (c[i] === m20[i] || m20[i] === m20[i - 5]) return null;
  q.overlays = { ma20: true, volume: true }; q.panels = ['macd'];
  q.facts = [price('종가', c[i]), price('20일 평균', m20[i]), price('5거래일 전 20일 평균', m20[i - 5]), price('MACD 막대', ctx.macd.hist[i])];
  const summary = `종가는 20일선 ${above ? '위' : '아래'}, 20일선은 5거래일 전보다 ${rising ? '높고' : '낮고'}, MACD선은 시그널선 ${positive ? '위' : '아래'}`;
  choose([summary,
    `종가는 20일선 ${above ? '아래' : '위'}, 20일선은 5거래일 전보다 ${rising ? '높고' : '낮고'}, MACD선은 시그널선 ${positive ? '위' : '아래'}`,
    `종가는 20일선 ${above ? '위' : '아래'}, 20일선은 5거래일 전보다 ${rising ? '낮고' : '높고'}, MACD선은 시그널선 ${positive ? '위' : '아래'}`,
    `종가는 20일선 ${above ? '위' : '아래'}, 20일선은 5거래일 전보다 ${rising ? '높고' : '낮고'}, MACD선은 시그널선 ${positive ? '아래' : '위'}`,
  ], 0, above === rising && rising === positive ? 'aligned' : 'mixed');
  const SIDE = { above: '위', below: '아래' }, flip = { above: 'below', below: 'above', up: 'down', down: 'up' };
  const truth = {
    loc: read('loc', '종가와 20일선', above ? 'above' : 'below', SIDE, `종가 ${n(c[i])} · 20일 평균 ${n(m20[i])}`, '마지막 봉과 초록선'),
    slope: read('slope', '20일선의 5거래일 변화', rising ? 'up' : 'down', { up: '높아졌다', down: '낮아졌다' },
      `${n(m20[i - 5])} → ${n(m20[i])}`, '초록선의 오른쪽 끝과 다섯 봉 앞 지점'),
    macd: read('macd', 'MACD선과 시그널선', positive ? 'above' : 'below', SIDE, `MACD 막대 ${n(ctx.macd.hist[i])}`, 'MACD 패널의 막대가 0 위인지 아래인지'),
  };
  q.claims = [truth, { ...truth, loc: flip[truth.loc] }, { ...truth, slope: flip[truth.slope] }, { ...truth, macd: flip[truth.macd] }];
  q.selfChecks = ['number', 'separate', 'counter', 'noforecast'];
  q.prompt = '세 가지 관찰을 빠뜨리지 않고 설명한 문장은?';
  q.margin = Math.min(Math.abs(c[i] - m20[i]) / m20[i], Math.abs(m20[i] - m20[i - 5]) / m20[i - 5], Math.abs(ctx.macd.hist[i]) / c[i]) * 100;
  q.hint = '한 지표가 다른 지표의 대답을 대신하지 않습니다. 엇갈리면 엇갈린 상태 그대로 적습니다.';
  q.explanation = summary + '입니다. 서로 다른 기간·관계를 요약한 값이므로 다수결로 다음 방향을 정하지 않습니다.';
  q.reflection = '내 해석을 약하게 만드는 관찰이 있다면 숫자와 함께 하나 쓰세요. 없으면 지금 자료로 모르는 점을 쓰세요.';
  return q;
}

/** limits: 사실·해석·무효 조건·단정 구분 */
export function buildLimits(ctx, i, q, tools) {
  const { candles: cs, c, m5, m20, m60 } = ctx, today = cs[i], prev = cs[i - 1];
  const { price, num, choose, read } = tools;
  const above = c[i] > m20[i], rising = m20[i] > m20[i - 5], positive = ctx.macd.hist[i] > 0;
  if (c[i] === m20[i] || m20[i] === m20[i - 5]) return null;
  q.overlays = { ma20: true, volume: true }; q.panels = ['macd'];
  q.facts = [price('종가', c[i]), price('20일 평균', m20[i]), price('5거래일 전 20일 평균', m20[i - 5]), price('MACD 막대', ctx.macd.hist[i])];
  const summary = `종가는 20일선 ${above ? '위' : '아래'}, 20일선은 5거래일 전보다 ${rising ? '높고' : '낮고'}, MACD선은 시그널선 ${positive ? '위' : '아래'}`;
  const level = Math.min(...cs.slice(i - 20, i).map((c) => c.low));
  if (c[i] === level) return null;
  const over = c[i] > level, L = n(level), C = n(c[i]);
  q.lines = [{ name: '직전 20봉 최저가', value: level, from: cs[i - 20].date }];
  q.facts.push(price('직전 20봉 최저가', level));
  // 같은 차트의 같은 두 값으로 네 종류의 문장을 만든다. 어느 종류를 낼지는 그날의 값으로만 정한다.
  const KINDS = ['fact', 'interp', 'invalidation', 'claim'];
  const kind = KINDS[Math.floor(uniform(`limits|${today.date}|${today.close}`) * KINDS.length)];
  const SENTENCE = over ? {
    fact: `오늘 종가 ${C}는 직전 20봉 최저가 ${L}보다 위에 있다`,
    interp: `종가가 ${L} 위에 있으니 이 가격대가 지지 역할을 하고 있다고 본다`,
    invalidation: `앞으로 종가가 ${L} 아래로 끝나면 이 가격대가 지켜진다는 생각을 다시 검토한다`,
    claim: `이 가격대 ${L}에서 반드시 반등한다`,
  } : {
    fact: `오늘 종가 ${C}는 직전 20봉 최저가 ${L}보다 아래에 있다`,
    interp: `종가가 ${L} 아래로 내려왔으니 이 가격대의 지지가 약해졌다고 본다`,
    invalidation: `앞으로 종가가 ${L} 위로 돌아와 끝나면 지지가 약해졌다는 생각을 다시 검토한다`,
    claim: `이 가격대 ${L}를 다시는 회복하지 못한다`,
  };
  const WHY = {
    fact: `오늘 종가 ${C}와 최저가 ${L}을 비교한 결과를 그대로 적은 문장입니다. 차트에서 바로 확인됩니다.`,
    interp: `확인한 위치에 “지지 역할”이라는 뜻을 붙인 문장입니다. 같은 위치를 다르게 읽을 수도 있습니다.`,
    invalidation: '“앞으로 …하면 다시 검토한다”는 미래에 점검할 기준입니다. 지금의 사실도, 해석 자체도 아닙니다.',
    claim: '“반드시”, “다시는”처럼 앞일을 확정하는 문장은 지금 차트로 확인할 수 없습니다. 해석과도 다릅니다.',
  };
  choose(['지금 차트에서 확인한 사실이다', '차트에 붙인 해석이다', '앞으로 확인할 무효 조건이다', '지금 자료로 확인할 수 없는 단정이다'], KINDS.indexOf(kind), kind);
  read('kind', '이 문장의 종류', kind, { fact: '확인한 사실', interp: '해석', invalidation: '무효 조건', claim: '확인할 수 없는 단정' },
    WHY[kind], '문장에 숫자 비교만 있는지, 뜻을 붙였는지, “앞으로”나 “반드시”가 있는지');
  q.claims = KINDS.map((k) => ({ kind: k }));
  q.selfChecks = ['number', 'separate', 'counter', 'invalidation', 'noforecast'];
  q.prompt = `“${SENTENCE[kind]}”는 어떤 종류의 문장인가요?`;
  q.hint = '사실은 차트에서 바로 확인되는 값과 비교, 해석은 그 값에 붙인 뜻, 무효 조건은 생각을 바꾸기로 미리 정한 기준입니다. 앞일을 확정하는 말은 어느 쪽도 아닙니다.';
  q.explanation = `${WHY[kind]} 오늘 종가 ${C}는 후보 가격 ${L}보다 ${sign(c[i] - level)}에 있습니다. 무효 조건은 손실이 제한된다는 보장이나 매매 지시가 아닙니다.`;
  q.reflection = '이 차트에서 관찰 1개 → 내 해석 → 반대 근거 또는 모르는 점 → 해석을 바꿀 조건을 짧게 써보세요.';
  return q;
}
