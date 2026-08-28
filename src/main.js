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

const ROUTES = [
  { id: 'learn', label: '개념 학습', render: renderLearn },
  { id: 'viewer', label: '데이터 뷰어', render: renderViewer },
  { id: 'stats', label: '성과 통계', render: renderStats },
  { id: 'sandbox', label: '가상 차트', render: renderSandbox },
  { id: 'quiz', label: '퀴즈', render: renderQuiz },
];

const app = document.getElementById('app');
const nav = document.getElementById('nav');

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const parts = raw.split('/').filter(Boolean);
  const id = ROUTES.some((r) => r.id === parts[0]) ? parts[0] : 'learn';
  return { id, params: parts.slice(1) };
}

function renderNav(activeId) {
  clear(nav);
  for (const r of ROUTES) {
    const href = r.id === 'learn' ? `#/learn/${LESSONS[0].id}` : `#/${r.id}`;
    nav.append(el('a', { href, class: r.id === activeId ? 'on' : '', text: r.label }));
  }
}

function teardown() {
  destroyCharts();
  destroySandbox();
  destroyViewer();
  destroyQuiz();
  destroyStats();
}

let renderToken = 0;

async function route() {
  const { id, params } = parseHash();
  const route = ROUTES.find((r) => r.id === id);
  const token = ++renderToken;

  teardown();
  renderNav(id);
  clear(app).append(el('p.loading', { text: '불러오는 중…' }));

  try {
    await route.render(app, params);
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

if (!location.hash) location.hash = `#/learn/${LESSONS[0].id}`;
route();
