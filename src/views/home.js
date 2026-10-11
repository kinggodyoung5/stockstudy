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
import { el, clear, qualityNotice } from '../lib/ui.js';
import { CURRICULUM } from '../content/foundations.js';

export function destroyHome() { /* 차트를 쓰지 않아 정리할 것이 없다 */ }

const STEPS = [
  {
    n: 1,
    title: '개념을 배운다',
    href: '#/learn/chart-basics',
    body: '봉과 지표가 무엇을 나타내는지 배웁니다. 각 레슨에서 판정 기준과 실제 차트 사례를 함께 살펴보세요.',
    cta: '가격과 봉부터 시작',
  },
  {
    n: 2,
    title: '근거를 쓰고 확인한다',
    href: '#/practice',
    body: '봉과 추세, 평균, 거래량, 지표를 읽는 기초 문제입니다. 정답을 보기 전에 근거를 적고, 관찰한 사실과 알 수 없는 것을 나눕니다.',
    cta: '기초 읽기 연습',
  },
  {
    n: 3,
    title: '실제 차트를 읽는다',
    href: '#/practice/chart',
    body: '실제 차트에서 봉·추세·평균·거래량·RSI와 MACD를 순서대로 읽습니다. 충족·불충족·확인 대기와 엇갈리는 근거도 구별합니다. 익숙해지면 데이터 뷰어에서 자유롭게 연습하세요.',
    cta: '실제 차트 입문 6단계',
  },
  {
    n: 4,
    title: '다른 차트로 확인한다',
    href: '#/practice/check',
    body: '연습과 겹치지 않는 구간에서 배운 내용을 확인합니다. 어려웠던 개념은 복습하고, 처음 쓴 근거와 해설을 본 뒤의 생각을 비교하세요.',
    cta: '새 구간에서 확인하기',
  },
];

export async function renderHome(app) {
  clear(app).append(el('p.loading', { text: '불러오는 중…' }));

  let data = null;
  let dataError = '';
  try { data = await loadPatternIndex(); } catch (error) { dataError = error.message; }

  const hero = el('div.hero', null, [
    el('h1', { text: '차트를 읽고, 근거를 설명하는 공부' }),
    el('p', { text:
      '봉과 추세부터 이동평균, 거래량, 보조지표까지. 실제 차트를 보며 기술적 분석의 기초를 익힙니다. ' +
      '다음 주가를 맞히기보다, 지금 차트에서 무엇을 읽었고 왜 그렇게 판단했는지 설명해보세요.' }),
    el('div.row', { style: { marginBottom: '24px' } }, [
      el('a.btn.primary', { href: '#/practice/chart', text: '실제 차트로 공부하기' }),
      el('a.btn', { href: '#/learn/chart-basics', text: '기초 개념부터 읽기' }),
    ]),
    data
      ? el('div.hero-stats', null, [
          el('div', null, [el('b', { text: String(data.patterns.length) }), el('span', { text: '탐지 규칙' })]),
          el('div', null, [el('b', { text: data.totalHits.toLocaleString() }), el('span', { text: '검출된 신호' })]),
          el('div', null, [el('b', { text: String(data.tickers) }), el('span', { text: '종목' })]),
          el('div', null, [el('b', { text: String(LESSONS.length) }), el('span', { text: '학습 레슨' })]),
        ])
      : el('p.warn.small', { text: '탐지 자료를 사용할 수 없습니다. ' + dataError }),
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
    qualityNotice(data),
    el('div.step-section', null, [
      el('h2.section-title', { text: '이 순서로 공부해보세요' }),
      steps,
    ]),
    el('section.panel', { style: { marginTop: '18px' } }, [
      el('h2.section-title', { text: '기초 개념 학습 순서' }),
      el('p.small.muted', { text: '입문자는 이 순서로 시작하세요. 단계를 읽었다고 완료 처리하지 않습니다. 새 차트에서 직접 설명할 수 있는지가 기준입니다.' }),
      el('ol.curriculum', null, CURRICULUM.map((step) => el('li', null, [
        el('a', { href: `#/learn/${step.lesson}`, text: step.title.replace(/^\d+\. /, '') }), el('p.small.muted', { text: step.goal }),
      ]))),
      el('a.btn.primary', { href: '#/learn/chart-basics', text: '1단계부터 공부하기' }),
    ]),
    el('div.panel', { style: { marginTop: '18px' } }, [
      el('h2.section-title', { style: { marginTop: 0 }, text: `학습 레슨 ${LESSONS.length}개` }),
      el('p.small.muted', { style: { margin: '0 0 14px' }, text: '아래는 찾아보기용 전체 목록입니다. 처음에는 위 순서대로 공부하고, 이후에 필요한 지표와 패턴을 찾아보세요.' }),
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
