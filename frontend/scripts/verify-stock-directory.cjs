// Execute production URL/response helpers with deterministic isolated data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, deps={}) {
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports={}; vm.runInNewContext(code,{exports,require:name=>deps[name],URLSearchParams,Set,Date,Number,Error}); return exports;
}
const identity=load('lib/instrument-identity.ts');
const lib=load('lib/stock-directory.ts',{'./instrument-identity':identity});
const {mergeQuoteSnapshots}=load('lib/quote-snapshots.ts');
let passed=0;
function test(name,fn){fn();passed++;process.stdout.write(`PASS ${name}\n`);}
test('safe default and invalid URL criteria',()=>{
 const data=lib.parseDirectoryCriteria('?market=KR&exchange=NAS&limit=21&page=-8');
 assert.equal(data.exchange,'ALL');assert.equal(data.limit,20);assert.equal(data.page,1);
 assert.equal(lib.parseDirectoryCriteria('?page=1.2').page,1);
 assert.equal(lib.parseDirectoryCriteria('?limit=100&page=999999').page,501);
});
test('round-trip URL preserves search, exchange and last page',()=>{
 const data={market:'US',exchange:'NYS',q:'A & B',limit:100,page:129};
 const parsed=lib.parseDirectoryCriteria(lib.directorySearch(data));
 for(const key of Object.keys(data))assert.equal(parsed[key],data[key]);
 const url=new URL('https://example.test'+lib.directoryRequest(parsed,'v1'));
 assert.equal(url.searchParams.get('offset'),'12800');assert.equal(url.searchParams.get('snapshot'),'v1');
});
const criteria={market:'KR',exchange:'KOSDAQ',q:'',page:1,limit:20};
const item={id:'KR:KRX:0001A0',symbol:'0001A0',name:'덕양에너젠',market:'KR',exchange:'KRX',currency:'KRW',listingMarket:'KOSDAQ'};
const page={items:[item],total:1,universeTotal:1,offset:0,limit:20,market:'KR',exchange:'KOSDAQ',query:'',partial:false,snapshot:'v1',coverage:[{exchange:'KOSDAQ',available:true,loadedAt:'2026-10-27T00:00:00Z'}]};
test('letter codes and exact identity survive to existing detail URL',()=>{
 assert.equal(lib.validateDirectoryPage(page,criteria).items[0].symbol,'0001A0');
 const url=new URL('https://example.test'+lib.instrumentDetailHref(item));
 assert.equal(url.searchParams.get('symbol'),'0001A0');assert.equal(url.searchParams.get('exchange'),'KRX');
});
test('US share class slash is encoded, never changed into another instrument',()=>{
 const item={id:'US:NYS:BRK/B',symbol:'BRK/B',name:'버크셔 해서웨이 B',market:'US',exchange:'NYS',currency:'USD'};
 const data={...page,items:[item],market:'US',exchange:'NYS',coverage:[{exchange:'NYS',available:true,loadedAt:null}]};
 assert.equal(lib.validateDirectoryPage(data,{...criteria,market:'US',exchange:'NYS'}).items[0].symbol,'BRK/B');
 const url=new URL('https://example.test'+lib.instrumentDetailHref(item));
 assert.equal(url.pathname,'/');assert.equal(url.searchParams.get('symbol'),'BRK/B');
 const comparison=load('lib/stock-comparison.ts');
 assert.equal(comparison.parseComparisonIds('US:NYS:BRK/B')[0].symbol,'BRK/B');
});
test('rejects malformed, truncated, duplicated or cross-market data',()=>{
 for(const patch of [{items:null},{total:2},{offset:20},{market:'US'},{query:'other'},{snapshot:''},{items:[item,item],total:2,universeTotal:2},{items:[{...item,currency:'USD'}]},{items:[{...item,id:'KR:KRX:005930'}]},{coverage:[]},{coverage:[{exchange:'KOSDAQ',available:true,loadedAt:'bad'}]}])assert.throws(()=>lib.validateDirectoryPage({...page,...patch},criteria));
});
test('empty late page is distinct from empty entire universe',()=>{
 const data=lib.validateDirectoryPage({...page,offset:40,items:[],total:1},{...criteria,page:3});
 assert.equal(data.total,1);assert.equal(data.items.length,0);
});
test('partial catalog remains explicitly partial',()=>assert.equal(lib.validateDirectoryPage({...page,partial:true},criteria).partial,true));
test('late bootstrap/cache never erases a detail-only instrument or newer live price',()=>{
 const selected={id:'US:NYS:BRK/B',asOf:'2026-10-27T01:00:00Z',price:500,marketState:'OPEN'};
 const seed={id:'KR:KRX:005930',asOf:'2026-10-27T00:00:00Z',price:100};
 const current=[selected];const incoming=[seed];
 let result=mergeQuoteSnapshots(current,incoming);
 assert.equal(result.length,2);assert.equal(result[0],selected);assert.equal(current.length,1);assert.equal(incoming.length,1);
 result=mergeQuoteSnapshots(result,[{...selected,asOf:'2026-10-28T00:00:00Z',price:1,marketState:'CACHED'}]);
 assert.equal(result.find(q=>q.id===selected.id).price,500);
 result=mergeQuoteSnapshots(result,[{...selected,asOf:'2026-10-27T00:00:00Z',price:2}]);
 assert.equal(result.find(q=>q.id===selected.id).price,500);
 result=mergeQuoteSnapshots(result,[{...selected,asOf:'2026-10-27T01:01:00Z',price:501}]);
 assert.equal(result.find(q=>q.id===selected.id).price,501);
 assert.equal(mergeQuoteSnapshots(result,[{...selected,id:'US:NAS:BRK/B'}]).length,3);
 assert.equal(mergeQuoteSnapshots([{...selected,asOf:'2030-01-01T00:00:00Z',price:1,marketState:'CACHED'}],[selected])[0].price,500,'A live read must replace an untrusted future-dated browser cache');
});
console.log(`${passed} stock directory checks passed`);
