// data/patterns의 생성물만 교체한다. stocks 원본은 읽기 전용이다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { expandStock } from '../src/lib/data-quality.js';
import { buildSnapshot } from '../src/lib/build-snapshot.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const stockDir = path.join(root, 'data', 'stocks');
const outDir = path.join(root, 'data', 'patterns');
const list = JSON.parse(fs.readFileSync(path.join(stockDir, 'index.json'), 'utf8')).filter((r) => (r.type || 'stock') === 'stock');
const sourceManifest = [];
const stocks = list.map((r) => {
  if (!/^[A-Za-z0-9.^_-]+$/.test(r.ticker)) throw new Error('잘못된 종목 코드');
  const bytes = fs.readFileSync(path.join(stockDir, r.ticker.replaceAll('^', '_') + '.json'));
  sourceManifest.push({ ticker: r.ticker, sha256: createHash('sha256').update(bytes).digest('hex') });
  return expandStock(JSON.parse(bytes));
});
const sourceDigest = createHash('sha256').update(JSON.stringify(sourceManifest)).digest('hex');
const generatedAt = process.argv.find((arg) => arg.startsWith('--date='))?.slice(7) || new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(generatedAt)) throw new Error('--date=YYYY-MM-DD 형식 필요');
let completed = 0;
const snapshot = buildSnapshot(stocks, { generatedAt, sourceDigest, sourceManifest,
  onProgress: (ticker) => { if (++completed % 10 === 0) console.log(`검출 ${completed}종목 완료 (${ticker})`); } });
const outputs = { ...snapshot.payloads, '_quality': snapshot.qualityReport, '_index': snapshot.index };
// 전부 계산·직렬화에 성공한 뒤 기록한다. _index는 마지막에 교체한다.
const serialized = Object.entries(outputs).map(([id, payload]) => [id, JSON.stringify(payload) + '\n']);
if (process.argv.includes('--check')) {
  const different = serialized.filter(([id, body]) => !fs.existsSync(path.join(outDir, id + '.json')) || fs.readFileSync(path.join(outDir, id + '.json'), 'utf8') !== body);
  console.log(`재현 비교: ${different.length}개 파일 불일치`);
  if (different.length) process.exitCode = 1;
} else {
  fs.mkdirSync(outDir, { recursive: true });
  for (const [id, body] of serialized) {
    const target = path.join(outDir, id + '.json');
    const temp = target + '.tmp';
    fs.writeFileSync(temp, body, { flag: 'wx' });
    fs.renameSync(temp, target);
  }
}
console.log(JSON.stringify({ rules: snapshot.index.patterns.length, ...snapshot.index.quality, totalHits: snapshot.index.totalHits, baseline: snapshot.index.baseline }, null, 2));
