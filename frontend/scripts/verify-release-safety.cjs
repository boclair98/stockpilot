/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS verification harness. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname,'..');
let fetchImpl, calls = 0;
function compile(file, dependencies={}) {
  const exports={};
  const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  vm.runInNewContext(code,{exports,require:id=>dependencies[id],fetch:(...args)=>{calls++;return fetchImpl(...args);},AbortController,setTimeout,clearTimeout,Date,Number});
  return exports;
}
const identity=compile('lib/instrument-identity.ts');
const validation=compile('lib/trading-validation.ts',{'./instrument-identity':identity});
const {describeOrderReceipt}=compile('lib/order-receipt.ts');
const request=compile('lib/reliable-request.ts');
(async()=>{
  const quote={id:'KR:KRX:005930',name:'삼성전자',symbol:'005930',market:'KR',currency:'KRW',exchange:'KRX',price:72000,change:100,changePercent:1,asOf:'2026-10-14T00:00:00Z'};
  assert.equal(validation.isValidQuote(quote),true);
  for(const broken of [{...quote,price:NaN},{...quote,price:0},{...quote,asOf:'invalid'},{...quote,currency:'USD'}]) assert.equal(validation.isValidQuote(broken),false);
  const portfolio={authenticated:true,cash:{KRW:100000000,USD:100000},positions:[],orders:[],protections:[]};
  assert.equal(validation.isValidPortfolio(portfolio),true);
  for(const broken of [null,{}, {...portfolio,cash:{KRW:NaN,USD:1}},{...portfolio,positions:[null]}]) assert.equal(validation.isValidPortfolio(broken),false);
  assert.equal(validation.isOrderReceipt({id:'order',status:'FILLED',fillPrice:123.45,currency:'USD'}),true);
  assert.equal(validation.isOrderReceipt({id:'order',status:'FILLED',fillPrice:null,currency:'USD'}),false);
  assert.equal(validation.isOrderReceipt({id:'order',status:'MAYBE',currency:'USD'}),false);
  const triggered={id:'triggered-order',status:'TRIGGERED',fillPrice:null,currency:'KRW'};
  assert.equal(validation.isOrderReceipt(triggered),true,'valid stop-limit acknowledgement must not become uncertain');
  const neverFormat=()=>assert.fail('pending receipt does not have a fill price');
  const pending=describeOrderReceipt(triggered,'삼성전자',neverFormat);
  assert.equal(pending.kind,'pending');
  assert.equal(pending.id,triggered.id);
  assert.match(pending.message,/조건 충족 · 체결 대기/);
  assert.equal(describeOrderReceipt({...triggered,status:'OPEN'},'삼성전자',neverFormat).kind,'pending');
  assert.equal(describeOrderReceipt({...triggered,status:'REJECTED'},'삼성전자',neverFormat).kind,'error');
  assert.equal(describeOrderReceipt({...triggered,status:'FILLED',fillPrice:123},'삼성전자',p=>`${p}원`).message,'삼성전자 모의주문이 123원에 체결됐어요.');
  for(const invalid of [{...triggered,status:['TRIGGERED']},{...triggered,detail:{bad:true}},{...triggered,fillPrice:'0'},{...triggered,id:'   '}]) {
    assert.equal(validation.isOrderReceipt(invalid),false);
  }
  fetchImpl=async()=>({ok:true,status:200,json:async()=>({ok:true})});
  await request.requestJson('/test');
  fetchImpl=async()=>({ok:false,status:401,json:async()=>({detail:'로그인 필요'})});
  await assert.rejects(request.requestJson('/test'),e=>e.status===401&&!e.uncertain);
  fetchImpl=async()=>({ok:false,status:503,json:async()=>({})});
  await assert.rejects(request.requestJson('/test',{method:'POST'}),e=>e.status===503&&e.uncertain);
  fetchImpl=async()=>({ok:true,status:201,json:async()=>{throw new Error('invalid');}});
  await assert.rejects(request.requestJson('/test',{method:'POST'}),e=>e.uncertain);
  let before=calls;
  fetchImpl=async()=>{throw new Error('offline');};
  await assert.rejects(request.requestJson('/test',{method:'POST'}),e=>e.uncertain);
  assert.equal(calls-before,1,'mutation must never automatically retry');
  fetchImpl=(_,opts)=>new Promise((resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(new Error('aborted'))));
  await assert.rejects(request.requestJson('/test',{method:'POST'},10),e=>e.uncertain);
  const throwing={getItem(){throw new Error('denied');},setItem(){throw new Error('quota');},removeItem(){throw new Error('denied');}};
  assert.deepEqual(request.readStored(throwing,'key',[]),[]);
  assert.equal(request.writeStored(throwing,'key',{}),false);
  console.log('PASS: bounded requests, no mutation retry, uncertain outcomes, malformed money/quotes/receipts, blocked storage');
})().catch(e=>{console.error(e);process.exitCode=1;});
