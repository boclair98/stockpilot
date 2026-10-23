// Financial display regression checks; no accounts, backend, or market requests.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const domain={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/portfolio-insights.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:domain});
const kr={symbol:'005930',name:'삼성전자',exchange:'KRX',market:'KR',currency:'KRW',quantity:10,currentPrice:10000,marketValue:100000,averagePrice:11000,profit:-10000,returnRate:-9.09};
const us={...kr,symbol:'AAPL',name:'애플',exchange:'NAS',market:'US',currency:'USD',quantity:2,currentPrice:250,marketValue:500,averagePrice:200,profit:100,returnRate:25};
const holdings=[kr,us];
let result=domain.portfolioRisk(holdings,{KRW:900000,USD:0},[]);
// A smaller USD absolute number can be the larger concentration; no conversion basis exists.
assert.equal(result.largest.symbol,'AAPL');assert.equal(result.concentration,100);
assert.equal(result.protectionCoverage.KRW,0);assert.equal(result.protectionCoverage.USD,0);
result=domain.portfolioRisk(holdings,{KRW:0,USD:0},[
  {symbol:'005930',exchange:'KRX',quantity:4,status:'ACTIVE'},
  {symbol:'005930',exchange:'KRX',quantity:10,status:'ACTIVE'},
  {symbol:'AAPL',exchange:'NAS',quantity:1,status:'ACTIVE'},
  {symbol:'AAPL',exchange:'NYS',quantity:2,status:'ACTIVE'},
  {symbol:'AAPL',exchange:'NAS',quantity:2,status:'CANCELED'},
]);
assert.equal(result.protectionCoverage.KRW,100);assert.equal(result.protectionCoverage.USD,50);
const empty=domain.portfolioRisk([],{KRW:100000000,USD:100000},[]);
assert.equal(empty.largest,null);assert.equal(empty.protectionCoverage.KRW,null);
assert.equal(empty.protectionCoverage.USD,null);assert.equal(empty.concentration,0);
const converted=domain.portfolioRisk([kr],{KRW:0,USD:0},[]);
assert.equal(converted.cashRatio.KRW,0);assert.equal(converted.cashRatio.USD,null);
assert.equal(empty.cashRatio.KRW,100);
assert.equal(domain.findHoldings(holdings,'삼성 전자','ALL','saved')[0].symbol,'005930');
assert.equal(domain.findHoldings(holdings,'005930','KR','saved').length,1);
assert.equal(domain.findHoldings(holdings,'AAPL','KR','saved').length,0);
assert.equal(domain.findHoldings(holdings,'nas','US','saved')[0].symbol,'AAPL');
assert.equal(domain.findHoldings(holdings,'','ALL','return-high')[0].symbol,'AAPL');
assert.equal(domain.findHoldings(holdings,'','ALL','return-low')[0].symbol,'005930');
assert.equal(holdings[0].symbol,'005930');
console.log('Portfolio currency separation, protection cap, search and sorting passed.');
