// Isolated component tests: no network, production accounts, or orders.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
let states = [], cursor = 0;
const jsx = (type, props) => ({ type, props });
function load(name) {
  const source = fs.readFileSync(`components/${name}.tsx`, 'utf8');
  const code = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX}}).outputText;
  const exports = {};
  vm.runInNewContext(code, {exports, require: id => {
    if (id === 'react') return {memo: fn => fn, useMemo: fn => fn(), useState: initial => [states[cursor++] ?? initial, () => {}]};
    if (id === 'react/jsx-runtime') return {jsx, jsxs: jsx};
    return {default: 'mock-component', History: 'icon', Star: 'icon'};
  }});
  return exports.default;
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function render(component, props, values) { states = values; cursor = 0; return nodes(component(props)); }
const watchlist = load('MarketWatchlist');
const items = [{id:'a',name:'애플',symbol:'AAPL',exchange:'NAS',market:'US',changePercent:undefined},{id:'b',name:'삼성전자',symbol:'005930',exchange:'KRX',market:'KR',changePercent:-2},{id:'c',name:'C',symbol:'C',exchange:'NYS',market:'US',changePercent:0}];
let result = render(watchlist, {items}, ['ALL','change','']);
assert.equal(result.filter(n => n.props?.stock).map(n => n.props.stock.id).join(','), 'c,b,a');
result = render(watchlist, {items}, ['KR','name','']);
assert.equal(result.filter(n => n.props?.stock).map(n => n.props.stock.id).join(','), 'b');
assert.equal(items.map(i => i.id).join(','), 'a,b,c');
result = render(watchlist, {items}, ['ALL','decline','']);
assert.equal(result.filter(n=>n.props?.stock).map(n=>n.props.stock.id).join(','),'b,c,a');
result = render(watchlist, {items}, ['ALL','saved','삼성 전자']);
assert.equal(result.filter(n=>n.props?.stock).map(n=>n.props.stock.id).join(','),'b');
result = render(watchlist, {items}, ['ALL','saved',' aapl ']);
assert.equal(result.filter(n=>n.props?.stock).map(n=>n.props.stock.id).join(','),'a');
const history = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/order-history.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:history,Intl,Date,Set,Number});
const row={id:'1',symbol:'005930',name:'삼성전자',exchange:'KRX',market:'KR',currency:'KRW',side:'BUY',orderType:'MARKET',quantity:2,status:'FILLED',fillPrice:72000,grossAmount:144000,fee:0,tax:0,realizedPnl:null,createdAt:'2026-10-21T16:00:00Z'};
const page={items:[row],hasMore:false,nextCursor:null,asOf:'2026-10-22T00:00:00Z'};
assert(history.validHistoryPage(page));
for (const bad of [{...page,items:[null]},{...page,hasMore:true},{...page,items:[{...row,quantity:NaN}]},{...page,items:[{...row,fillPrice:-1}]},{...page,items:[{...row,createdAt:'bad'}]}]) assert.equal(history.validHistoryPage(bad),false);
assert.equal(history.seoulDate(row.createdAt),'2026-10-22');
assert.equal(history.appendHistory([row],[row,{...row,id:'2'}]).length,2);
assert.equal(history.orderMoney(null,'KRW'),'—');
assert.equal(history.orderMoney(0,'KRW'),'₩0');
const csv=history.historyCsv([row,{...row,id:'2',name:' =HYPERLINK("evil")'}]);
assert(csv.startsWith('\uFEFF'));
assert(csv.includes(`"'005930"`));
assert(csv.includes(`"' =HYPERLINK(""evil"")"`));
assert(!history.historyCsv([{...row,status:'OPEN',grossAmount:144000}]).includes('"144000"'));
assert.equal(history.orderMoney(1.23,'USD'),'US$1.23');
assert.equal(history.orderMoney(22.05,'KRW'),'₩22.05');
assert.equal(history.orderMoney(.0005,'USD'),'US$0.0005');
console.log('PASS: watchlist search/sort, immutable inputs, response validation, KST dates, page dedupe, separate currencies, CSV safety and unfilled amounts');
