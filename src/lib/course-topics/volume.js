/**
 * 4단계 거래량과 변동 폭: 거래량 비교, 급증 조건, ATR, 볼린저밴드.
 * chart-course.js 의 makeCourseQuestion() 에서 옮겼다. 계산과 문구는 그대로다. i 뒤의 봉을 읽지 않는다.
 */
import { PATTERNS } from '../patterns.js';
import { n } from './format.js';

/** volume: 오늘 거래량 ÷ 직전 20봉 평균 */
export function buildVolume(ctx, i, q, tools) {
  const { candles: cs, c, m5, m20, m60 } = ctx, today = cs[i], prev = cs[i - 1];
  const { price, num, choose, read } = tools;
  const v = ctx.volume[i]; if (v.ratio == null) return null;
  q.overlays = { volume: true };
  q.facts = [num('오늘 거래량', today.volume, '주'), num('직전 20봉 평균 (오늘 제외)', v.avg, '주'), num('종가의 전일 대비 등락', v.change, '%')];
  choose(['평균 미만', '평균 이상 2배 미만', '평균의 2배 이상'], v.ratio < 1 ? 0 : v.ratio < 2 ? 1 : 2);
  read('band', '오늘 거래량 ÷ 직전 20봉 평균', v.ratio < 1 ? 'under' : v.ratio < 2 ? 'mid' : 'over',
    { under: '평균 미만', mid: '평균 이상 2배 미만', over: '평균의 2배 이상' },
    `${n(today.volume)} ÷ ${n(v.avg)} = ${n(v.ratio)}배`, '마지막 거래량 막대와 앞 20개 막대의 평균 높이');
  q.claims = [{ band: 'under' }, { band: 'mid' }, { band: 'over' }];
  // 직접 나눠보는 연습. 판정 문턱(1배·2배)은 반올림 전 값으로 정한다.
  q.numeric = { label: '오늘 거래량 ÷ 직전 20봉 평균', unit: '배', decimals: 2, value: v.ratio, thresholds: [1, 2] };
  q.prompt = '마지막 거래량을 직전 20봉 평균과 비교하면?';
  q.margin = Math.min(Math.abs(v.ratio - 1), Math.abs(v.ratio - 2));
  q.hint = '오늘 거래량 ÷ 직전 20봉 평균. 거래량은 거래된 주식 수이며 매수자 수나 순매수액이 아닙니다.';
  q.explanation = `${n(today.volume)} ÷ ${n(v.avg)} = ${n(v.ratio)}배입니다. 모든 체결에는 매수와 매도가 함께 있습니다. 거래량 증가만으로 누가 샀는지, 내일 오를지 알 수 없습니다.`;
  return q;
}

/** volume-rule: 거래량 급증 조건의 경계 사례 */
export function buildVolumeRule(ctx, i, q, tools) {
  const { candles: cs, c, m5, m20, m60 } = ctx, today = cs[i], prev = cs[i - 1];
  const { price, num, choose, read } = tools;
  const v = ctx.volume[i]; if (v.ratio == null) return null;
  q.overlays = { volume: true };
  q.facts = [num('오늘 거래량', today.volume, '주'), num('직전 20봉 평균 (오늘 제외)', v.avg, '주'), num('종가의 전일 대비 등락', v.change, '%')];
  // 조건 하나만 어긋난 날과 모두 충족한 날만 낸다. 둘 이상 어긋나면 어느 것을 답으로 할지 정할 수 없다.
  const okRatio = v.ratio >= 2, okChange = Math.abs(v.change) >= 2, okSpaced = v.spaced;
  const misses = [!okRatio, !okChange, !okSpaced].filter(Boolean).length;
  if (misses > 1 || (!okRatio && v.ratio < 1.7)) return null;
  const failed = !okRatio ? 'ratio' : !okChange ? 'change' : !okSpaced ? 'spaced' : 'none';
  const bucket = { none: 'pass', ratio: 'near', change: 'price-fail', spaced: 'repeat' }[failed];
  choose(['모든 조건 충족', '거래량이 2배에 못 미쳐 불충족', '종가 변화가 ±2%에 못 미쳐 불충족', '직전 10거래일에 같은 조건의 날이 있어 불충족'],
    ['none', 'ratio', 'change', 'spaced'].indexOf(failed), bucket);
  read('failed', '충족하지 못한 조건', failed,
    { none: '없음 (모두 충족)', ratio: '거래량 2배', change: '종가 변화 ±2%', spaced: '직전 10거래일 중복' },
    `거래량 ${n(v.ratio)}배 · 종가 변화 ${n(v.change)}% · 직전 10거래일 ${v.spaced ? '그런 날 없음' : '그런 날 있음'}`, '아래 조건표의 세 줄');
  q.claims = [{ failed: 'none' }, { failed: 'ratio' }, { failed: 'change' }, { failed: 'spaced' }];
  q.prompt = '거래량이 눈에 띄는 이 날, 아래 급증 조건 중 무엇에서 걸렸나요?';
  q.hint = '2배에 가까운 것과 2배 이상은 다릅니다. 거래량뿐 아니라 가격 변화와 중복 조건도 확인합니다. 세 조건은 모두 오늘까지의 거래량과 종가로 계산됩니다.';
  q.rules = PATTERNS['volume-spike'].rules;
  q.facts.push(num('평균 대비 거래량', v.ratio, '배'), ['직전 10거래일에 두 수치 조건을 만족한 날', v.spaced ? '없음' : '있음']);
  q.conditions = [
    { id: 'ratio', label: '거래량이 직전 20봉 평균의 2배 이상', status: v.ratio >= 2 ? 'pass' : 'fail',
      text: `${n(today.volume)} ÷ ${n(v.avg)} = ${n(v.ratio)}배`, look: '마지막 거래량 막대' },
    { id: 'change', label: '종가의 전일 대비 등락이 ±2% 이상', status: Math.abs(v.change) >= 2 ? 'pass' : 'fail',
      text: `${n(v.change)}%`, look: '마지막 봉 종가와 앞 봉 종가' },
    { id: 'spaced', label: '직전 10거래일에 두 수치 조건을 만족한 날이 없다', status: v.spaced ? 'pass' : 'fail',
      text: v.spaced ? '그런 날 없음' : '그런 날 있음', look: '앞 10봉의 거래량 막대' },
  ];
  q.explanation = `거래량 ${n(v.ratio)}배, 종가 변화 ${n(v.change)}%이며 직전 반복 조건은 ${v.spaced ? '통과' : '불통과'}입니다. 세 조건을 모두 만족해야 합니다. “거의 2배”를 반올림해 통과시키지 않습니다. 이는 앱의 사례 선택 기준이지 보편적인 매수·매도 규칙이 아닙니다.`;
  return q;
}

/** atr: ATR%의 변화와 오늘 변동 폭 */
export function buildAtr(ctx, i, q, tools) {
  const { candles: cs, c, m5, m20, m60 } = ctx, today = cs[i], prev = cs[i - 1];
  const { price, num, choose, read } = tools;
  const current = ctx.atr[i] / c[i] * 100, before = ctx.atr[i - 20] / c[i - 20] * 100;
  const tr = ctx.tr[i], a = ctx.atr[i];
  if (Math.abs(current - before) < .001 || tr == null || tr === a) return null;
  const grew = current > before, wide = tr > a;
  choose(['ATR%는 커졌고, 오늘 하루 변동 폭은 ATR보다 크다', 'ATR%는 커졌고, 오늘 하루 변동 폭은 ATR보다 작다',
    'ATR%는 작아졌고, 오늘 하루 변동 폭은 ATR보다 크다', 'ATR%는 작아졌고, 오늘 하루 변동 폭은 ATR보다 작다'],
  grew ? (wide ? 0 : 1) : (wide ? 2 : 3));
  read('change', '20거래일 전과 지금의 ATR%', grew ? 'up' : 'down', { up: '커졌다', down: '작아졌다' },
    `${n(before)}% → ${n(current)}%`, '아래 ATR 패널 선의 높이 변화');
  read('today', '오늘 하루 변동 폭(TR)과 ATR', wide ? 'wide' : 'narrow', { wide: 'ATR보다 크다', narrow: 'ATR보다 작다' },
    `오늘 변동 폭 ${n(tr)} · ATR ${n(a)}`, '마지막 봉의 길이(전일 종가와의 벌어짐 포함)와 ATR 값');
  read('meaning', 'ATR%가 담고 있는 정보', 'size', { size: '최근 흔들림의 크기', forecast: '다음 날 상승률 예측' },
    'ATR은 하루 가격 범위를 평균낸 값입니다. 오를지 내릴지, 얼마나 오를지는 담고 있지 않습니다.', 'ATR의 계산 방식');
  q.claims = [{ change: 'up', today: 'wide' }, { change: 'up', today: 'narrow' }, { change: 'down', today: 'wide' }, { change: 'down', today: 'narrow' }];
  q.prompt = 'ATR을 종가로 나눈 비율(ATR%)을 20거래일 전과 비교하고, 오늘 하루의 변동 폭을 ATR과 비교하면?';
  q.margin = Math.min(Math.abs(current - before), Math.abs(tr - a) / c[i] * 100);
  q.hint = '하루 변동 폭(TR)은 고가−저가, 고가−전일 종가, 전일 종가−저가 중 가장 큰 값입니다. ATR(14)은 이 값을 평균낸 것입니다. 가격으로 나눈 ATR%는 가격 대비 폭입니다. 둘 다 오를지 내릴지는 담고 있지 않습니다.';
  q.panels = ['atr'];
  q.facts = [num('20거래일 전 ATR%', before, '%'), num('현재 ATR%', current, '%'), price('현재 ATR (가격 단위)', a), price('오늘 하루 변동 폭 (TR)', tr), price('전일 종가', prev.close)];
  q.explanation = `ATR%는 ${n(before)}% → ${n(current)}%이고, 오늘 변동 폭 ${n(tr)}은 ATR ${n(a)}보다 ${wide ? '큽니다' : '작습니다'}. 최근 흔들림의 크기를 비교한 것입니다. “앞으로 이만큼 오른다”나 손실 한도라는 뜻은 아닙니다.`;
  return q;
}

/** bands: 볼린저밴드 안팎의 위치 */
export function buildBands(ctx, i, q, tools) {
  const { candles: cs, c, m5, m20, m60 } = ctx, today = cs[i], prev = cs[i - 1];
  const { price, num, choose, read } = tools;
  const { upper, lower } = ctx.bb;
  choose(['종가가 상단선 위', '종가가 두 밴드 사이 (경계 포함)', '종가가 하단선 아래'], c[i] > upper[i] ? 0 : c[i] < lower[i] ? 2 : 1);
  read('position', '종가와 두 밴드', c[i] > upper[i] ? 'above' : c[i] < lower[i] ? 'below' : 'inside',
    { above: '상단선 위', inside: '두 선 사이 (경계 포함)', below: '하단선 아래' },
    `하단 ${n(lower[i])} · 종가 ${n(c[i])} · 상단 ${n(upper[i])}`, '마지막 봉 종가와 위아래 두 선');
  q.claims = [{ position: 'above' }, { position: 'inside' }, { position: 'below' }];
  q.prompt = '볼린저밴드(20일, 표준편차 2배)에서 마지막 종가의 위치는?';
  q.margin = Math.min(Math.abs(c[i] - upper[i]), Math.abs(c[i] - lower[i])) / c[i] * 100;
  q.hint = '이 문제는 위치만 묻습니다. 레슨의 “상단 이탈 사례”에 붙는 0.5%·중복 제외 조건과 다릅니다.';
  q.overlays = { bollinger: true }; q.facts = [price('상단선', upper[i]), price('종가', c[i]), price('하단선', lower[i])];
  q.explanation = `하단 ${n(lower[i])}, 종가 ${n(c[i])}, 상단 ${n(upper[i])}을 비교합니다. 밴드 밖에 있다는 이유만으로 반드시 안으로 돌아오거나 그대로 돌파한다고 결정할 수 없습니다.`;
  return q;
}
