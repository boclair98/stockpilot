const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname,'../lib/stock-comparison.ts'),'utf8');
const exportsApi = {};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:exportsApi});
const {normalizeHistory,compareHistories,parseComparisonIds,practiceInvestment} = exportsApi;
const a = normalizeHistory([{date:'20260103',close:90},{date:'20260101',close:100},{date:'20260102',close:120},null,{date:'20260230',close:999},{date:'20260104',close:0}]);
assert.equal(a.length,3);
const b = normalizeHistory([{date:'2026-01-01',close:200},{date:'2026-01-02',close:200},{date:'2026-01-03',close:220},{date:'2026-01-04',close:300}]);
const comparison = compareHistories([a,b],20);
assert.equal(comparison.dates.length,3);
assert.ok(Math.abs(comparison.series[0].returnRate+10)<1e-9);
assert.equal(comparison.series[0].maxDrawdown,-25);
assert.ok(Math.abs(comparison.series[1].returnRate-10)<1e-9);
assert.equal(compareHistories([a,[]],20),null);
assert.equal(compareHistories([a,[{date:'2026-02-01',close:100}]],20),null);
const gap = compareHistories([
  [{date:'2026-01-01',close:100},{date:'2026-01-02',close:60},{date:'2026-01-03',close:110}],
  [{date:'2026-01-01',close:200},{date:'2026-01-03',close:210}],
],20);
assert.equal(gap.dates.length,2);
assert.equal(gap.series[0].maxDrawdown,-40);
assert.equal(parseComparisonIds('KR:KRX:005930,KR:KRX:005930,US:NAS:AAPL,US:BAD:TSLA,KR:KRX:123').length,2);
let result = practiceInvestment(1000,120,90,'KRW');
assert.equal(result.quantity,8);assert.equal(result.remaining,40);assert.equal(result.final,760);assert.equal(result.profit,-240);
result = practiceInvestment(100,19.99,20.01,'USD');
assert.equal(result.quantity,5);assert.equal(result.remaining,.05);assert.equal(result.final,100.10);
assert.equal(practiceInvestment(0,120,90,'KRW'),null);
assert.equal(practiceInvestment(10,120,90,'KRW').quantity,0);
console.log('PASS: shared-date alignment, no invented prices, drawdown, URL validation, whole shares, currency rounding, insufficient funds');
