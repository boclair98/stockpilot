/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS verification runner. */
// Isolated production helper/component tests; no accounts, backend or market requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(file, deps = {}) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => {
    if (Object.hasOwn(deps, name)) return deps[name];
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    throw new Error(`Unexpected dependency: ${name}`);
  }, Intl, Date });
  return exports;
}

const { confirmedSellCapacity, formatShares } = load('lib/sell-capacity.ts');
assert.deepEqual(
  JSON.parse(JSON.stringify(confirmedSellCapacity({
    quantity: 10.125,
    sellCapacity: { pendingOrderQuantity: 7.125, protectionQuantity: 1, availableQuantity: 2 },
  }, false))),
  { heldQuantity: 10.125, pendingOrderQuantity: 7.125, protectionQuantity: 1, availableQuantity: 2 },
);
assert.equal(confirmedSellCapacity(undefined, false), null);
assert.equal(confirmedSellCapacity(undefined, true)?.availableQuantity, 0);
assert.equal(confirmedSellCapacity({ quantity: 10 }, true), null);
for (const invalid of [
  { pendingOrderQuantity: 7, protectionQuantity: 1, availableQuantity: 9 },
  { pendingOrderQuantity: -1, protectionQuantity: 0, availableQuantity: 11 },
  { pendingOrderQuantity: '7', protectionQuantity: 1, availableQuantity: 2 },
  { pendingOrderQuantity: 7, protectionQuantity: 1, availableQuantity: NaN },
  { pendingOrderQuantity: 0, protectionQuantity: 0, availableQuantity: 10.00000001 },
]) {
  assert.equal(confirmedSellCapacity({ quantity: 10, sellCapacity: invalid }, true), null);
}
assert.equal(confirmedSellCapacity({
  quantity: 10,
  sellCapacity: { pendingOrderQuantity: 8, protectionQuantity: 3, availableQuantity: 0 },
}, true)?.availableQuantity, 0);
assert.equal(formatShares(1234.123456), '1,234.123456주');

const insights = load('lib/portfolio-insights.ts');
const identity = load('lib/instrument-identity.ts');
const validation = load('lib/trading-validation.ts', { './instrument-identity': identity });
const orderHistory = load('lib/order-history.ts');
const { default: HoldingsPanel } = load('components/HoldingsPanel.tsx', {
  '@/lib/portfolio-insights': insights,
  '@/lib/order-history': orderHistory,
  './StockLogo': { default: () => null },
  'next/link': { default: props => React.createElement('a', props) },
  'lucide-react': { ChevronRight: () => null },
});
const original = { symbol: 'AAPL', name: '애플', exchange: 'NAS', market: 'US', currency: 'USD', quantity: 2, averagePrice: 10, currentPrice: 10, marketValue: 20, profit: 0, returnRate: 0 };
const cost = { ...original, symbol: 'COST_FIXTURE', valuationBasis: 'COST', quoteAsOf: null };
const quoted = { ...original, currentPrice: 12.5, marketValue: 25, profit: 5, returnRate: 25, valuationBasis: 'QUOTE', quoteAsOf: '2024-01-02T03:04:05+00:00' };
const loser = { ...quoted, symbol: 'LOSS_FIXTURE', currentPrice: 8, marketValue: 16, profit: -4, returnRate: -20 };
const positions = [cost, loser, quoted];
const before = JSON.stringify(positions);
assert.deepEqual(Array.from(insights.findHoldings(positions, '', 'ALL', 'return-high'), row => row.symbol), ['AAPL', 'LOSS_FIXTURE', 'COST_FIXTURE']);
assert.deepEqual(Array.from(insights.findHoldings(positions, '', 'ALL', 'return-low'), row => row.symbol), ['LOSS_FIXTURE', 'AAPL', 'COST_FIXTURE']);
assert.equal(insights.findHoldings(positions, '', 'ALL', 'saved')[0], cost);
assert.equal(JSON.stringify(positions), before, 'display sorting must not mutate values or account rows');
assert.equal(insights.findHoldings([original, loser], '', 'ALL', 'return-high')[0], original, 'old server metadata remains optional');
assert.equal(insights.holdingQuoteTime(cost), null);
assert.equal(insights.holdingQuoteTime(original), null);
assert.equal(insights.holdingQuoteTime({ ...quoted, quoteAsOf: 'bad' }), null);
assert.match(insights.holdingQuoteTime(quoted), /2024.*01.*02.*12:04/);

const portfolio = rows => ({ authenticated: true, cash: { KRW: 1000, USD: 100 }, positions: rows, orders: [], protections: [] });
assert.equal(validation.isValidPortfolio(portfolio([original])), true);
assert.equal(validation.isValidPortfolio({ ...portfolio(positions), estimatedPositions: 1 }), true);
assert.equal(validation.isValidPortfolio({ ...portfolio([]), positionCoverageComplete: false }), true);
for (const badCoverage of [null, "false", 0, []]) assert.equal(validation.isValidPortfolio({ ...portfolio([]), positionCoverageComplete: badCoverage }), false);
assert.equal(validation.isValidPortfolio(portfolio([{ ...quoted, quoteAsOf: null }])), true);
for (const valuationBasis of ['LIVE', '', null, 1]) assert.equal(validation.isValidPortfolio(portfolio([{ ...quoted, valuationBasis }])), false);
for (const quoteAsOf of ['bad', 1, {}]) assert.equal(validation.isValidPortfolio(portfolio([{ ...quoted, quoteAsOf }])), false);
for (const estimatedPositions of [-1, 0.5, 4, NaN, '1', null]) assert.equal(validation.isValidPortfolio({ ...portfolio(positions), estimatedPositions }), false);

const render = (rows, overrides = {}) => renderToStaticMarkup(React.createElement(HoldingsPanel, { positions: rows, readState: "ready", incomplete: false, refreshing: false, onRetry: () => {}, onSelect: async () => {}, ...overrides }));
const costMarkup = render([cost]);
assert.match(costMarkup, /매입금액 기준 참고액/);
assert.match(costMarkup, /시세 미확인 · 손익 확인 불가/);
assert.match(costMarkup, /시세 미확인 1종목/);
assert.doesNotMatch(costMarkup, /0\.00%/);
assert.doesNotMatch(costMarkup, /class="(?:up|down)"/);
assert.match(costMarkup, /aria-describedby="holding-info-NAS-COST_FIXTURE holding-value-NAS-COST_FIXTURE"/);
const quoteMarkup = render([quoted]);
assert.match(quoteMarkup, /dateTime="2024-01-02T03:04:05\+00:00"/);
assert.match(quoteMarkup, /25\.00%/);
assert.match(quoteMarkup, /시세 기준/);
assert.doesNotMatch(quoteMarkup, /손익 확인 불가/);
assert.match(render([{ ...quoted, quoteAsOf: null }]), /시세 기준 시각 미제공/);
assert.match(render([original]), /평가 기준 미제공/);
assert.match(render([original]), /0\.00%/);
assert.match(render([]), /아직 보유한 주식이 없어요/);
assert.match(render([], { readState: "loading" }), /보유 주식을 확인하고 있어요/);
assert.match(render([], { readState: "unavailable" }), /보유 주식을 확인하지 못했어요/);
assert.match(render([quoted], { readState: "guest" }), /Google로 로그인/);
assert.doesNotMatch(render([quoted], { readState: "guest" }), /25\.00%/);
assert.match(render([quoted], { readState: "previous" }), /마지막으로 확인한 보유 주식/);
assert.match(render([quoted], { readState: "previous" }), /25\.00%/);
assert.match(render([], { incomplete: true }), /일부 보유 종목을 확인하지 못했어요/);
for (const overrides of [{readState:"loading"}, {readState:"unavailable"}, {readState:"guest"}, {readState:"previous"}, {incomplete:true}]) {
  assert.doesNotMatch(render([], overrides), /아직 보유한 주식이 없어요/);
}
console.log('Holding valuation metadata, backward compatibility, cost-last sorting and honest rendered states passed.');
