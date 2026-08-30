/**
 * 첫 화면
 *
 * 레슨 30개 · 규칙 57개 · 탭 5개는 처음 온 사람에게는 그냥 벽이다.
 * 여기서 (1) 이 앱이 무엇을 주장하는지, (2) 어떤 순서로 보면 되는지,
 * (3) 지금 뭘 찾고 있다면 어디로 가면 되는지를 한 화면에 정리한다.
 */

import { directionalEdge } from '../lib/stats.js';
import { LESSONS, LESSON_GROUPS } from '../content/lessons.js';
import { loadPatternIndex } from '../lib/data.js';
import { el, clear, signed, dirClass } from '../lib/ui.js';
import { figureEl } from './learn.js';

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

  const base = data && data.baseline;

  // 기준선과 가장 크게 벌어진 규칙 몇 개를 골라 미리보기로 보여준다
  let highlights = [];
  if (data && base) {
    highlights = data.patterns
      .filter((p) => p.stats && p.count >= 100)
      // 하락 신호는 상승 비율이 낮아야 맞힌 것이다. 그냥 빼면 "틀린 신호"가 +로 올라온다.
      .map((p) => ({ ...p, edge: directionalEdge(p.stats, base, p.bias) }))
      .filter((p) => p.edge != null)
      .sort((a, b) => b.edge - a.edge)
      .slice(0, 4);
  }

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

  // 설명에 쓸 실제 사례 하나 (골든크로스처럼 유명한데 기준선과 차이가 없는 것)
  const demo = data
    ? data.patterns.find((p) => p.pattern === 'golden-cross' && p.stats)
    : null;

  const thesis = base
    ? el('div.panel.thesis', null, [
        el('h2', { text: '"골든크로스가 나오면 오른다" — 정말일까?' }),

        el('p', { html:
          '이걸 확인하려면 <b>골든크로스 뒤에 산 결과만 봐서는 안 됩니다.</b> ' +
          '왜냐하면 아무 날에나 사도 절반쯤은 오르기 때문입니다.' }),

        el('div.analogy', null, [
          el('p', { html:
            '<b>감기약을 먹고 3일 뒤에 나았습니다. 약이 들은 걸까요?</b><br>' +
            '감기는 약을 안 먹어도 대개 3일이면 낫습니다. "약 먹고 나았다"만으로는 알 수 없고, ' +
            '<b>약을 안 먹은 사람들과 비교</b>해야 알 수 있습니다.' }),
        ]),

        el('p', { html:
          `주식에서 "약을 안 먹은 사람들"에 해당하는 것이 <b>아무 날이나 사는 것</b>입니다. ` +
          `이 앱의 ${data.tickers}개 종목, ${data.from.slice(0, 4)}년 ~ ${data.to.slice(0, 4)}년 데이터로 계산하면 ` +
          `아무 날이나 사서 ${data.outcomeDays}거래일 들고 있었을 때 <b>${base.winRate}%</b> 확률로 올랐습니다. ` +
          `이 숫자를 <b>기준선</b>이라고 부르겠습니다.` }),

        demo
          ? figureEl('baseline-compare', {
              sigName: `${demo.name} 뒤에 샀을 때 (${demo.count.toLocaleString()}번)`,
              sigVal: demo.stats.winRate,
              baseVal: base.winRate,
            })
          : null,

        demo
          ? el('p', { html:
              `골든크로스 뒤에 산 ${demo.count.toLocaleString()}번의 결과는 <b>${demo.stats.winRate}%</b>였습니다. ` +
              `기준선은 <b>${base.winRate}%</b>입니다. ` +
              (Math.abs(demo.stats.winRate - base.winRate) < 0.5
                ? '<b>사실상 똑같습니다.</b> 골든크로스를 보고 샀든 아무 날이나 샀든 결과가 다르지 않았다는 뜻입니다.'
                : `차이는 ${(demo.stats.winRate - base.winRate).toFixed(1)}%p 입니다.`) })
          : null,

        el('p.pp-note', { html:
          '<b>%p 는 무엇인가요?</b> 퍼센트끼리 뺀 차이라서 단위를 다르게 씁니다. ' +
          `55% − ${base.winRate}% = ${(55 - base.winRate).toFixed(1)}<b>%p</b> 입니다. ` +
          '"55% 좋다"가 아니라 "그만큼 포인트 차이가 난다"는 뜻입니다.' }),

        el('h3', { style: { margin: '22px 0 6px', fontSize: '16px' }, text: '그래서 이 앱은 모든 신호를 이렇게 봅니다' }),
        el('p', { text:
          '57개 규칙마다 "그 신호가 나온 뒤의 결과"와 "아무 날이나 샀을 때의 결과"를 나란히 계산해 뒀습니다. ' +
          '둘의 차이가 0에 가까우면, 신호 하나만 보고 사고파는 방식으로는 도움이 되지 않았다는 뜻입니다. ' +
          '실제로 유명한 신호 상당수가 그렇습니다.' }),
        el('p.small.muted', { style: { margin: '8px 0 0' }, text:
          '이 숫자가 "차트 분석은 소용없다"는 뜻은 아닙니다. 여기서 재는 것은 진입 시점 하나뿐입니다. ' +
          '손절과 익절을 언제 할지, 얼마나 살지, 여러 신호를 어떻게 겹쳐 볼지는 들어 있지 않고, ' +
          '실제 결과는 그쪽이 더 크게 좌우합니다. 지표를 언제 믿고 언제 의심할지 감을 잡는 용도로 보세요.' }),

        highlights.length
          ? el('div', null, [
              el('p.small.muted', { style: { margin: '14px 0 8px' }, text:
                '그중에서는 이 넷이 그나마 나았습니다. 신호가 가리킨 방향이 실제로 더 맞은 폭 기준입니다 (표본 100건 이상):' }),
              el('div.highlight-grid', null, highlights.map((h) =>
                el('a.highlight', { href: `#/learn/${h.lesson}` }, [
                  el('span.h-name', { text: h.name }),
                  el('span.h-edge', { class: dirClass(h.edge), text: (h.edge > 0 ? '+' : '') + h.edge + '%p' }),
                  el('span.h-meta', { text: `승률 ${h.stats.winRate}% · ${h.count.toLocaleString()}건` }),
                ]))
              ),
            ])
          : null,

        el('p.small.muted', { style: { margin: '14px 0 12px' }, text:
          '단, 이 숫자들도 어느 시기·어느 종목군이었는지에 따라 크게 달라집니다. 통계 탭에서 나눠 볼 수 있습니다. ' +
          '표본이 쌓인 규칙 가운데 기준선을 뚜렷하게 앞선 것은 없습니다.' }),
        el('a.btn.primary', { href: '#/stats', text: '57개 규칙 전부 보기' }),
      ])
    : null;

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
    thesis,
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
