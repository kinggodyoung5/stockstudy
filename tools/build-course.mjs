// 미래 결과를 읽거나 성공 사례로 거르지 않는다. 당시 관찰 상태별로 교육용 표본만 구성한다.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { expandStock, inspectStock } from '../src/lib/data-quality.js';
import { COURSE_VERSION, TASKS, courseContext, makeCourseQuestion, openCourseCase } from '../src/lib/chart-course.js';
import { RULES_VERSION } from '../src/lib/rules-version.js';

const root = new URL('../', import.meta.url);
const read = (file) => JSON.parse(fs.readFileSync(new URL(file, root)));
const sha = (s) => createHash('sha256').update(s).digest('hex');
const index = read('data/patterns/_index.json');
const manifest = read('data/patterns/_quality.json').sourceManifest;
if (index.provenance.rulesVersion !== RULES_VERSION) throw new Error('탐지 자료를 먼저 재생성하세요.');
const buckets = new Map(), stocks = new Map();
for (const ticker of index.eligibleTickers) {
  const bytes = fs.readFileSync(new URL(`data/stocks/${ticker}.json`, root));
  const expected = manifest.find((r) => r.ticker === ticker);
  if (!expected || sha(bytes) !== expected.sha256) throw new Error('원자료 버전 불일치: ' + ticker);
  const stock = expandStock(JSON.parse(bytes));
  if (!inspectStock(stock).eligible) throw new Error('격리 대상: ' + ticker);
  stocks.set(ticker, stock);
  const ctx = courseContext(stock.candles);
  for (let i = 120; i < stock.candles.length; i++) {
    const types = i % 17 === 0 ? Object.keys(TASKS) : ['cross-status', 'volume-rule', 'engulf'];
    for (const type of types) {
      const q = makeCourseQuestion(ctx, i, type);
      if (!q) continue;
      const ref = { type, ticker, date: stock.candles[i].date, bucket: q.bucket };
      const key = `${type}|${q.bucket}`, rank = sha(`${type}|${ticker}|${ref.date}`);
      if (!buckets.has(key)) buckets.set(key, []);
      // 메모리를 제한하되 한 종목이 희귀 상태 표본을 독점하지 않게 종목별 후보를 보존한다.
      const pool = buckets.get(key), own = pool.filter((r) => r.ticker === ticker);
      if (own.length < 2 || rank < own.at(-1).rank) {
        if (own.length >= 2) pool.splice(pool.indexOf(own.at(-1)), 1);
        pool.push({ ...ref, rank }); pool.sort((a, b) => a.rank.localeCompare(b.rank));
      }
    }
  }
  if (stocks.size % 10 === 0) console.log(`입문 교재 후보 ${stocks.size}종목 확인`);
}
const cases = [];
for (const [, pool] of [...buckets].sort(([a], [b]) => a.localeCompare(b))) {
  const used = new Set(), selected = [];
  for (const ref of pool) if (!used.has(ref.ticker)) { used.add(ref.ticker); selected.push(ref); if (selected.length === 8) break; }
  for (const ref of selected) {
    const { rank, ...clean } = ref;
    // 전체 이력으로 만든 후보와 cutoff만 전달한 실제 문제의 판정이 일치해야 한다.
    openCourseCase(stocks.get(ref.ticker), clean);
    cases.push(clean);
  }
}
for (const type of Object.keys(TASKS)) if (!cases.some((c) => c.type === type)) throw new Error('자료가 없는 주제: ' + type);
const payload = { version: COURSE_VERSION, provenance: index.provenance,
  policy: '관찰 상태별·종목 분산 교육 표본. 이후 등락·수익률은 선별에 사용하지 않음. 모집단 비율 추정용이 아님.',
  cases };
const target = new URL('data/chart-course.json', root), body = JSON.stringify(payload) + '\n';
if (process.argv.includes('--check')) {
  if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== body) throw new Error('입문 교재 재현 불일치');
} else {
  const temp = new URL('data/chart-course.json.tmp', root);
  fs.writeFileSync(temp, body, { flag: 'wx' }); fs.renameSync(temp, target);
}
console.log(JSON.stringify({ topics: Object.keys(TASKS).length, cases: cases.length,
  tickers: new Set(cases.map((c) => c.ticker)).size,
  buckets: Object.fromEntries([...buckets].map(([k]) => [k, cases.filter((c) => `${c.type}|${c.bucket}` === k).length])) }, null, 2));
