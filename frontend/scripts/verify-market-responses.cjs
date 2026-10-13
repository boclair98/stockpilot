const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname,'..');
function compile(file, extra = '', dependencies = {}) {
  const exports = {};
  const source = fs.readFileSync(path.join(root,file),'utf8') + extra;
  const code = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(code,{exports,Number,Date,URLSearchParams,fetch:async()=>({ok:true,json:async()=>payload}),require:id=>dependencies[id]||{}});
  return exports;
}
const identity = compile('lib/instrument-identity.ts');
const recovery = compile('lib/error-recovery.ts');
assert.equal(recovery.isChunkLoadError(new Error('Loading chunk 9564 failed.')),true);
assert.equal(recovery.isChunkLoadError(new Error('Failed to fetch dynamically imported module')),true);
assert.equal(recovery.isChunkLoadError(new Error('Order request failed')),false);
const valid = {id:'KR:KRX:005930',symbol:'005930',name:'삼성전자',exchange:'KRX',market:'KR',currency:'KRW',price:72000};
assert.equal(identity.isInstrument(valid),true);
for (const item of [null,{}, {...valid,currency:'USD'},{...valid,exchange:''}]) assert.equal(identity.isInstrument(item),false);
let payload;
const api = compile('components/RankedMarketBrowser.tsx','\nexport { load as testLoad };',{'@/lib/instrument-identity':identity});
(async()=> {
  payload = {items:[null,{},valid],asOf:'2026-10-13T01:00:00Z',hasMore:true,nextOffset:20};
  let page = await api.testLoad('KR','CAP','ALL',0,undefined,{});
  assert.equal(page.items.length,1); assert.equal(page.hasMore,true);
  for (const nextOffset of [0,-1,'20',null]) {
    payload = {...payload,nextOffset}; page = await api.testLoad('KR','CAP','ALL',0,undefined,{}); assert.equal(page.hasMore,false); assert.equal(page.nextOffset,null);
  }
  payload = {items:[],asOf:'2026-10-13T01:00:00Z',hasMore:true,nextOffset:20};
  page = await api.testLoad('KR','CAP','ALL',0,undefined,{}); assert.equal(page.hasMore,false);
  payload = {items:[valid],asOf:'invalid'};
  await assert.rejects(api.testLoad('KR','CAP','ALL',0,undefined,{}));
  payload = null;
  await assert.rejects(api.testLoad('KR','CAP','ALL',0,undefined,{}),/확인 가능한 목록/);
  console.log('PASS: malformed instruments, currency mismatch, non-progressing cursor, empty pages, invalid timestamp');
})().catch(error=>{console.error(error);process.exitCode=1;});
