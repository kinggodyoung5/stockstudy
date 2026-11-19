// 자료 날짜 갱신과 종목 추가 (로드맵 G2). 실행 이름 2026-11-19.
//
//   node tools/update-data.mjs --fetch    공급자 원문만 받아 data/updates/2026-11-19/raw 에 보존 (이미 있으면 다시 받지 않음)
//   node tools/update-data.mjs            보존된 원문으로 계산만 하고 결과를 보여줌 (파일을 쓰지 않음)
//   node tools/update-data.mjs --apply    덧붙이기·추가를 종목 파일과 목록에 적용하고 보고서를 씀
//   node tools/update-data.mjs --check    덧붙이기 전 파일 + 보존 원문으로 다시 만들어 지금 파일과 바이트 단위로 비교
//
// 덧붙이기 전 파일은 종목 파일의 updates 기록으로 되살린다(stripUpdates). 그래서 --apply 를 다시 실행해도 결과가 같다.
// 과거 가격이 바뀐 종목(분할 등)과 대조에 실패한 종목은 덧붙이지 않고 보고서의 stopped 에 남긴다. 사람이 판단한다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { parseNaver } from './lib/recovery.mjs';
import { parseYahooAny, appendStock, newStock, stripUpdates, packStock, expandStock } from './lib/update.mjs';
import { ADDITIONS } from './lib/additions-2026-11-19.mjs';

const RUN = '2026-11-19', UNTIL = '2026-11-18', APPEND_FROM = '2026-07-01', FULL_FROM = '2015-01-01', TO = '2026-11-19';
const root = fileURLToPath(new URL('../', import.meta.url));
const dir = path.join(root, 'data/updates', RUN), rawDir = path.join(dir, 'raw');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const fileOf = (t) => path.join(root, 'data/stocks', t.replace(/\^/g, '_') + '.json');
const args = process.argv.slice(2);
if (args.some((a) => !['--fetch', '--apply', '--check'].includes(a)) || args.length > 1) throw new Error('지원 옵션: --fetch, --apply, --check 중 하나');
const mode = args[0]?.slice(2) || 'dry';
const index = JSON.parse(fs.readFileSync(path.join(root, 'data/stocks/index.json'), 'utf8'));

/** 받을 원문 목록: [provider, ticker, from] */
const baseTickers = index.filter((s) => !(JSON.parse(fs.readFileSync(fileOf(s.ticker), 'utf8')).added)).map((s) => s.ticker);
const wants = [];
for (const t of baseTickers) {
  const s = index.find((x) => x.ticker === t);
  wants.push(['yahoo', t, APPEND_FROM]);
  if (s.market === 'KR' && s.type === 'stock') wants.push(['naver', t, APPEND_FROM]);
}
for (const a of ADDITIONS) { wants.push(['yahoo', a.ticker, FULL_FROM]); if (a.market === 'KR') wants.push(['naver', a.ticker, FULL_FROM]); }
const stemOf = (p, t, from) => `${p}-${t.replace(/\^/g, '_')}-${from}-${TO}`;

if (mode === 'fetch') {
  fs.mkdirSync(rawDir, { recursive: true });
  let failed = 0;
  for (const [provider, ticker, from] of wants) {
    const stem = stemOf(provider, ticker, from), manifest = path.join(rawDir, stem + '.json');
    if (fs.existsSync(manifest)) continue;
    let url;
    if (provider === 'naver') {
      url = new URL('https://api.finance.naver.com/siseJson.naver');
      url.search = new URLSearchParams({ symbol: ticker.split('.')[0], requestType: '1', startTime: from.replaceAll('-', ''), endTime: TO.replaceAll('-', ''), timeframe: 'day' });
    } else {
      url = new URL('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(ticker));
      url.search = new URLSearchParams({ period1: String(Date.parse(from) / 1000), period2: String(Date.parse(TO) / 1000 + 86400), interval: '1d', events: 'splits,div', includeAdjustedClose: 'true' });
    }
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://finance.naver.com/' }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length > 5_000_000 || bytes.length < 20) throw new Error('응답 크기 오류');
      fs.writeFileSync(path.join(rawDir, stem + '.txt.gz'), gzipSync(bytes, { level: 9 }), { flag: 'wx' });
      fs.writeFileSync(manifest, JSON.stringify({ provider, ticker, url: url.href, retrievedAt: new Date().toISOString(), requestedFrom: from, requestedTo: TO,
        bytes: bytes.length, sha256: sha(bytes), rawFile: stem + '.txt.gz', contentType: res.headers.get('content-type') }, null, 2) + '\n', { flag: 'wx' });
      console.log(`${provider} ${ticker}: ${bytes.length} bytes`);
    } catch (e) { failed++; console.error(`${provider} ${ticker}: 실패 (${e.message})`); }
    await new Promise((r) => setTimeout(r, 300));
  }
  console.log(failed ? `실패 ${failed}건. 다시 실행하면 받지 못한 것만 받습니다.` : '원문 수집 완료');
  process.exit(failed ? 1 : 0);
}

function source(provider, ticker, from) {
  const stem = stemOf(provider, ticker, from);
  const meta = JSON.parse(fs.readFileSync(path.join(rawDir, stem + '.json'), 'utf8'));
  const bytes = gunzipSync(fs.readFileSync(path.join(rawDir, meta.rawFile)));
  if (sha(bytes) !== meta.sha256 || meta.ticker !== ticker || meta.provider !== provider) throw new Error('원문 해시·식별자 불일치: ' + stem);
  return { meta, text: bytes.toString('utf8') };
}

const outputs = [], report = { run: RUN, until: UNTIL, appended: [], unchanged: [], stopped: [], added: [], addedQuarantined: [] };
for (const t of baseTickers) {
  const entry = index.find((s) => s.ticker === t), raw = JSON.parse(fs.readFileSync(fileOf(t), 'utf8'));
  const baseRaw = stripUpdates(raw), base = expandStock(baseRaw);
  const y = source('yahoo', t, APPEND_FROM), kr = entry.market === 'KR' && entry.type === 'stock';
  const n = kr ? source('naver', t, APPEND_FROM) : null;
  const r = appendStock(base, parseYahooAny(y.text, t), n ? parseNaver(n.text) : null, UNTIL);
  const last = base.candles.at(-1).date;
  if (r.status === 'stop') { report.stopped.push({ ticker: t, name: entry.name, baseTo: last, reason: r.reason }); outputs.push({ t, body: JSON.stringify(baseRaw) + '\n', entry: { ...entry, to: last, count: base.candles.length } }); continue; }
  if (r.status === 'none') { report.unchanged.push(t); outputs.push({ t, body: JSON.stringify(baseRaw) + '\n', entry: { ...entry, to: last, count: base.candles.length } }); continue; }
  const candles = [...base.candles, ...r.added];
  const update = { run: RUN, baseTo: last, baseCount: base.candles.length, to: candles.at(-1).date, added: r.added.length,
    sources: [y.meta, ...(n ? [n.meta] : [])].map(({ provider, url, retrievedAt, bytes, sha256, rawFile }) => ({ provider, url, retrievedAt, bytes, sha256, rawFile: `data/updates/${RUN}/raw/${rawFile}` })),
    ...r.detail };
  const packed = { ...baseRaw, candles: [...baseRaw.candles, ...r.added.map((c) => baseRaw.fields.map((k) => c[k]))], updates: [update] };
  report.appended.push({ ticker: t, from: r.added[0].date, to: update.to, added: r.added.length, ...r.detail });
  outputs.push({ t, body: JSON.stringify(packed) + '\n', entry: { ...entry, to: update.to, count: candles.length } });
}
for (const meta of ADDITIONS) {
  const y = source('yahoo', meta.ticker, FULL_FROM), n = meta.market === 'KR' ? source('naver', meta.ticker, FULL_FROM) : null;
  const r = newStock(meta, parseYahooAny(y.text, meta.ticker), n ? parseNaver(n.text) : null, UNTIL);
  const added = { run: RUN, policy: meta.market === 'KR' ? '두 공급자 대조(복구 정책과 같은 recoverStock)' : 'Yahoo 하나. 두 번째 공급자 대조 없음',
    sources: [y.meta, ...(n ? [n.meta] : [])].map(({ provider, url, retrievedAt, bytes, sha256, rawFile }) => ({ provider, url, retrievedAt, bytes, sha256, rawFile: `data/updates/${RUN}/raw/${rawFile}` })),
    ...r.detail };
  const packed = packStock({ ticker: meta.ticker, name: meta.name, market: meta.market, currency: meta.currency, type: 'stock', candles: r.stock.candles,
    ...(r.stock.dataQuality ? { dataQuality: r.stock.dataQuality } : {}) }, {});
  const ordered = { ticker: packed.ticker, name: packed.name, market: packed.market, currency: packed.currency, type: packed.type, format: 2, fields: packed.fields,
    candles: packed.candles, ...(packed.dataQuality ? { dataQuality: packed.dataQuality } : {}), added };
  const c = r.stock.candles;
  (r.quality.eligible ? report.added : report.addedQuarantined).push({ ticker: meta.ticker, name: meta.name, from: c[0].date, to: c.at(-1).date, count: c.length,
    ...(r.quality.eligible ? {} : { issues: r.quality.issues.length, sourceConcerns: r.quality.sourceConcerns.length }) });
  outputs.push({ t: meta.ticker, body: JSON.stringify(ordered) + '\n', entry: { ticker: meta.ticker, name: meta.name, market: meta.market, type: 'stock', from: c[0].date, to: c.at(-1).date, count: c.length }, isNew: true });
}

// 목록: 기존 순서를 그대로 지키고, 새 국내 종목은 마지막 국내 종목 뒤에, 새 미국 종목은 마지막 미국 종목 뒤에 넣는다.
const byT = new Map(outputs.map((o) => [o.t, o.entry]));
const newIndex = [];
const baseOrder = index.filter((s) => baseTickers.includes(s.ticker));
const lastOf = (m) => baseOrder.map((x) => x.market === m && (x.type || 'stock') === 'stock').lastIndexOf(true);
baseOrder.forEach((s, k) => {
  newIndex.push(byT.get(s.ticker));
  for (const m of ['KR', 'US']) if (k === lastOf(m)) for (const a of ADDITIONS.filter((x) => x.market === m)) newIndex.push(byT.get(a.ticker));
});
if (newIndex.length !== outputs.length) throw new Error('목록 구성 오류');
const indexBody = JSON.stringify(newIndex) + '\n';
const summary = { run: RUN, until: UNTIL, appended: report.appended.length, unchanged: report.unchanged.length, stopped: report.stopped.length,
  barsAdded: report.appended.reduce((a, r) => a + r.added, 0), added: report.added.length, addedQuarantined: report.addedQuarantined.length };
const reportBody = JSON.stringify({ summary, ...report }, null, 1) + '\n';

if (mode === 'check') {
  for (const o of outputs) if (fs.readFileSync(fileOf(o.t), 'utf8') !== o.body) throw new Error('갱신 재현 불일치: ' + o.t);
  if (fs.readFileSync(path.join(root, 'data/stocks/index.json'), 'utf8') !== indexBody) throw new Error('종목 목록 재현 불일치');
  if (fs.readFileSync(path.join(dir, 'report.json'), 'utf8') !== reportBody) throw new Error('갱신 보고서 재현 불일치');
  console.log('덧붙이기 전 파일 + 보존 원문 → 종목 파일·목록·보고서 재현 일치');
} else if (mode === 'apply') {
  for (const o of outputs) {
    const target = fileOf(o.t);
    fs.writeFileSync(target + '.update.tmp', o.body, { flag: 'wx' }); fs.renameSync(target + '.update.tmp', target);
  }
  fs.writeFileSync(path.join(root, 'data/stocks/index.json'), indexBody);
  fs.writeFileSync(path.join(dir, 'report.json'), reportBody);
  console.log('적용 완료. 탐지·교재·평가를 다시 만들어야 합니다.');
}
console.log(JSON.stringify(summary, null, 2));
for (const s of report.stopped) console.log('멈춤:', s.ticker, s.name, '-', s.reason);
for (const s of report.addedQuarantined) console.log('추가했지만 격리:', s.ticker, s.name, `오류 ${s.issues}, 출처 문제 ${s.sourceConcerns}`);
