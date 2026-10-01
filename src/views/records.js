/**
 * 기록과 백업 (#/practice/records)
 * 이 브라우저에 남은 학습 기록을 버전별로 보여주고, JSON 파일로 내보내거나 가져온다.
 * 기록을 지우는 기능은 두지 않는다. 가져오기는 미리 보기를 확인한 뒤에만 저장한다.
 */
import { loadPatternIndex } from '../lib/data.js';
import { COURSE_VERSION, TASKS } from '../lib/chart-course.js';
import { ASSESSMENT_VERSION } from '../lib/assessment.js';
import { RULES_VERSION } from '../lib/rules-version.js';
import { CONFIDENCE } from '../lib/course-feedback.js';
import { REVIEW_KEY, reviewSources, normalizeReview, reviewEntries } from '../lib/review.js';
import { MAX_BYTES, CONFLICT_KEY, buildBackup, countRecords, parseBackup, planImport, isBackupKey } from '../lib/backup.js';
import { el, clear } from '../lib/ui.js';
import * as storage from '../lib/storage.js';
import { readStore } from './review.js';

export async function renderRecords(app) {
  const index = await loadPatternIndex();
  if (!app.isConnected) return;
  const versions = { course: COURSE_VERSION, assessment: ASSESSMENT_VERSION, rules: RULES_VERSION, sourceDigest: index.provenance.sourceDigest };
  const currentCourse = `chart-course:${COURSE_VERSION}:${index.provenance.sourceDigest}`;
  const summary = el('section.panel');
  const list = el('section.panel');
  const backupArea = el('section.panel');

  function renderSummary() {
    const store = readStore(), c = countRecords(Object.fromEntries(Object.entries(store).filter(([k]) => isBackupKey(k))));
    const courseKeys = Object.keys(store).filter((k) => k.startsWith('chart-course:')).sort();
    const studyVersions = new Map();
    for (const k of Object.keys(store['real-study:v1'] || {})) { const v = k.split(':')[1] || '?'; studyVersions.set(v, (studyVersions.get(v) || 0) + 1); }
    const entries = reviewEntries(reviewSources(store), normalizeReview(store[REVIEW_KEY]), Date.now());
    const size = Object.entries(store).reduce((n, [k, v]) => n + k.length + JSON.stringify(v ?? null).length, 0);
    clear(summary).append(...[
      el('h2', { text: '이 브라우저에 남은 기록' }),
      el('dl.assess-kv', null, [
        el('dt', { text: '입문 과정' }), el('dd', { text: `${c.course}개 (교재 버전 ${c.courseVersions}개)` }),
        el('dt', { text: '새 구간 평가' }), el('dd', { text: `첫 시도 ${c.assessment}개 · 재시도 ${c.assessmentRetries}개` }),
        el('dt', { text: '실제 비교 연습' }), el('dd', { text: `${c.realStudy}쌍` }),
        el('dt', { text: '복습' }), el('dd', { text: `대상 ${entries.length}개 · 시도 ${c.review}회` }),
        el('dt', { text: '구성 예제 연습' }), el('dd', { text: `${c.practice}개 개념` }),
        c.conflicts ? el('dt', { text: '가져오기 충돌 보관' }) : null, c.conflicts ? el('dd', { text: `${c.conflicts}건` }) : null,
        el('dt', { text: '저장 용량(대략)' }), el('dd', { text: `${Math.ceil(size * 2 / 1024)}KB` }),
      ].filter(Boolean)),
      courseKeys.length > 1 || (courseKeys.length && courseKeys[0] !== currentCourse)
        ? el('p.small', { text: `입문 기록이 교재 버전별로 따로 있습니다: ${courseKeys.map((k) => `${k.split(':')[1]}${k === currentCourse ? ' (현재)' : ''} ${Object.keys(store[k] || {}).length}개`).join(', ')}. 이전 버전 기록은 저장된 정답 여부 그대로 보여주며 다시 채점하지 않습니다.` }) : null,
      studyVersions.size > 1 ? el('p.small', { text: `실제 비교 연습 기록의 규칙 버전: ${[...studyVersions].map(([v, n]) => `${v} ${n}쌍`).join(', ')}.` }) : null,
      el('p.small.muted', { text: '이전 버전의 앱은 실제 비교 연습을 최근 30쌍만 남기고 오래된 기록을 지웠습니다. 그렇게 이미 지워진 기록은 되살릴 수 없습니다. 지금은 개수 제한 없이 남깁니다.' }),
      storage.available() ? null : el('p.warn', { text: '이 브라우저는 저장이 막혀 있습니다. 시크릿 창이거나 사이트 데이터 저장을 차단했을 수 있습니다. 기록이 남지 않습니다.' }),
    ].filter(Boolean));
  }

  /** 처음 답과 사후 기록, 복습 시도를 함께 보여준다. 최근 것부터. */
  function renderList() {
    const store = readStore();
    const reviewState = normalizeReview(store[REVIEW_KEY]);
    const rows = [];
    for (const [key, records] of Object.entries(store)) {
      if (!key.startsWith('chart-course:') || !records || typeof records !== 'object') continue;
      for (const [id, r] of Object.entries(records)) if (r?.submittedAt) rows.push({ kind: '입문 과정', version: key.split(':')[1], id, r, reviews: reviewState.entries[`course|${key}|${id}`]?.attempts || [] });
    }
    for (const [id, e] of Object.entries(store['assessment:v1']?.items || {})) {
      if (e?.first?.submittedAt) rows.push({ kind: '새 구간 평가', version: e.first.version || '', id, r: e.first, retries: e.retries || [], reviews: reviewState.entries[`check|${id}`]?.attempts || [] });
    }
    rows.sort((a, b) => b.r.submittedAt - a.r.submittedAt);
    const LIMIT = 30;
    const draw = (all) => {
      const shown = all ? rows : rows.slice(0, LIMIT);
      clear(list).append(...[
        el('h2', { text: '답과 근거' }),
        el('p.small.muted', { text: '처음 고른 답과 근거, 해설을 본 뒤의 생각, 재시도와 복습을 따로 보여줍니다. 나중 기록이 처음 기록을 바꾸지 않습니다.' }),
        rows.length ? null : el('p.small.muted', { text: '아직 기록이 없습니다.' }),
        ...shown.map(({ kind, version, id, r, retries = [], reviews }) => {
          const [type, ticker, date] = id.split('|');
          return el('details.record-item', null, [
            el('summary', { text: `${TASKS[type]?.[0] || type} · ${ticker} ${date} · ${r.correct ? '맞음' : '다시 볼 관찰'}${retries.length ? ` · 재시도 ${retries.length}` : ''}${reviews.length ? ` · 복습 ${reviews.length}` : ''}` }),
            el('dl.assess-kv', null, [
              el('dt', { text: '기록' }), el('dd', { text: `${kind} · ${version} · ${new Date(r.submittedAt).toLocaleString('ko-KR')}` }),
              el('dt', { text: '고른 답' }), el('dd', { text: r.choiceText || `선택지 ${r.choice + 1}번 (문장 미저장)` }),
              el('dt', { text: '확신' }), el('dd', { text: r.confidence ? CONFIDENCE[r.confidence] : '표시 안 함' }),
              r.help ? el('dt', { text: '도움' }) : null, r.help ? el('dd', { text: Object.values(r.help).some(Boolean) ? '받음' : '받지 않음' }) : null,
            ].filter(Boolean)),
            r.reflection ? el('blockquote.fb-quote', { text: r.reflection }) : null,
            r.self?.note ? el('p.small', { text: '해설 뒤 생각: ' + r.self.note }) : null,
            retries.length ? el('p.small', { text: '재시도: ' + retries.map((x) => `${new Date(x.submittedAt).toLocaleDateString('ko-KR')} ${x.correct ? '맞음' : '다시 볼 관찰'}`).join(' · ') }) : null,
            reviews.length ? el('p.small', { text: '복습: ' + reviews.map((x) => `${new Date(x.submittedAt).toLocaleDateString('ko-KR')} ${x.ref.ticker} ${x.correct ? '맞음' : '다시 볼 관찰'}`).join(' · ') }) : null,
          ].filter(Boolean));
        }),
        !all && rows.length > LIMIT ? el('button.btn', { text: `나머지 ${rows.length - LIMIT}개 더 보기`, onclick: () => draw(true) }) : null,
      ].filter(Boolean));
    };
    draw(false);
  }

  function renderBackup() {
    const status = el('div', { 'aria-live': 'polite' });
    const fileInput = el('input', { type: 'file', id: 'backup-file', accept: '.json,application/json' });
    const exportButton = el('button.btn.primary', { text: '기록 내보내기 (JSON 파일)' });
    exportButton.addEventListener('click', () => {
      const backup = buildBackup(readStore(), versions);
      const text = JSON.stringify(backup, null, 1);
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = el('a', { href: url, download: `stockstudy-기록-${backup.exportedAt.slice(0, 10)}.json` });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      const c = backup.counts;
      clear(status).append(el('p', { text: `내보냈습니다. 입문 ${c.course}개, 평가 ${c.assessment}개, 실제 비교 ${c.realStudy}쌍, 복습 시도 ${c.review}회.` }),
        backup.unverified ? el('p.small.warn', { text: `현재 형식 검사를 통과하지 못한 저장값(${Object.keys(backup.unverified).join(', ')})은 파일의 unverified 칸에 그대로 넣었습니다. 가져오기에서는 읽지 않습니다.` }) : null);
    });
    fileInput.addEventListener('change', async () => {
      clear(status);
      const file = fileInput.files?.[0];
      if (!file) return;
      if (file.size > MAX_BYTES) { status.append(el('p.warn', { text: `파일이 ${Math.round(MAX_BYTES / 1024 / 1024)}MB보다 커서 읽지 않았습니다. 기존 기록은 그대로입니다.` })); return; }
      let text;
      try { text = await file.text(); } catch (_) { status.append(el('p.warn', { text: '파일을 읽지 못했습니다. 기존 기록은 그대로입니다.' })); return; }
      const parsed = parseBackup(text, file.size);
      if (!parsed.ok) { status.append(el('p.warn', { text: `가져오지 않았습니다. 기존 기록은 그대로입니다. 이유: ${parsed.error}` })); return; }
      const b = parsed.backup;
      const plan = planImport(readStore(), b);
      const r = plan.report;
      const apply = el('button.btn.primary', { text: '이대로 가져오기', disabled: !plan.writes.length });
      const cancel = el('button.btn', { text: '취소', onclick: () => { clear(status); fileInput.value = ''; } });
      apply.addEventListener('click', () => {
        apply.disabled = true;
        // 미리 보기 뒤에 다른 탭에서 기록이 바뀌었을 수 있으니 저장 직전에 다시 계산한다.
        const fresh = planImport(readStore(), b);
        const result = storage.saveMany(fresh.writes);
        clear(status).append(result.ok
          ? el('p', { text: `가져왔습니다. 새로 더한 기록 ${fresh.report.added}개, 합친 사후 기록 ${fresh.report.merged}개, 이미 같던 기록 ${fresh.report.same}개.` })
          : el('p.warn', { text: result.quota ? '저장 공간이 부족해 가져오지 못했습니다. 바뀐 것은 모두 되돌렸고 기존 기록은 그대로입니다.' : '브라우저가 저장을 막아 가져오지 못했습니다. 바뀐 것은 모두 되돌렸고 기존 기록은 그대로입니다.' }));
        fileInput.value = '';
        renderSummary(); renderList();
      });
      status.append(...[
        el('h3', { text: '가져오기 미리 보기' }),
        el('p.small', { text: `내보낸 시각 ${new Date(b.exportedAt).toLocaleString('ko-KR')} · 앱 ${b.app} · 교재 ${b.versions.course || '표시 없음'} · 규칙 ${b.versions.rules || '표시 없음'}` }),
        b.versions.sourceDigest && b.versions.sourceDigest !== versions.sourceDigest ? el('p.small.warn', { text: '이 백업은 지금과 다른 원자료 버전에서 만들었습니다. 기록은 버전별로 따로 보관되며 지금 기준으로 다시 채점하지 않습니다.' }) : null,
        el('ul', null, [
          `새로 더할 기록 ${r.added}개`, `이미 같은 기록 ${r.same}개 (늘지 않음)`,
          `사후 기록·재시도·복습을 합칠 기록 ${r.merged}개`,
          `최초 답이 서로 다른 기록 ${r.conflict}개 → 먼저 제출한 답을 남기고 다른 답은 충돌 보관함에 둡니다`,
          `충돌 보관함에 새로 넣을 것 ${r.keptAside}건`,
        ].map((t) => el('li', { text: t }))),
        b.unverified ? el('p.small.muted', { text: '이 파일의 unverified 칸은 형식 검사를 통과하지 못한 값이라 가져오지 않습니다.' }) : null,
        plan.writes.length ? el('p.small.muted', { text: '최초 답은 덮어쓰지 않습니다. 해설 뒤 생각·복기는 더 늦게 저장한 쪽을 쓰고, 밀려난 쪽도 충돌 보관함에 남깁니다.' })
          : el('p', { text: '바뀔 기록이 없습니다. 같은 백업을 이미 가져왔을 수 있습니다.' }),
        el('div.row', null, [apply, cancel]),
      ].filter(Boolean));
    });
    clear(backupArea).append(
      el('h2', { text: '백업' }),
      el('p.small', { text: '기록은 이 브라우저에만 저장됩니다. 다른 기기로 옮기거나 브라우저 데이터를 지우기 전에 파일로 내보내세요. 파일은 이 기기에만 저장되고 어디로도 보내지 않습니다.' }),
      el('div.row', null, [exportButton]),
      el('label.practice-label', { for: 'backup-file', text: '백업 파일 가져오기' }), fileInput,
      el('p.small.muted', { text: `이 앱이 내보낸 JSON 파일만 받습니다(${Math.round(MAX_BYTES / 1024 / 1024)}MB 이하). 형식이 다르거나 손상된 파일, 더 새로운 버전의 파일은 거부하고 기존 기록을 건드리지 않습니다.` }),
      status,
    );
  }

  clear(app).append(
    el('h1.page-title', { text: '기록과 백업' }),
    el('p.page-sub', { text: '처음 답, 해설 뒤의 생각, 재시도와 복습을 따로 보관합니다. 로그인이나 서버 저장은 없습니다.' }),
    el('div.row', { style: { marginBottom: '16px' } }, [el('a.btn', { href: '#/practice/chart', text: '입문 6단계' }), el('a.btn', { href: '#/practice/check', text: '새 구간에서 다시 읽기' }), el('a.btn', { href: '#/practice/review', text: '복습' })]),
    summary, backupArea, list);
  renderSummary(); renderBackup(); renderList();
}
