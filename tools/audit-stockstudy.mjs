// Read-only review diagnostics. Does not change application data.
import fs from 'node:fs';
import { detectStock } from '../src/lib/engine.js';
import { summarize, baseline } from '../src/lib/stats.js';
import { sma, closes, ichimoku, cloudBounds } from '../src/lib/indicators.js';
import { rsi } from '../src/lib/oscillators.js';
const read = p => JSON.parse(fs.readFileSync(new URL('../'+p, import.meta.url), 'utf8'));
const list = read('data/stocks/index.json').filter(x => (x.type || 'stock') === 'stock');
const stocks = list.map(x => { const s=read('data/stocks/'+x.ticker.replaceAll('^','_')+'.json'); return {...s,candles:s.format===2?s.candles.map(r=>Object.fromEntries((s.fields||['date','open','high','low','close','volume']).map((k,i)=>[k,r[i]]))):s.candles}; });
const index=read('data/patterns/_index.json');
const merged={}; let badOHLC=0, badDate=0, zeroVolume=0;
for (const s of stocks) {
  s.candles.forEach((c,i)=>{ if(!(c.low<=Math.min(c.open,c.close)&&c.high>=Math.max(c.open,c.close)&&c.low>0&&c.volume>=0))badOHLC++; if(i&&c.date<=s.candles[i-1].date)badDate++; if(c.volume===0)zeroVolume++; });
  for(const [id,hits] of Object.entries(detectStock(s))) (merged[id]??=[]).push(...hits);
}
const rows=Object.entries(merged).map(([id,hits])=>({id,count:hits.length,partial:hits.filter(h=>h.outcome&&h.outcome.days<20).length,pending:hits.filter(h=>!h.outcome).length,stored:index.patterns.find(p=>p.pattern===id)?.count,stats:summarize(hits),full20:summarize(hits.filter(h=>h.outcome?.days===20))}));
console.log(JSON.stringify({stocks:stocks.length,candles:stocks.reduce((n,s)=>n+s.candles.length,0),badOHLC,badDate,zeroVolume,total:rows.reduce((n,r)=>n+r.count,0),partial:rows.reduce((n,r)=>n+r.partial,0),pending:rows.reduce((n,r)=>n+r.pending,0),baseline:baseline(stocks),mismatches:rows.filter(r=>r.count!==r.stored||JSON.stringify(r.stats)!==JSON.stringify(index.patterns.find(p=>p.pattern===r.id)?.stats)),partialExamples:rows.filter(r=>r.partial).map(r=>({id:r.id,partial:r.partial,all:r.stats.winRate,full:r.full20?.winRate})).slice(0,12)},null,2));
// 아래는 수정 전의 '표시 구간부터 다시 계산' 결함을 재현하는 비교다.
// 현재 UI의 수정 결과는 tests/learning.test.mjs에서 전체 이력과 비교한다.
for(const id of ['golden-cross','ma-alignment','cloud-breakout','rsi-bullish-divergence']) {
  const hits=read('data/patterns/'+id+'.json').hits; let absent=0,errors=[];
  for(const h of hits){const s=stocks.find(s=>s.ticker===h.ticker);const v=s.candles.filter(c=>c.date>=h.fromDate&&c.date<=h.toDate);const j=v.findIndex(c=>c.date===h.date);const k=s.candles.findIndex(c=>c.date===h.date);const fn=['golden-cross','ma-alignment'].includes(id)?c=>sma(closes(c),60):id==='cloud-breakout'?c=>cloudBounds(ichimoku(c)).top:c=>rsi(closes(c));const a=fn(v)[j],b=fn(s.candles)[k];if(a==null)absent++;else errors.push(Math.abs(a-b));}
  console.log(JSON.stringify({legacyCroppedCalculation:id,sampled:hits.length,missingAtSignal:absent,maxDifference:Math.max(0,...errors)}));
}
console.log(JSON.stringify({partialExample:Object.values(merged).flat().find(h=>h.outcome&&h.outcome.days<20)}));
const bad=[];
for(const s of stocks) for(const c of s.candles) if(!(c.low<=Math.min(c.open,c.close)&&c.high>=Math.max(c.open,c.close)&&c.low>0&&c.volume>=0)) bad.push({ticker:s.ticker,...c});
console.log(JSON.stringify({invalidExamples:bad.slice(0,8),invalidTickers:[...new Set(bad.map(x=>x.ticker))]}));
const obvTests=[];
for(const s of stocks.slice(0,8)){
  const cut=500, sub={...s,candles:s.candles.slice(cut)};
  const det=detectStock(sub);
  for(const id of ['obv-bullish-divergence','obv-bearish-divergence']){
    const a=merged[id].filter(h=>h.ticker===s.ticker&&h.index>cut+120).map(h=>h.date);
    const b=det[id].filter(h=>h.index>120).map(h=>h.date);
    const onlyA=a.filter(d=>!b.includes(d)),onlyB=b.filter(d=>!a.includes(d));
    if(onlyA.length||onlyB.length)obvTests.push({ticker:s.ticker,id,onlyFull:onlyA.length,onlyTruncated:onlyB.length,example:onlyA[0]||onlyB[0]});
  }
}
console.log(JSON.stringify({obvHistorySensitivity:obvTests}));
