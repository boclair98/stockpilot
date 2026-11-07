/* eslint-disable @typescript-eslint/no-require-imports */
// Execute actual alert components and unchanged terminal input JSX in isolation.
// Attribute/step checks are not a substitute for a real browser form interaction.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const harnessSource = fs.readFileSync(path.join(__dirname, 'verify-workspace-audit.cjs'), 'utf8');
const boundary = harnessSource.indexOf('\nfunction workerStatus()');
assert(boundary > 0, 'Shared isolated harness boundary must exist');
const { harness, KR, US } = new Function('require', '__dirname', harnessSource.slice(0, boundary) + '\nreturn {harness,KR,US};')(require, __dirname);

function assertPriceAttributes(input, currency) {
  const base = currency === 'KRW' ? 1 : 0.01;
  assert.equal(input.min, String(base), `${currency} minimum must match its price increment`);
  assert.equal(input.step, String(base));
  // HTML uses min as the step base. Integer cents avoid floating-point residue.
  const minCents = Math.round(Number(input.min) * 100);
  const stepCents = Math.round(Number(input.step) * 100);
  for (const price of currency === 'KRW' ? [1, 70000, 81234] : [0.01, 123.45, 200]) {
    assert.equal((Math.round(price * 100) - minCents) % stepCents, 0, `${currency} ${price} must not have stepMismatch`);
  }
  assert(Number(input.min) > 0, 'zero/negative targets stay invalid');
}

for (const selected of [KR, US]) test(`${selected.currency} alert uses a compatible minimum/step in the actual rendered component`, async t => {
  const h = harness('components/InvestorTools.tsx', { selected, authenticated: true, onSelect() {}, onNotice() {}, onAlertSummary() {}, focusAlertsKey: 0 });
  t.after(h.unmount);
  h.render(); h.tick(); await h.flush();
  h.respond(0, { authenticated: true, watchlist: [], alerts: [], unreadAlerts: 0, push: { configured: false, deviceCount: 0 }, report: null, missions: [] });
  await h.flush();
  const input = h.nodes().find(node => node.type === 'input' && node.props['aria-label'] === '목표 가격');
  assert(input);
  assertPriceAttributes(input.props, selected.currency);
});

test('all four actual terminal price-input JSX elements retain compatible KRW/USD attributes', () => {
  const file = path.join(root, 'components/TradingTerminal.tsx');
  const source = fs.readFileSync(file, 'utf8');
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const inputs = [];
  const visit = node => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(parsed) === 'input'
      && node.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(parsed) === 'step'
        && attribute.initializer?.getText(parsed).includes('currency'))) inputs.push(node.getText(parsed));
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  assert.equal(inputs.length, 4, 'cover stop, limit, take-profit and stop-loss price inputs');
  // Extract, transpile and SSR the production JSX itself; financial handlers are not called.
  const fragment = `export function render(quote) { const triggerPrice='', limitPrice='', takeProfitPrice='', stopLossPrice=''; return [${inputs.join(',')}]; }`;
  const output = ts.transpileModule(fragment, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  vm.runInNewContext(`(function(require,exports){${output}\n})`, {})(require, exports);
  for (const quote of [KR, US]) {
    const controls = exports.render(quote);
    for (const control of controls) {
      assertPriceAttributes(control.props, quote.currency);
      const html = renderToStaticMarkup(React.cloneElement(control, { onChange() {} }));
      assert(html.includes(`min="${quote.currency === 'KRW' ? '1' : '0.01'}"`));
      assert(html.includes(`step="${quote.currency === 'KRW' ? '1' : '0.01'}"`));
    }
  }
});
