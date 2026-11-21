/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node regression runner. */
// Exercise the production navigation JSX. No real timers, API or account access.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
const jsx = (type, props) => ({type, props});
const runtime = {jsx, jsxs: jsx, Fragment: 'fragment'};
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props.children)] : [];
const links = tree => nodes(tree).filter(n => n.type === 'a');
const has = (tree, predicate) => nodes(tree).some(predicate);
const directory = '/?browse=all#market-rankings';
const icons = new Proxy({}, {get: (_, name) => String(name)});
function compile(text, imports, vars = {}) {
  const exports = {};
  const code = ts.transpileModule(text, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(`(function(require,exports){${code}\n})`, vars)(name => {
    if (name === 'react/jsx-runtime') return runtime;
    if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
    return imports[name];
  }, exports);
  return exports;
}
function mobile(pathname = '/', hash = '') {
  let open = false;
  const followed = [];
  const {default: render} = compile(source('components/MobileServiceNav.tsx'), {
    react: {
      useState: () => [open, value => {open = typeof value === 'function' ? value(open) : value;}],
      useCallback: fn => fn, useEffect() {}, useSyncExternalStore: () => hash,
    },
    'next/link': {default: 'a'}, 'next/navigation': {usePathname: () => pathname},
    '@/lib/dialog-focus': {useDialogFocus() {}}, 'lucide-react': icons,
    '@/lib/market-browse': {ALL_INSTRUMENTS_HREF: directory, followMarketBrowseLink: e => followed.push(e)},
  });
  return {render, followed};
}
const core = ['/', '/#favorite-board-title', '/#holdings', '/#decision-review'];
const extras = ['/learn', '/practice', '/league', '/growth', '/lounge', '/pricing'];
test('mobile keeps four primary destinations visible and the actual secondary sheet reachable', () => {
  const h = mobile('/', '#holdings');
  let tree = h.render();
  assert.deepEqual(links(tree).map(n => n.props.href), core);
  assert.equal(links(tree).find(n => n.props['aria-current'] === 'page').props.href, '/#holdings');
  nodes(tree).find(n => n.props['aria-controls'] === 'mobile-menu-sheet').props.onClick();
  tree = h.render();
  const dialog = nodes(tree).find(n => n.props.role === 'dialog');
  assert(dialog && dialog.props['aria-modal']);
  const optional = links(dialog);
  const hrefs = optional.map(n => n.props.href);
  assert.deepEqual([...hrefs].sort(), [directory,'/compare','/notifications','/account-tools',...extras,'/support','/profile','/guide','/privacy','/terms'].sort());
  assert.equal(hrefs.some(href => core.includes(href)), false);
  assert(nodes(dialog).filter(n => n.type === 'h3').length >= 2);
  optional.find(n => n.props.href === directory).props.onClick('local-click');
  assert.deepEqual(h.followed, ['local-click']);
  assert(!has(h.render(), n => n.props.role === 'dialog'));
});
test('operations pages remain outside the mobile consumer menu', () => {
  assert.equal(mobile('/operations/workers').render(), null);
});

// Render the unchanged enclosing desktop JSX, not a duplicated conditional
// from the implementation; expensive/private children are sentinels.
function desktop() {
  const file = 'components/TradingTerminal.tsx';
  const parsed = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const find = (node, predicate) => predicate(node) ? node : ts.forEachChild(node, child => find(child, predicate));
  const box = find(parsed, n => ts.isJsxElement(n) && n.openingElement.attributes.properties.some(a =>
    ts.isJsxAttribute(a) && a.name.text === 'className' && a.initializer?.text === 'workspace-secondary'));
  assert(box, 'Secondary tool surface');
  const vars = {Link: 'a', focusSearch() {}, notify() {}, setEnvironmentOpen() {}};
  for (const tag of box.getText(parsed).matchAll(/<([A-Z]\w*)\b/g)) vars[tag[1]] ??= tag[1];
  return compile(`export const render = (workspaceView, environmentOpen, authenticated, accountState='ready') => {
    const portfolio={authenticated}; return ${box.getText(parsed)}; };`, {}, vars).render;
}
test('optional financial tools only mount on an explicitly opened visible market/watch panel', () => {
  const render = desktop();
  for (const view of ['MARKET','WATCH','DETAIL','ASSETS','RECORDS']) {
    for (const open of [false, true]) {
      const visible = open && ['MARKET','WATCH'].includes(view);
      const tree = render(view, open, false);
      for (const type of ['KospiBenchmarkCard','SimulationControlCenter']) assert.equal(has(tree, n => n.type === type), visible, `${type}: ${view}, ${open}`);
    }
  }
});
test('secondary services stay accessible to guests behind one native disclosure; onboarding is guest-only', () => {
  const render = desktop();
  const tree = render('MARKET', false, false);
  const block = nodes(tree).find(n => n.type === 'details' && has(n, item => item.type === 'a' && item.props.href === '/learn'));
  assert(block && !block.props.open && has(block, n => n.type === 'summary'));
  assert.deepEqual(links(block).map(n => n.props.href).sort(), [...extras].sort());
  const welcome = surface => nodes(surface).find(n => n.type === 'aside' && n.props.className?.includes('broker-welcome'));
  assert(links(welcome(tree)).some(n => n.props.href === '/guide'));
  assert(has(welcome(tree), n => n.type === 'button' && typeof n.props.onClick === 'function'));
  assert(!welcome(render('MARKET', false, true)) && !welcome(render('MARKET', false, false, 'loading')));
});
