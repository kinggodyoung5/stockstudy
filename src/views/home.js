/**
 * 첫 화면
 *
 * 레슨 30개 · 규칙 57개 · 탭 5개는 처음 온 사람에게는 그냥 벽이다.
 * 여기서는 (1) 이 앱이 무엇인지, (2) 어떤 순서로 보면 되는지,
 * (3) 어느 레슨이 있는지만 보여준다.
 *
 * 통계 이야기는 여기 두지 않는다. 처음 온 사람에게 필요한 것은
 * "무엇을 배우는 곳인가"이지 "이 신호가 맞느냐"가 아니다.
 * 신호별 성과는 각 레슨과 성과 통계 탭에서 다룬다.
 */

import { LESSONS, LESSON_GROUPS } from '../content/lessons.js';
import { loadPatternIndex } from '../lib/data.js';
import { el, clear } from '../lib/ui.js';

export function destroyHome() { /* 차트를 쓰지 않아 정리할 것이 없다 */ }

const STEPS = [
  {
    n: 1,
    title: '개념을 배운다',
    href: '#/learn/moving-average',
    body: '지표와 패턴이 무엇을 재는 것인지 먼저 읽습니다. 각 레슨에는 그 신호의 판정 기준이 수치 그대로 공개돼 있고, 실제 과거 데이터에서 자동으로 찾아낸 사례가 근거 수치와 함께 붙어 있습니다.',
    cta: '이동평균선부터 시작',
  },
  {
    n: 2,
    title: '가상 차트로 감을 익힌다',
    href: '#/sandbox',
    body: '무작위로 만든 가짜 주가를 봅니다. 실제 종목이 아니라서 선입견 없이 형태만 볼 수 있습니다. 여기서 무작위 데이터에 탐지 엔진을 직접 돌려볼 수도 있습니다.',
    cta: '가상 차트 실험실 열기',
  },
  {
    n: 3,
    title: '실제 데이터로 눈을 훈련한다',
    href: '#/viewer',
    body: '종목과 기간을 골라 지표를 켜고 끄며 비교합니다. 지표를 다 끈 상태에서 먼저 판단해보고, 그다음 하나씩 켜서 확인하는 순서를 권합니다.',
    cta: '데이터 뷰어 열기',
  },
  {
    n: 4,
    title: '퀴즈로 검증한다',
    href: '#/quiz',
    body: '실제 과거 구간의 앞부분만 보고 다음 20거래일 방향을 맞힙니다. 정답을 공개한 뒤, 내가 근거로 삼은 신호가 이번에 실제로 유효했는지 확인할 수 있습니다.',
    cta: '퀴즈 풀기',
  },
];

export async function renderHome(app) {
  clear(app).append(el('p.loading', { text: '불러오는 중…' }));

  let data = null;
  try { data = await loadPatternIndex(); } catch (_) { /* 탐지 결과가 아직 없어도 화면은 뜬다 */ }

  const hero = el('div.hero', null, [
    el('h1', { text: '차트 읽는 법, 그리고 그 숫자를 확인하는 법' }),
    el('p', { text:
      '기술적 분석을 배우는 학습 도구입니다. 지표가 무엇을 재는지 설명하고, ' +
      '그 판정 기준을 코드 그대로 공개하고, 실제 과거 데이터에서 자동으로 찾아낸 사례를 보여줍니다. ' +
      '그리고 그 신호가 실제로 얼마나 맞았는지도 같이 보여줍니다.' }),
    data
      ? el('div.hero-stats', null, [
          el('div', null, [el('b', { text: String(data.patterns.length) }), el('span', { text: '탐지 규칙' })]),
          el('div', null, [el('b', { text: data.totalHits.toLocaleString() }), el('span', { text: '검출된 신호' })]),
          el('div', null, [el('b', { text: String(data.tickers) }), el('span', { text: '종목' })]),
          el('div', null, [el('b', { text: String(LESSONS.length) }), el('span', { text: '학습 레슨' })]),
        ])
      : el('p.muted.small', { text: '탐지 결과가 아직 없습니다. tools/build-patterns.html 을 한 번 실행하세요.' }),
  ]);

  const steps = el('div.step-grid');
  for (const s of STEPS) {
    steps.append(
      el('a.step', { href: s.href }, [
        el('span.step-n', { text: String(s.n) }),
        el('h3', { text: s.title }),
        el('p', { text: s.body }),
        el('span.step-cta', { text: s.cta + ' →' }),
      ])
    );
  }

  // 레슨 전체 목록 (그룹별)
  const toc = el('div.toc');
  for (const g of LESSON_GROUPS) {
    const items = LESSONS.filter((l) => l.group === g.id);
    if (!items.length) continue;
    toc.append(
      el('div.toc-group', null, [
        el('h4', { text: g.name }),
        el('ul', null, items.map((l) =>
          el('li', null, [el('a', { href: `#/learn/${l.id}`, text: l.title })])
        )),
      ])
    );
  }

  clear(app).append(
    hero,
    el('div.step-section', null, [
      el('h2.section-title', { text: '어떤 순서로 보면 되나' }),
      steps,
    ]),
    el('div.panel', { style: { marginTop: '18px' } }, [
      el('h2.section-title', { style: { marginTop: 0 }, text: `학습 레슨 ${LESSONS.length}개` }),
      el('p.small.muted', { style: { margin: '0 0 14px' }, text: '위에서부터 순서대로 봐도 되고, 궁금한 것부터 골라 봐도 됩니다.' }),
      toc,
    ]),
    el('div.panel.caution', { style: { marginTop: '18px' } }, [
      el('h3', { style: { margin: '0 0 8px', fontSize: '15px' }, text: '이 앱이 하지 않는 것' }),
      el('ul.small', { style: { margin: 0, paddingLeft: '20px' } }, [
        el('li', { text: '종목을 추천하지 않습니다. 매매 신호도 제공하지 않습니다.' }),
        el('li', { text: '실시간 시세를 연동하지 않습니다. 전부 저장된 과거 데이터입니다.' }),
        el('li', { text: '여기 나오는 통계는 매매 전략을 과거에 돌려본 검증이 아니라 단순 집계입니다. 수수료·세금·분산투자가 들어 있지 않습니다.' }),
        el('li', { text: '과거 데이터는 미래를 보장하지 않습니다.' }),
      ]),
    ])
  );
}
