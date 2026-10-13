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
const timeline = load('OrderTimeline');
const orders = Array.from({length: 25}, (_, i) => ({id: String(i), symbol: i % 2 ? 'AAPL' : '005930', exchange: i % 2 ? 'NAS' : 'KRX', side: i % 2 ? 'SELL' : 'BUY', status: i % 3 ? 'FILLED' : 'OPEN', quantity: 1, fillPrice: null, createdAt: new Date(2026, 0, i + 1).toISOString()}));
function render(component, props, values) { states = values; cursor = 0; return nodes(component(props)); }
let result = render(timeline, {orders}, ['', 'ALL', 'ALL', 20]);
assert.equal(result.filter(n => n.type === 'li').length, 20);
assert(result.some(n => n.type === 'button' && n.props.className === 'ranked-more'));
result = render(timeline, {orders}, [' aapl ', 'SELL', 'FILLED', 20]);
assert.equal(result.filter(n => n.type === 'li').length, 8);
result = render(timeline, {orders}, ['MISSING', 'ALL', 'ALL', 20]);
assert(result.some(n => n.type === 'b' && n.props.children === '조건에 맞는 주문이 없어요'));
const watchlist = load('MarketWatchlist');
const items = [{id:'a',name:'A',market:'US',changePercent:undefined},{id:'b',name:'B',market:'KR',changePercent:-2},{id:'c',name:'C',market:'US',changePercent:0}];
result = render(watchlist, {items}, ['ALL','change']);
assert.equal(result.filter(n => n.props?.stock).map(n => n.props.stock.id).join(','), 'c,b,a');
result = render(watchlist, {items}, ['KR','name']);
assert.equal(result.filter(n => n.props?.stock).map(n => n.props.stock.id).join(','), 'b');
assert.equal(items.map(i => i.id).join(','), 'a,b,c');
console.log('PASS: pagination, combined filters, no-match state, missing-price ordering, market filter, immutable input');
