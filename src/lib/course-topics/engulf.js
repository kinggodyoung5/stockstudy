/**
 * 7단계: 상승 장악형의 몸통 크기와 앞선 흐름 조건.
 * chart-course.js 의 makeCourseQuestion() 에서 옮겼다. 계산과 문구는 그대로다. i 뒤의 봉을 읽지 않는다.
 */
import { candleEvidence, CANDLE_PATTERNS } from '../candlestick.js';
import { trendBeforePattern } from '../pattern-context.js';
import { n, body } from './format.js';

/** engulf: 몸통 모양과 선행 추세 */
export function buildEngulf(ctx, i, q, tools) {
  const { candles: cs, c, m5, m20, m60 } = ctx, today = cs[i], prev = cs[i - 1];
  const { price, num, choose, read } = tools;
  q.viewBars = 40;
  if (!(prev.close < prev.open && today.close > today.open && today.close > prev.open && today.open < prev.close)) return null;
  const average = cs.slice(i - 21, i - 1).reduce((s, c) => s + body(c), 0) / 20;
  const trend = trendBeforePattern(cs, i - 1), evidence = candleEvidence('bullish-engulfing', cs, i);
  const sizeOk = body(today) >= average && body(prev) >= average * .3, trendOk = trend != null && trend <= -3;
  // 탐지기(candleEvidence)와 이 문제의 조건이 어긋나는 날은 내지 않는다.
  if (!!evidence !== (sizeOk && trendOk)) return null;
  const state = sizeOk ? (trendOk ? 'pass' : 'trend-fail') : (trendOk ? 'size-fail' : 'both-fail');
  choose(['모양·크기·앞선 흐름 조건 모두 충족', '몸통 크기 조건만 미달', '앞선 흐름 조건만 미달', '몸통 크기와 앞선 흐름 조건 모두 미달'],
    ['pass', 'size-fail', 'trend-fail', 'both-fail'].indexOf(state), state);
  const OK = { pass: '충족', fail: '미달' };
  read('size', '몸통 크기 조건 (뒤 몸통 ≥ 평균, 앞 몸통 ≥ 평균의 0.3배)', sizeOk ? 'pass' : 'fail', OK,
    `뒤 몸통 ${n(body(today))} (평균의 ${n(body(today) / average)}배) · 앞 몸통 ${n(body(prev))} (평균의 ${n(body(prev) / average)}배)`, '두 봉의 몸통과 앞쪽 봉들의 몸통');
  read('trend', '앞선 흐름 조건 (첫 봉 전일까지 10거래일 −3% 이하)', trendOk ? 'pass' : 'fail', OK,
    `${n(trend)}%`, '‘첫 봉’ 왼쪽 열 봉의 흐름');
  q.claims = [{ size: 'pass', trend: 'pass' }, { size: 'fail', trend: 'pass' }, { size: 'pass', trend: 'fail' }, { size: 'fail', trend: 'fail' }];
  q.margin = Math.min(Math.abs(trend + 3), Math.abs(body(today) / average - 1) * 100);
  q.prompt = '마지막 양봉이 전일 음봉 몸통을 감쌌습니다. 아래 조건 중 무엇을 충족했나요?';
  q.hint = '반전 후보를 찾는 것이므로 두 봉이 나오기 전의 흐름을 따로 봅니다. 패턴 이름부터 외우지 말고 각 조건을 비교하세요. 내일 결과를 보고 오늘 패턴을 판정하지 않습니다.';
  q.rules = CANDLE_PATTERNS['bullish-engulfing'].rules;
  q.facts = [price('앞 음봉 몸통', body(prev)), price('뒤 양봉 몸통', body(today)), price('패턴 전 20봉 평균 몸통', average), num('패턴 첫 봉 전일까지 10거래일 등락', trend, '%')];
  q.explanation = `앞선 흐름은 ${n(trend)}% (−3% 이하 요구), 뒤 몸통은 평균의 ${n(body(today) / average)}배 (1배 이상), 앞 몸통은 ${n(body(prev) / average)}배 (0.3배 이상)입니다. 감싸는 모양만으로 반전 조건을 충족하지는 않습니다. 내일 결과를 보고 오늘 패턴을 판정하지 않습니다.`;
  q.markers = [{ date: prev.date, text: '첫 봉' }, { date: today.date, text: '둘째 봉' }];
  q.conditions = [
    { id: 'shape', label: '뒤 양봉 몸통이 앞 음봉 몸통을 감쌌다', status: 'pass',
      text: `앞 음봉 ${n(prev.open)} → ${n(prev.close)} · 뒤 양봉 ${n(today.open)} → ${n(today.close)}`, look: '‘첫 봉’, ‘둘째 봉’ 표시' },
    { id: 'size', label: '뒤 양봉 몸통이 패턴 전 20봉 평균 몸통 이상', status: body(today) >= average ? 'pass' : 'fail',
      text: `${n(body(today))} · 평균 ${n(average)} (${n(body(today) / average)}배)`, look: '둘째 봉 몸통과 앞쪽 봉들의 몸통' },
    { id: 'prev-size', label: '앞 음봉 몸통이 평균의 0.3배 이상', status: body(prev) >= average * .3 ? 'pass' : 'fail',
      text: `${n(body(prev))} (${n(body(prev) / average)}배)`, look: '첫 봉 몸통' },
    { id: 'trend', label: '패턴 첫 봉 전일까지 10거래일 종가 변화가 −3% 이하', status: trend != null && trend <= -3 ? 'pass' : 'fail',
      text: `${n(trend)}%`, look: '‘첫 봉’ 왼쪽 열 봉의 흐름' },
  ];
  return q;
}
