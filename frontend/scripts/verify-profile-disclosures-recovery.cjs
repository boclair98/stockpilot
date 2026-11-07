/* eslint-disable @typescript-eslint/no-require-imports */
// Execute the real hooks, render branches, URL builder and request wrapper.
// Only React scheduling/network/clock are isolated; no real account is accessed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const jsx = (type, props, key) => ({ type, props, key });
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
const text = tree => Array.isArray(tree) ? tree.map(text).join(' ') : tree && typeof tree === 'object' ? text(tree.props?.children) : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
const user = { coders_id: 'isolated-owner', display_name: '격리 검증 계정', email: null, picture: null };
const stamp = '2026-11-06T01:00:00Z';
const instrument = { id: 'KR:KRX:005930', symbol: '005930', name: '격리 검증 종목', market: 'KR', exchange: 'KRX', currency: 'KRW' };
const group = { instrument, items: [{ title: '격리 검증 공시', date: '20261106', receiptNo: 'test-filing', url: 'https://example.test/filing' }], source: 'DART', asOf: stamp };

function harness(target = 'profile', initial = true) {
  const slots = [], timers = new Map(), requests = [], modules = new Map();
  let cursor = 0, effects = [], dirty = false, tree, input = initial, timerId = 0;
  const react = {
    useState(initial) { const index = cursor++; if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[index].value, value => { const next = typeof value === 'function' ? value(slots[index].value) : value; if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; } }]; },
    useRef(initial) { const index = cursor++; if (!slots[index]) slots[index] = { current: initial }; return slots[index]; },
    useCallback(fn, deps) { const index = cursor++; if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { value: fn, deps }; return slots[index].value; },
    useEffect(effect, deps) { const index = cursor++, previous = slots[index]; if (!previous || !same(previous.deps, deps)) effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: effect() }; }); },
  };
  const context = vm.createContext({ URL, URLSearchParams, AbortController,
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch(url, init) { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); init.signal?.addEventListener('abort', () => reject(new Error('isolated abort')), { once: true }); requests.push({ url, init, resolve }); return promise; },
  });
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const output = {}; modules.set(file, output);
    const extra = file.endsWith('TradingTerminal.tsx') ? '\nexport { isTerminalProfile, useTerminalProfile, TerminalHistory, terminalDetailUrl, terminalValuationStatus };' : file.endsWith('PersonalWorkspace.tsx') ? '\nexport { Disclosures };' : '';
    const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8') + extra, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    vm.runInContext(`(function(require,exports){${source}\n})`, context)(id => {
      if (id === 'react') return react;
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
      if (id === 'lucide-react') return new Proxy({}, { get: () => 'icon' });
      if (id === 'next/dynamic') return { default: () => 'lazy-component' };
      if (id === 'next/link') return { default: 'a' };
      if (id.startsWith('@/lib/')) {
        if (/reliable-request|personal-response|personal-write|instrument-identity|market-browse|portfolio-insights/.test(id)) return load(`lib/${id.split('/').pop()}.ts`);
        return {};
      }
      if (file.startsWith('lib/') && id.startsWith('./')) return load(`lib/${id.slice(2)}.ts`);
      return { default: 'stub' };
    }, output);
    return output;
  }
  const terminal = load('components/TradingTerminal.tsx');
  const disclosures = target === 'disclosures' ? load('components/PersonalWorkspace.tsx').Disclosures : null;
  function render(next = input) { input = next; cursor = 0; effects = []; dirty = false; tree = disclosures ? disclosures() : terminal.useTerminalProfile(input); effects.forEach(effect => effect()); return tree; }
  async function flush() { for (let round = 0; round < 6; round++) { await new Promise(resolve => setImmediate(resolve)); if (dirty) render(); } }
  const view = () => disclosures ? tree : terminal.TerminalHistory({ profile: tree, onRetry: tree.retry });
  return { render, flush, load, terminal, requests, state: () => tree, view, nodes: () => nodes(view()), text: () => text(view()),
    respond(index, value, status = 200) { assert(requests[index], `missing request ${index}`); requests[index].resolve({ ok: status >= 200 && status < 300, status, json: async () => value }); },
    expire(ms) { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn(); } },
    button(label) { return nodes(view()).find(node => node.type === 'button' && text(node).replace(/\s+/g, ' ').trim() === label); },
    click(label) { const button = this.button(label); assert(button, `missing ${label}`); assert(!button.props.disabled, `${label} is disabled`); button.props.onClick(); },
    unmount() { slots.forEach(slot => slot.cleanup?.()); timers.clear(); },
  };
}

test('unknown authentication is loading, not a guest, and no profile read starts before the portfolio resolves', async t => {
  const h = harness('profile', null); t.after(h.unmount); h.render(); await h.flush();
  assert.equal(h.requests.length, 0); assert.equal(h.state().kind, 'loading');
  assert(h.text().includes('계정을 확인하고 있어요')); assert(!h.nodes().some(node => node.type === 'lazy-component'));
  h.render(false); await h.flush(); assert.equal(h.requests.length, 0); assert.equal(h.state().me, null);
  assert.equal(h.nodes().find(node => node.type === 'lazy-component').props.authenticated, false);
});

test('a bounded profile failure is not logout; explicit retry recovers account-keyed investment history', async t => {
  const h = harness(); t.after(h.unmount); h.render();
  h.expire(15000); await h.flush(); assert.equal(h.state().kind, 'error'); assert(h.text().includes('응답이 늦어'));
  assert(!h.nodes().some(node => node.type === 'lazy-component'));
  h.click('계정 다시 확인'); await h.flush(); assert.equal(h.state().kind, 'loading'); assert.equal(h.requests.length, 2);
  h.respond(1, user); await h.flush(); assert.equal(h.state().kind, 'ready'); assert.equal(h.state().me.coders_id, user.coders_id);
  const history = h.nodes().find(node => node.type === 'lazy-component'); assert.equal(history.props.authenticated, true); assert.equal(history.key, user.coders_id);
  assert(h.requests.every(request => request.url === '/api/me' && request.init.credentials === 'include' && request.init.cache === 'no-store' && !request.init.body && !request.init.method));
});

test('malformed identity remains recoverable; only explicit unauthorized responses become guest', async t => {
  const h = harness(); t.after(h.unmount); h.render(); h.respond(0, { ...user, coders_id: '' }); await h.flush();
  assert.equal(h.state().kind, 'error'); assert(h.text().includes('계정 응답'));
  h.click('계정 다시 확인'); await h.flush(); h.respond(1, { detail: 'isolated unavailable' }, 503); await h.flush(); assert.equal(h.state().kind, 'error');
  h.click('계정 다시 확인'); await h.flush(); h.respond(2, { detail: 'expired' }, 401); await h.flush();
  assert.equal(h.state().kind, 'guest'); assert.equal(h.state().me, null); assert(h.text().includes('로그인이 만료'));
  assert.equal(h.nodes().find(node => node.type === 'lazy-component').props.authenticated, false);
  for (const value of [null, [], {}, { ...user, display_name: 123 }, { ...user, picture: 'javascript:alert(1)' }, { ...user, email: {} }]) assert.equal(h.terminal.isTerminalProfile(value), false);
  assert.equal(h.terminal.isTerminalProfile({ ...user, picture: 'https://example.test/avatar.png' }), true);
});

test('confirmed logout immediately removes private identity; late requests cannot restore it on another session', async t => {
  const h = harness(); t.after(h.unmount); h.render(); h.respond(0, user); await h.flush(); assert(h.state().me);
  h.render(false); assert.equal(h.state().me, null); assert.equal(h.state().kind, 'guest'); await h.flush();
  h.render(true); assert.equal(h.state().kind, 'loading'); assert.equal(h.state().me, null); await h.flush();
  h.render(false); assert(h.requests[1].init.signal.aborted); h.respond(1, user); await h.flush(); assert.equal(h.state().me, null);
  h.render(true); await h.flush(); h.respond(2, { ...user, coders_id: 'different-isolated-owner' }); await h.flush();
  assert.equal(h.nodes().find(node => node.type === 'lazy-component').key, 'different-isolated-owner');
});

test('legacy US ranking context survives detail hash replacement and return to the same market', t => {
  const h = harness(); t.after(h.unmount);
  const detail = h.terminal.terminalDetailUrl('https://example.test/?browse=volume&rankExchange=NYS#us-top', { symbol: 'BRK/B', market: 'US', exchange: 'NYS' });
  assert.equal(detail.searchParams.get('browseMarket'), 'US'); assert.equal(detail.searchParams.get('browse'), 'volume'); assert.equal(detail.hash, '#instrument-workspace');
  assert.equal(detail.searchParams.get('symbol'), 'BRK/B');
  const returned = new URL(h.load('lib/market-browse.ts').marketReturnHref(detail.search), detail.origin);
  assert.equal(returned.searchParams.get('browseMarket'), 'US'); assert.equal(returned.searchParams.get('rankExchange'), 'NYS'); assert.equal(returned.hash, '#market-rankings');
  const plain = h.terminal.terminalDetailUrl('https://example.test/#us-top', { symbol: 'AAPL', market: 'US', exchange: 'NAS' });
  assert.equal(plain.searchParams.get('browseMarket'), 'US'); assert.equal(plain.searchParams.get('browse'), 'cap');
  const directory = h.terminal.terminalDetailUrl('https://example.test/?browse=all&browseMarket=US&catalogQ=Apple&catalogPage=4#market-rankings', { symbol: 'AAPL', market: 'US', exchange: 'NAS' });
  assert.equal(directory.searchParams.get('catalogQ'), 'Apple'); assert.equal(directory.searchParams.get('catalogPage'), '4');
});

test('only explicit cost valuation suppresses affected currency totals; legacy zero profit is not inferred missing', t => {
  const h = harness(); t.after(h.unmount); const check = h.terminal.terminalValuationStatus;
  const legacy = [{ currency: 'KRW', profit: 0 }, { currency: 'USD', profit: 0 }];
  assert.equal(check(legacy).count, 0); assert.equal(check(legacy).KRW, false); assert.equal(check(legacy).USD, false);
  const mixed = [{ currency: 'KRW', valuationBasis: 'COST' }, { currency: 'USD', valuationBasis: 'QUOTE' }];
  const before = JSON.stringify(mixed); assert.equal(check(mixed, 1).count, 1); assert.equal(check(mixed, 1).KRW, true); assert.equal(check(mixed, 1).USD, false);
  assert.equal(check(mixed, 2).USD, true, 'unmatched summary count cannot establish a safe currency');
  assert.equal(check([{ currency: 'USD', valuationBasis: 'COST' }]).KRW, false);
  assert.equal(JSON.stringify(mixed), before, 'display scope never rewrites portfolio numbers');
});

test('partial disclosure failure keeps confirmed groups and enables a bounded refresh even on the only page', async t => {
  const h = harness('disclosures'); t.after(h.unmount); h.render();
  h.respond(0, { groups: [group], failed: ['격리 실패 종목'], hasMore: false }); await h.flush();
  assert(h.text().includes('격리 검증 공시')); assert(h.button('이전 종목').props.disabled); assert(h.button('다음 관심종목').props.disabled);
  h.click('공시 다시 조회'); await h.flush(); assert(h.button('공시 확인 중…').props.disabled); assert(h.text().includes('격리 검증 공시'));
  assert.equal(h.requests.length, 2); h.respond(1, { groups: [group], failed: [], hasMore: false }); await h.flush();
  assert(!h.text().includes('격리 실패 종목')); assert(!h.button('공시 다시 조회'));
  assert(h.requests.every(request => request.url === '/api/personal/disclosures?offset=0' && !request.init.method && !request.init.body));
});

test('all-source failure is not an empty watchlist and repeated refresh failure retains recovery', async t => {
  const h = harness('disclosures'); t.after(h.unmount); h.render(); h.respond(0, { groups: [], failed: ['격리 실패 종목'], hasMore: false }); await h.flush();
  assert(!h.text().includes('관심종목을 계정에 저장하면')); h.click('공시 다시 조회'); await h.flush();
  h.expire(25000); await h.flush(); assert(h.button('공시 다시 조회')); assert(!h.text().includes('관심종목을 계정에 저장하면'));
  h.click('공시 다시 조회'); await h.flush(); h.respond(2, { groups: [], failed: [], hasMore: false }); await h.flush();
  assert(h.text().includes('관심종목을 계정에 저장하면')); assert(!h.button('공시 다시 조회'));
});
