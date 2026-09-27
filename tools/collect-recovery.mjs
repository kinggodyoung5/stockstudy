// 공급자 응답을 원문 그대로 보관하는 수집 단계. data/stocks는 절대 수정하지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...value] = arg.replace(/^--/, '').split('='); return [key, value.join('=')];
}));
const provider = args.provider || 'naver';
if (!['naver', 'yahoo'].includes(provider)) throw new Error('provider: naver 또는 yahoo');
const run = args.run || '2026-09-23';
if (!/^\d{4}-\d{2}-\d{2}(?:-[a-z0-9-]+)?$/.test(run)) throw new Error('잘못된 실행 이름');
const start = args.from || '2015-01-01';
const end = args.to || '2026-08-28';
for (const value of [start, end]) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('날짜 오류');
}
const index = JSON.parse(fs.readFileSync(path.join(root, 'data/stocks/index.json'), 'utf8'));
const wanted = args.only ? new Set(args.only.split(',')) : null;
const targets = index.filter((s) => (s.type || 'stock') === 'stock' && (wanted ? wanted.has(s.ticker) : s.market === 'KR'));
if (wanted && targets.length !== wanted.size) throw new Error('기존 목록에 없는 종목 코드');
const dir = path.join(root, 'data/recovery', run, 'raw');
fs.mkdirSync(dir, { recursive: true });
for (const stock of targets) {
  if (!/^[A-Za-z0-9._-]+$/.test(stock.ticker)) throw new Error('종목 코드 오류');
  const stem = `${provider}-${stock.ticker}-${start}-${end}`;
  const manifest = path.join(dir, stem + '.json');
  if (fs.existsSync(manifest)) { console.log('보존된 응답 사용: ' + stem); continue; }
  let url;
  if (provider === 'naver') {
    if (stock.market !== 'KR') throw new Error('Naver는 국내 종목만 요청');
    url = new URL('https://api.finance.naver.com/siseJson.naver');
    url.search = new URLSearchParams({ symbol: stock.ticker.split('.')[0], requestType: '1', startTime: start.replaceAll('-', ''), endTime: end.replaceAll('-', ''), timeframe: 'day' });
  } else {
    url = new URL('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(stock.ticker));
    url.search = new URLSearchParams({ period1: String(Date.parse(start) / 1000), period2: String(Date.parse(end) / 1000 + 86400), interval: '1d', events: 'splits,div', includeAdjustedClose: 'true' });
  }
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://finance.naver.com/' }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 5_000_000 || bytes.length < 20) throw new Error('응답 크기 오류');
    const rawFile = stem + '.txt.gz';
    fs.writeFileSync(path.join(dir, rawFile), gzipSync(bytes, { level: 9 }), { flag: 'wx' });
    const record = { provider, ticker: stock.ticker, url: url.href, retrievedAt: new Date().toISOString(), requestedFrom: start, requestedTo: end,
      bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), rawFile, contentType: response.headers.get('content-type') };
    fs.writeFileSync(manifest, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
    console.log(`${stock.ticker}: ${bytes.length} bytes 보관`);
    if (args.preview !== undefined) console.log(bytes.toString('utf8').slice(0, 2400));
  } catch (error) {
    console.error(`${stock.ticker}: 수집 실패 (${error.message})`); process.exitCode = 1;
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
}
