// 새 구간 평가 사례를 고른다. 이후 등락·수익률은 읽지 않는다.
//
//   node tools/build-assessment.mjs            data/assessment.json 생성
//   node tools/build-assessment.mjs --check    다시 만들어 저장본과 바이트 단위로 비교
//   node tools/build-assessment.mjs --census   주제·상태·경계별 후보 수(표집 비율을 정할 때 참고)
//
// 연습 노출 범위 = 입문 과정 480사례의 화면 구간 + 실제 비교 연습 285쌍의 공개 뒤 화면 구간.
// 평가 사례는 이 범위와 한 봉도 겹치지 않는다. 레슨 예시 표본과의 겹침은 기록만 한다.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { expandStock, inspectStock } from '../src/lib/data-quality.js';
import { COURSE_VERSION, TASKS, courseContext, makeCourseQuestion, openCourseCase } from '../src/lib/chart-course.js';
import { RULES_VERSION } from '../src/lib/rules-version.js';
import { STUDY_PATTERNS } from '../src/lib/real-study.js';
import { ASSESSMENT_VERSION, DOMAINS, DOMAIN_OF, RATES, EDGE_LIMIT, edgeOf, drawOf, sampleItems, shownRange, overlapBars, practiceExposure } from '../src/lib/assessment.js';

const root = new URL('../', import.meta.url);
const read = (file) => JSON.parse(fs.readFileSync(new URL(file, root)));
const sha = (s) => createHash('sha256').update(s).digest('hex');
const index = read('data/patterns/_index.json');
const manifest = read('data/patterns/_quality.json').sourceManifest;
const course = read('data/chart-course.json');
if (index.provenance.rulesVersion !== RULES_VERSION) throw new Error('탐지 자료를 먼저 재생성하세요.');
if (course.version !== COURSE_VERSION || course.provenance.sourceDigest !== index.provenance.sourceDigest)
  throw new Error('입문 교재를 먼저 재생성하세요.');

const stocks = new Map();
for (const ticker of index.eligibleTickers) {
  const bytes = fs.readFileSync(new URL(`data/stocks/${ticker}.json`, root));
  const expected = manifest.find((r) => r.ticker === ticker);
  if (!expected || sha(bytes) !== expected.sha256) throw new Error('원자료 버전 불일치: ' + ticker);
  const stock = expandStock(JSON.parse(bytes));
  if (!inspectStock(stock).eligible) throw new Error('격리 대상: ' + ticker);
  stocks.set(ticker, stock);
}

if (process.argv.includes('--census')) {
  // 7날 중 하루꼴로 표본을 세고 7을 곱한다. 대략의 규모만 본다.
  const counts = {};
  for (const [ticker, stock] of stocks) {
    const ctx = courseContext(stock.candles);
    for (let i = 120; i < stock.candles.length; i++) for (const type of Object.keys(TASKS)) {
      if (drawOf(type, ticker, stock.candles[i].date) >= 1 / 7) continue;
      const q = makeCourseQuestion(ctx, i, type);
      if (q) { const k = `${type}|${q.bucket}|${edgeOf(q)}`; counts[k] = (counts[k] || 0) + 7; }
    }
  }
  console.log(JSON.stringify(Object.fromEntries(Object.entries(counts).sort()), null, 1));
  process.exit(0);
}

// 연습 노출 범위
const studyMetas = Object.fromEntries(STUDY_PATTERNS.map((p) => [p.id, read(`data/patterns/${p.id}.json`)]));
const { exposure, study: studyHits } = practiceExposure(stocks, course.cases, studyMetas, index.eligibleTickers);
const lessons = new Map([...stocks.keys()].map((t) => [t, []]));
const indexOf = (stock, date) => stock.candles.findIndex((c) => c.date === date);
for (const file of fs.readdirSync(new URL('data/patterns/', root)).filter((f) => !f.startsWith('_')).sort()) {
  for (const hit of read(`data/patterns/${file}`).hits || []) {
    const stock = stocks.get(hit.ticker); if (!stock || !hit.fromDate || !hit.toDate) continue;
    const a = indexOf(stock, hit.fromDate), b = indexOf(stock, hit.toDate);
    if (a >= 0 && b >= a) lessons.get(hit.ticker).push([a, b]);
  }
}

const items = [], skipped = { exposure: 0, self: 0 };
for (const [ticker, stock] of stocks) {
  const result = sampleItems(courseContext(stock.candles), ticker, exposure.get(ticker));
  skipped.exposure += result.skipped.exposure; skipped.self += result.skipped.self;
  for (const it of result.items) {
    // 실제 화면과 같은 방식(그날까지 자른 이력)으로 다시 열어 상태가 같은지 확인한다.
    const { question } = openCourseCase(stock, it);
    const range = shownRange(question, stock.candles, indexOf(stock, it.date));
    if (range[0] !== it.range[0] || range[1] !== it.range[1]) throw new Error('표시 구간 불일치: ' + it.ticker + ' ' + it.date);
    const lesson = Math.max(0, ...lessons.get(ticker).map((r) => overlapBars(r, range)));
    items.push({ type: it.type, ticker, date: it.date, bucket: it.bucket, edge: it.edge,
      shown: [stock.candles[range[0]].date, stock.candles[range[1]].date], bars: range[1] - range[0] + 1, lessonOverlap: lesson });
  }
}
items.sort((a, b) => a.type.localeCompare(b.type) || a.ticker.localeCompare(b.ticker) || a.date.localeCompare(b.date));
for (const type of Object.keys(TASKS)) if (!items.some((r) => r.type === type)) throw new Error('평가 사례가 없는 주제: ' + type);

const byType = Object.fromEntries(Object.keys(TASKS).map((t) => [t, items.filter((r) => r.type === t).length]));
const payload = {
  version: ASSESSMENT_VERSION, courseVersion: COURSE_VERSION, provenance: index.provenance,
  policy: [
    '문제와 정답은 입문 과정과 같은 계산(makeCourseQuestion)으로 만든다. 이후 등락·수익률은 선별에 쓰지 않는다.',
    '어떤 날의 출제 여부는 그날까지의 봉, 고정된 표집 비율·경계 기준, 연습 노출 범위로만 정해진다.',
    '주제·상태·경계 여부마다 표집 비율을 따로 둬 정상·경계·혼재 사례를 함께 넣는다. 시장의 발생 비율을 뜻하지 않는다.',
    '입문 과정 480사례와 실제 비교 연습의 화면 구간과 한 봉도 겹치지 않는 구간만 쓴다. 지표 계산용 과거 이력은 겹침으로 세지 않는다.',
    '같은 종목의 평가 사례끼리도 화면 구간이 겹치지 않는다(날짜 순서로 앞의 사례를 남긴다).',
    '레슨 예시 표본과의 겹침은 lessonOverlap 에 봉 수로 기록만 한다. 뷰어·예측 실험에서 본 구간은 기록이 없어 확인할 수 없다.',
  ],
  edgeLimit: EDGE_LIMIT, rates: RATES,
  exposure: { courseCases: course.cases.length, studyCases: studyHits,
    digest: sha(JSON.stringify([...exposure])) },
  skipped,
  summary: { items: items.length, tickers: new Set(items.map((r) => r.ticker)).size, edge: items.filter((r) => r.edge).length,
    lessonOverlap: items.filter((r) => r.lessonOverlap > 0).length, byType,
    byDomain: Object.fromEntries(DOMAINS.map((d) => [d.id, items.filter((r) => DOMAIN_OF[r.type] === d.id).length])) },
  items,
};
const target = new URL('data/assessment.json', root), body = JSON.stringify(payload) + '\n';
if (process.argv.includes('--check')) {
  if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== body) throw new Error('평가 자료 재현 불일치');
} else {
  const temp = new URL('data/assessment.json.tmp', root);
  fs.writeFileSync(temp, body, { flag: 'wx' }); fs.renameSync(temp, target);
}
console.log(JSON.stringify({ ...payload.summary, skipped }, null, 2));
