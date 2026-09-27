// 로컬에 보관한 두 공급자 원문으로만 실행. 기본은 검토 보고서 생성, --apply로 승인한 복구 적용.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { expandStock } from '../src/lib/data-quality.js';
import { FIELDS, RECOVERY_POLICY, parseNaver, parseYahoo, recoverStock } from './lib/recovery.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const dir = path.join(root, 'data/recovery/2026-09-23');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const index = JSON.parse(fs.readFileSync(path.join(root, 'data/stocks/index.json'), 'utf8'));
const apply = process.argv.includes('--apply');
const check = process.argv.includes('--check');
const revise = process.argv.includes('--revise');
if (apply && check) throw new Error('--apply와 --check는 함께 쓸 수 없습니다.');
if (revise && !apply) throw new Error('--revise는 --apply와 함께 사용합니다. 원본 백업에서 다시 만들며 직전 적용 해시를 확인합니다.');
if (process.argv.slice(2).some((a) => !['--apply', '--check', '--revise'].includes(a))) throw new Error('지원 옵션: --apply, --check, --revise');
const previousReport = revise ? fs.readFileSync(path.join(dir, 'report.json')) : null;
const previous = previousReport ? JSON.parse(previousReport) : null;
const outputs = [], reports = [];
function source(provider, ticker) {
  const stem = `${provider}-${ticker}-2015-01-01-2026-08-28`;
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'raw', stem + '.json'), 'utf8'));
  if (meta.rawFile !== stem + '.txt.gz' || meta.ticker !== ticker || meta.provider !== provider) throw new Error('출처 식별자 오류');
  const bytes = gunzipSync(fs.readFileSync(path.join(dir, 'raw', meta.rawFile)));
  if (sha(bytes) !== meta.sha256) throw new Error('원문 해시 불일치: ' + stem);
  return { meta, text: bytes.toString('utf8') };
}
for (const entry of index.filter((s) => s.market === 'KR' && s.type === 'stock')) {
  const target = path.join(root, 'data/stocks', entry.ticker + '.json');
  const bytes = check || revise ? gunzipSync(fs.readFileSync(path.join(dir, 'originals', entry.ticker + '.json.gz'))) : fs.readFileSync(target);
  if (revise) {
    const p = previous.reports.find((r) => r.ticker === entry.ticker);
    if (!p || sha(bytes) !== p.originalSha256 || sha(fs.readFileSync(target)) !== p.candidateSha256) throw new Error('직전 복구 이후 파일 변경: ' + entry.ticker);
  }
  const old = JSON.parse(bytes);
  if (old.provenance?.recoveryRun === '2026-09-23') throw new Error('이미 적용된 복구입니다. 보존 원본을 기준으로 별도 실행을 준비하세요.');
  const y = source('yahoo', entry.ticker), n = source('naver', entry.ticker);
  const recovery = recoverStock(expandStock(old), parseYahoo(y.text, entry.ticker), parseNaver(n.text));
  const { candidate, ...detail } = recovery;
  const provenance = { recoveryRun: '2026-09-23', recoveryPolicy: RECOVERY_POLICY, originalSha256: sha(bytes),
    sources: [y.meta, n.meta], priceBasis: 'Yahoo quote 기준; Naver 대조 복구는 주변 일치 봉 8개 이상의 조정 배율 검증',
    volumeBasis: 'Yahoo 분할 이벤트의 이후 누적 배율을 Naver 거래량에 적용; 주변 일치 봉에서 확인',
    corrections: detail.corrections.length, sourceRefresh: detail.sourceRefresh.length,
    nonTradingRemoved: detail.removedNonTrading.length,
    missingSessionsUnresolved: detail.missingCandidates.length, report: 'data/recovery/2026-09-23/report.json' };
  const restored = { ...old, format: 2, fields: FIELDS, candles: candidate.candles.map((c) => FIELDS.map((k) => c[k])), dataQuality: candidate.dataQuality, provenance };
  const body = JSON.stringify(restored) + '\n';
  reports.push({ ticker: entry.ticker, name: entry.name, originalSha256: sha(bytes), candidateSha256: sha(body), ...detail });
  outputs.push({ target, bytes, body, ticker: entry.ticker, count: candidate.candles.length, from: candidate.candles[0].date, to: candidate.candles.at(-1).date });
}
const summary = { policy: RECOVERY_POLICY, stocks: reports.length,
  eligibleBefore: reports.filter((r) => r.beforeQuality.eligible).length,
  eligibleAfter: reports.filter((r) => r.afterQuality.eligible).length,
  invalidBefore: reports.reduce((a, r) => a + r.beforeQuality.issues.length, 0),
  invalidAfter: reports.reduce((a, r) => a + r.afterQuality.issues.length, 0),
  crossSourceCorrections: reports.reduce((a, r) => a + r.corrections.length, 0),
  missingSessionsRestored: reports.reduce((a, r) => a + r.corrections.filter((c) => c.reason === 'missing-session').length, 0),
  placeholderCandlesRestored: reports.reduce((a, r) => a + r.corrections.filter((c) => c.reason === 'zero-volume-placeholder').length, 0),
  nonTradingRemoved: reports.reduce((a, r) => a + r.removedNonTrading.length, 0),
  sourceRefresh: reports.reduce((a, r) => a + r.sourceRefresh.length, 0),
  unresolvedMissing: reports.reduce((a, r) => a + r.missingCandidates.length, 0),
  sourceConcerns: reports.reduce((a, r) => a + r.afterQuality.sourceConcerns.length, 0) };
const reportBody = JSON.stringify({ summary, reports }) + '\n';
if (!check) {
  if (revise) fs.writeFileSync(path.join(dir, previous.summary.policy + '-report.json.gz'), gzipSync(previousReport), { flag: 'wx' });
  fs.writeFileSync(path.join(dir, 'report.json'), reportBody);
}
else {
  for (const output of outputs) {
    if (fs.readFileSync(output.target, 'utf8') !== output.body) throw new Error('복구 재현 불일치: ' + output.ticker);
  }
  if (fs.readFileSync(path.join(dir, 'report.json'), 'utf8') !== reportBody) throw new Error('복구 보고서 재현 불일치');
  const originalIndex = JSON.parse(gunzipSync(fs.readFileSync(path.join(dir, 'originals', 'index.json.gz'))));
  for (const output of outputs) Object.assign(originalIndex.find((s) => s.ticker === output.ticker), { count: output.count, from: output.from, to: output.to });
  if (JSON.stringify(originalIndex) !== JSON.stringify(index)) throw new Error('종목 인덱스 재현 불일치');
  console.log('보존 원본 + 두 공급자 원문 → 92종목·인덱스·복구 보고서 재현 일치');
}
console.log(JSON.stringify(summary, null, 2));
console.log('남은 오류 종목:', reports.filter((r) => !r.afterQuality.eligible).map((r) => r.ticker).join(', '));
if (apply) {
  const backups = path.join(dir, 'originals');
  fs.mkdirSync(backups, { recursive: true });
  // 덮어쓰기 전에 전체 원본부터 보존한다. 실패 시 원본과 보고서로 복원할 수 있다.
  if (!revise) {
    for (const output of outputs) fs.writeFileSync(path.join(backups, output.ticker + '.json.gz'), gzipSync(output.bytes), { flag: 'wx' });
    fs.writeFileSync(path.join(backups, 'index.json.gz'), gzipSync(fs.readFileSync(path.join(root, 'data/stocks/index.json'))), { flag: 'wx' });
  }
  for (const output of outputs) {
    if (sha(gunzipSync(fs.readFileSync(path.join(backups, output.ticker + '.json.gz')))) !== sha(output.bytes)) throw new Error('백업 검증 실패: ' + output.ticker);
    const expected = revise ? previous.reports.find((r) => r.ticker === output.ticker).candidateSha256 : sha(output.bytes);
    if (sha(fs.readFileSync(output.target)) !== expected) throw new Error('작업 중 원자료 변경: ' + output.ticker);
  }
  for (const output of outputs) {
    fs.writeFileSync(output.target + '.recovery.tmp', output.body, { flag: 'wx' });
    fs.renameSync(output.target + '.recovery.tmp', output.target);
    Object.assign(index.find((s) => s.ticker === output.ticker), { count: output.count, from: output.from, to: output.to });
  }
  fs.writeFileSync(path.join(root, 'data/stocks/index.json'), JSON.stringify(index) + '\n');
  console.log('원본 보존 후 복구 적용 완료. 패턴 통계는 별도로 재생성해야 합니다.');
}
