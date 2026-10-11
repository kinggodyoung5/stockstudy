/**
 * 앱 진입점 — 해시 기반 라우터
 * #/learn/{lessonId} · #/sandbox · #/viewer · #/quiz
 */

import { LESSONS } from './content/lessons.js';
import { el, clear } from './lib/ui.js';
import { renderLearn, destroyCharts } from './views/learn.js';
import { renderSandbox, destroySandbox } from './views/sandbox.js';
import { renderViewer, destroyViewer } from './views/viewer.js';
import { renderQuiz, destroyQuiz } from './views/quiz.js';
import { renderStats, destroyStats } from './views/stats.js';
import { renderHome, destroyHome } from './views/home.js';
import { renderPractice, destroyPractice } from './views/practice.js';

const ROUTES = [
  { id: 'home', label: '시작하기', render: renderHome },
  { id: 'learn', label: '개념 학습', render: renderLearn },
  { id: 'practice', label: '기초 읽기 연습', render: renderPractice },
  { id: 'viewer', label: '데이터 뷰어', render: renderViewer },
  { id: 'stats', label: '과거 통계', render: renderStats },
  { id: 'sandbox', label: '가상 차트', render: renderSandbox },
  { id: 'quiz', label: '방향 예측 실험', render: renderQuiz },
];

const app = document.getElementById('app');
const nav = document.getElementById('nav');

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const parts = raw.split('/').filter(Boolean);
  const id = ROUTES.some((r) => r.id === parts[0]) ? parts[0] : 'home';
  return { id, params: parts.slice(1) };
}

function renderNav(activeId, params = []) {
  clear(nav);
  const group = activeId === 'practice' && ['review', 'records'].includes(params[0]) ? params[0]
    : ['viewer', 'stats', 'sandbox', 'quiz'].includes(activeId) ? 'explore' : 'study';
  const primary = [['study', '학습하기', '#/practice/chart'], ['explore', '차트 탐색', '#/viewer'],
    ['review', '복습', '#/practice/review'], ['records', '내 기록', '#/practice/records']];
  for (const [id, text, href] of primary) nav.append(el('a', { href, text, class: group === id ? 'on' : '', 'aria-current': group === id ? 'true' : null }));
  const items = group === 'explore'
    ? [['데이터 뷰어', '#/viewer'], ['과거 통계', '#/stats'], ['가상 차트', '#/sandbox'], ['방향 예측 실험', '#/quiz']]
    : [['학습 안내', '#/home'], ['개념 학습', `#/learn/${LESSONS[0].id}`], ['입문 6단계', '#/practice/chart'],
      ['기초 문제', '#/practice'], ['사례 비교', '#/practice/real'], ['새 구간 평가', '#/practice/check']];
  const secondary = document.getElementById('section-nav');
  clear(secondary);
  secondary.hidden = ['review', 'records'].includes(group);
  for (const [text, href] of items) {
    const selected = href === location.hash || (activeId === 'learn' && href.startsWith('#/learn/'))
      || (href === '#/practice/chart' && params[0] === 'chart');
    secondary.append(el('a', { href, text, class: selected ? 'on' : '', 'aria-current': selected ? 'page' : null }));
  }
}

function teardown() {
  destroyCharts();
  destroySandbox();
  destroyViewer();
  destroyQuiz();
  destroyStats();
  destroyHome();
  destroyPractice();
}

let renderToken = 0;

async function route() {
  const { id, params } = parseHash();
  const route = ROUTES.find((r) => r.id === id);
  const token = ++renderToken;

  teardown();
  renderNav(id, params);
  // 이전 비동기 렌더가 끝나도 새 페이지의 DOM을 덮어쓸 수 없게 분리한다.
  const page = el('div');
  clear(app).append(page);
  window.scrollTo(0, 0);
  page.append(el('p.loading', { text: '불러오는 중…' }));

  try {
    await route.render(page, params);
  } catch (err) {
    if (token !== renderToken) return; // 그 사이 다른 탭으로 이동함
    console.error(err);
    clear(app).append(
      el('div.error', null, [
        el('b', { text: '화면을 불러오지 못했습니다. ' }),
        el('div.small', { style: { marginTop: '8px' } }, [
          '이 앱은 ES 모듈과 fetch를 사용하므로 ',
          el('code', { text: 'file://' }),
          ' 로 직접 열면 동작하지 않습니다. ',
          el('code', { text: 'powershell -ExecutionPolicy Bypass -File tools\\serve.ps1' }),
          ' 로 로컬 서버를 띄운 뒤 ',
          el('code', { text: 'http://localhost:8123' }),
          ' 로 접속하세요.',
        ]),
        el('div.small.muted', { style: { marginTop: '8px' }, text: String(err && err.message) }),
      ])
    );
  }
}

window.addEventListener('hashchange', route);

if (!location.hash) location.hash = '#/home';
// Canvas charts must use the same loaded font as the surrounding text.
Promise.race([document.fonts.load('400 16px SUIT'), new Promise((resolve) => setTimeout(resolve, 1800))])
  .catch(() => {}).then(route);
