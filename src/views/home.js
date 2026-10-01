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
    body: '지표와 패턴이 무엇을 재는 것인지 먼저 읽습니다. 각 레슨에는 그 신호의 판정 기준이 수치 그대로 공개돼 있고, 실제 과거 데이터에서 자동으로 찾아낸 사례가 근거 수치와 함께 붙어 있습니다.',
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
    title: '실제 데이터로 눈을 훈련한다',
    href: '#/practice/chart',
    body: '실제 차트에서 봉·추세·평균·거래량·RSI와 MACD를 순서대로 읽습니다. 충족·불충족·확인 대기와 엇갈리는 근거도 구별합니다. 익숙해지면 데이터 뷰어에서 자유롭게 연습하세요.',
    cta: '실제 차트 입문 6단계',
  },
  {
    n: 4,
    title: '다른 차트에서 다시 설명한다',
    href: '#/learn/analysis-process',
    body: '며칠 뒤 다른 종목에서 도움말 없이 관찰·해석·반대 증거·무효 조건을 적습니다. 다음 주가를 맞히는 것과 차트를 정확히 읽는 것은 별도로 평가합니다.',
    cta: '종합 복기 방법 읽기',
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
      '목표는 기술적 분석의 기초를 익히는 것입니다. 가격과 추세를 관찰하고, 지표가 재는 것을 이해하고, ' +
      '해석의 근거와 한계를 스스로 설명하는 연습을 합니다. 과거 사례와 통계는 그 연습을 돕는 자료이지 정답 예측기가 아닙니다.' }),
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
      el('h2.section-title', { text: '어떤 순서로 보면 되나' }),
      steps,
    ]),
    el('section.panel', { style: { marginTop: '18px' } }, [
      el('h2.section-title', { text: '기초 마스터를 위한 7단계' }),
      el('p.small.muted', { text: '입문자는 이 순서로 시작하세요. 단계를 읽었다고 완료 처리하지 않습니다. 새 차트에서 직접 설명할 수 있는지가 기준입니다.' }),
      el('ol.curriculum', null, CURRICULUM.map((step) => el('li', null, [
        el('a', { href: `#/learn/${step.lesson}`, text: step.title.replace(/^\d+\. /, '') }), el('p.small.muted', { text: step.goal }),
      ]))),
      el('a.btn.primary', { href: '#/learn/chart-basics', text: '1단계부터 공부하기' }),
    ]),
    el('div.panel', { style: { marginTop: '18px' } }, [
      el('h2.section-title', { style: { marginTop: 0 }, text: `학습 레슨 ${LESSONS.length}개` }),
      el('p.small.muted', { style: { margin: '0 0 14px' }, text: '아래는 찾아보기용 전체 목록입니다. 처음에는 위의 기초 순서를 따라가고, 필요한 지표와 패턴을 확장하세요.' }),
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
