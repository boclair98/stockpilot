/* eslint-disable @typescript-eslint/no-require-imports */
// Run the real component and bounded request helper with isolated reads/timers.
// No production service, account, saved item, or order is touched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const jsx = (type, props) => ({type, props});
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
const content = tree => Array.isArray(tree) ? tree.map(content).join(' ') : tree && typeof tree === 'object' ? content(tree.props?.children) : typeof tree === 'string' ? tree : '';
const instrument = (symbol, name) => ({id: `KR:KRX:${symbol}`, symbol, name, englishName: '', market: 'KR', currency: 'KRW', exchange: 'KRX'});
const first = instrument('005930', '격리 테스트 종목 하나');
const second = instrument('000660', '격리 테스트 종목 둘');

function harness() {
  const slots = [], requests = [], chosen = [], listeners = new Map(), timers = new Map(), modules = new Map();
  let cursor = 0, effects = [], dirty = false, tree, now = 0, timerId = 0;
  const same = (a, b) => a && b && a.length === b.length && b.every((value, index) => Object.is(value, a[index]));
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = {value: typeof initial === 'function' ? initial() : initial};
      return [slots[index].value, value => {
        const next = typeof value === 'function' ? value(slots[index].value) : value;
        if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; }
      }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ||= {current: initial}; },
    useCallback(fn, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) slots[index] = {value: fn, deps}; return slots[index].value; },
    useEffect(fn, deps) {
      const index = cursor++, previous = slots[index];
      if (!same(previous?.deps, deps)) effects.push(() => { previous?.cleanup?.(); slots[index] = {deps, cleanup: fn()}; });
    },
  };
  const context = vm.createContext({
    AbortController, URLSearchParams, Error,
    document: {getElementById: () => ({scrollIntoView() {}})},
    window: {
      addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
      removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    },
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, {fn, at: now + delay, delay}); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch(url, init) {
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      const request = {url, init, resolve, reject, ignoreAbort: false};
      requests.push(request);
      init.signal.addEventListener('abort', () => { if (!request.ignoreAbort) reject(new Error('aborted')); }, {once: true});
      return promise;
    },
  });
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const exports = {}; modules.set(file, exports);
    const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
      compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX},
    }).outputText;
    vm.runInContext(`(function(require,exports){${source}\n})`, context)(name => {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return {jsx, jsxs: jsx, Fragment: 'fragment'};
      if (name === 'lucide-react') return new Proxy({}, {get: () => 'icon'});
      if (name === '@/lib/dialog-focus') return {useDialogFocus() {}};
      if (name === '@/lib/market-browse') return {ALL_INSTRUMENTS_HREF: '/?browse=all#market-rankings', followMarketBrowseLink() {}};
      if (name.startsWith('@/lib/')) return load(name.slice(2) + '.ts');
      throw new Error(`Unexpected import: ${name}`);
    }, exports);
    return exports;
  }
  const Component = load('components/CommandSearch.tsx').default;
  const render = () => { cursor = 0; effects = []; dirty = false; tree = Component({onChoose: async item => { chosen.push(item); }}); effects.forEach(fn => fn()); };
  const flush = async () => { for (let index = 0; index < 8; index++) { await new Promise(resolve => setImmediate(resolve)); if (dirty) render(); } };
  const all = () => nodes(tree);
  const button = label => { const result = all().find(node => node.type === 'button' && (node.props['aria-label'] === label || content(node).trim() === label)); assert(result, `Missing button: ${label}`); return result; };
  const input = () => { const result = all().find(node => node.type === 'input'); assert(result, 'Search input is not open'); return result; };
  render();
  return {
    requests, chosen, flush, input, button, all,
    text: () => content(tree),
    click(label) { button(label).props.onClick(); },
    type(value) { input().props.onChange({target: {value}}); },
    key(key, nativeEvent = {}) { input().props.onKeyDown({key, nativeEvent, preventDefault() {}}); },
    toggle(metaKey = false) { listeners.get('keydown')?.forEach(fn => fn({key: 'k', ctrlKey: !metaKey, metaKey, preventDefault() {}})); },
    tick(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; timers.delete(next[0]); next[1].fn();
      }
      now = end;
    },
    reply(index, value, status = 200) { assert(requests[index], `Missing request ${index}`); requests[index].resolve({ok: status >= 200 && status < 300, status, json: async () => value}); },
    timerDelays: () => [...timers.values()].map(timer => timer.delay),
    listenerCount: () => [...listeners.values()].reduce((sum, values) => sum + values.size, 0),
    unmount() { slots.forEach(slot => slot.cleanup?.()); },
  };
}

async function openWithResults(h, items = [first, second]) {
  h.click('빠른 종목 검색'); await h.flush();
  h.type('격리'); await h.flush(); h.tick(220);
  h.reply(h.requests.length - 1, {items}); await h.flush();
}

test('search dialog delegates focus to the shared focus trap instead of stealing the return target', async t => {
  const h = harness(); t.after(h.unmount);
  h.click('빠른 종목 검색'); await h.flush();
  assert.equal(h.input().props.autoFocus, undefined);
});

test('search has a 15-second bound, explicit retry, malformed-response and empty-result states', async t => {
  const h = harness(); t.after(h.unmount);
  h.click('빠른 종목 검색'); await h.flush(); h.type('격리'); await h.flush();
  h.tick(219); assert.equal(h.requests.length, 0, 'Typing is debounced');
  h.tick(1); assert.deepEqual(h.timerDelays(), [15000]);
  assert.equal(h.requests[0].init.cache, 'no-store');
  h.tick(15000); await h.flush();
  assert(h.requests[0].init.signal.aborted); assert(h.text().includes('검색을 불러오지 못했어요'));
  assert(!h.text().includes('종목을 찾고 있어요')); assert.equal(h.requests.length, 1, 'Timeout does not automatically retry');
  h.key('Enter'); assert.equal(h.chosen.length, 0);
  h.click('다시 검색'); await h.flush(); h.tick(220); h.reply(1, {items: null}); await h.flush();
  assert(h.text().includes('검색을 불러오지 못했어요'), 'Malformed payload is not presented as no matches');
  h.click('다시 검색'); await h.flush(); h.tick(220); h.reply(2, {items: []}); await h.flush();
  assert(h.text().includes('일치하는 종목이 없어요')); assert.equal(h.input().props['aria-expanded'], false);
  h.type('다른 검색'); await h.flush(); h.tick(220); h.reply(3, {items: [first]}); await h.flush();
  assert(h.text().includes(first.name)); assert.equal(h.input().props['aria-expanded'], true);
  assert(h.requests.every(request => !request.init.method || request.init.method === 'GET'));
});

test('IME confirmation never chooses a result; arrows and Enter still select exactly once', async t => {
  const h = harness(); t.after(h.unmount); await openWithResults(h);
  h.key('Enter', {isComposing: true}); h.key('Enter', {keyCode: 229});
  h.input().props.onCompositionStart(); h.key('ArrowDown'); h.key('Enter');
  await h.flush(); assert.equal(h.chosen.length, 0);
  assert.equal(h.input().props['aria-activedescendant'], 'command-result-0');
  h.input().props.onCompositionEnd(); h.key('ArrowDown'); await h.flush();
  assert.equal(h.input().props['aria-activedescendant'], 'command-result-1');
  h.key('ArrowUp'); await h.flush(); assert.equal(h.input().props['aria-activedescendant'], 'command-result-0');
  h.key('ArrowDown'); await h.flush();
  const keyHandler = h.input().props.onKeyDown;
  keyHandler({key: 'Enter', nativeEvent: {}, preventDefault() {}});
  keyHandler({key: 'Enter', nativeEvent: {}, preventDefault() {}});
  await h.flush(); assert.deepEqual(h.chosen.map(item => item.id), [second.id]);
  assert(!h.all().some(node => node.props?.role === 'dialog'));
});

test('editing a query invalidates old handlers immediately and ignores a late superseded response', async t => {
  const h = harness(); t.after(h.unmount); await openWithResults(h, [first]);
  const staleButton = h.all().find(node => node.props?.role === 'option');
  const staleKey = h.input().props.onKeyDown;
  h.type('새 검색');
  staleButton.props.onClick(); staleKey({key: 'Enter', nativeEvent: {}, preventDefault() {}});
  assert.equal(h.chosen.length, 0, 'Even before React commits, old results cannot be selected');
  await h.flush(); h.key('Enter'); h.tick(220); h.requests[1].ignoreAbort = true;
  h.type('최신 검색'); assert(h.requests[1].init.signal.aborted); await h.flush(); h.tick(220);
  h.reply(2, {items: [second]}); await h.flush();
  h.reply(1, {items: [first]}); await h.flush();
  assert(h.text().includes(second.name)); assert(!h.text().includes(first.name));
  h.key('Enter'); await h.flush(); assert.deepEqual(h.chosen.map(item => item.id), [second.id]);
});

test('closing and reopening retains the query but requires fresh results before selection', async t => {
  const h = harness(); t.after(h.unmount); await openWithResults(h);
  h.key('ArrowDown'); await h.flush();
  const oldOption = h.all().find(node => node.props?.id === 'command-result-1');
  h.click('검색 닫기'); oldOption.props.onClick(); await h.flush();
  h.toggle(true); await h.flush();
  assert.equal(h.input().props.value, '격리'); assert(h.text().includes('종목을 찾고 있어요'));
  assert.equal(h.input().props['aria-expanded'], false);
  assert.equal(h.input().props['aria-activedescendant'], undefined);
  oldOption.props.onClick(); h.key('Enter'); assert.equal(h.chosen.length, 0);
  h.tick(220); h.reply(1, {items: [first]}); await h.flush();
  assert.equal(h.input().props['aria-activedescendant'], 'command-result-0', 'A smaller refreshed list resets the active result');
  h.key('Enter'); await h.flush(); assert.deepEqual(h.chosen.map(item => item.id), [first.id]);
});

test('close, clear, and unmount cancel pending work without errors or late selections', async () => {
  const h = harness();
  h.toggle(); await h.flush();
  assert(h.all().some(node => node.type === 'a' && node.props.href === '/?browse=all#market-rankings'), 'Existing catalog shortcut stays intact');
  h.type('첫 검색'); await h.flush(); h.tick(220); h.toggle(); await h.flush();
  assert(h.requests[0].init.signal.aborted);
  h.toggle(); await h.flush(); h.tick(220); h.type(''); await h.flush();
  assert(h.requests[1].init.signal.aborted); assert(h.text().includes('바로가기')); assert(!h.text().includes('검색을 불러오지 못했어요'));
  h.tick(20000); assert.equal(h.requests.length, 2, 'Blank query never issues a read');
  h.type('마지막 검색'); await h.flush(); h.tick(220); h.unmount();
  assert(h.requests[2].init.signal.aborted); await h.flush();
  assert.equal(h.listenerCount(), 0); assert.equal(h.timerDelays().length, 0); assert.equal(h.chosen.length, 0);
});
