// Real components/helpers with isolated React hooks and fetch; never writes a real account.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const test = require('node:test');
const root = path.resolve(__dirname, '..');
const jsx = (type, props) => ({ type, props });
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
const text = tree => Array.isArray(tree) ? tree.map(text).join(' ') : tree && typeof tree === 'object' ? text(tree.props?.children) : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
const sameDeps = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const now = '2026-10-25T01:00:00Z';
const KR = { id: 'KR:KRX:005930', symbol: '005930', name: '삼성전자', market: 'KR', exchange: 'KRX', currency: 'KRW' };
const US = { id: 'US:NAS:AAPL', symbol: 'AAPL', name: '애플', market: 'US', exchange: 'NAS', currency: 'USD' };
const recurring = () => ({ items: [], runs: [], worker: null });

function harness(target = 'Recurring', initialProps = {}) {
  const slots = [], effects = [], requests = [], modules = new Map(), timers = new Map();
  let cursor = 0, dirty = false, tree, props = initialProps, timerId = 0, keyId = 0;
  const react = {
    useState(initial) { const i = cursor++; if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, value => { const next = typeof value === 'function' ? value(slots[i].value) : value; if (!Object.is(next, slots[i].value)) { slots[i].value = next; dirty = true; } }]; },
    useRef(initial) { const i = cursor++; if (!slots[i]) slots[i] = { current: initial }; return slots[i]; },
    useCallback(fn, deps) { const i = cursor++; if (!slots[i] || !sameDeps(slots[i].deps, deps)) slots[i] = { value: fn, deps }; return slots[i].value; },
    useEffect(effect, deps) { const i = cursor++, previous = slots[i]; if (!previous || !sameDeps(previous.deps, deps)) effects.push(() => { previous?.cleanup?.(); slots[i] = { deps, cleanup: effect() }; }); },
  };
  const clock = { setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; }, clearTimeout(id) { timers.delete(id); } };
  const context = vm.createContext({ AbortController, URLSearchParams, ...clock, crypto: { randomUUID: () => `isolated-${++keyId}` }, fetch(url, init) {
    let finish, reject;
    const promise = new Promise((yes, no) => { finish = yes; reject = no; });
    init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    requests.push({ url, init, finish }); return promise;
  } });
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const output = {}; modules.set(file, output);
    const extra = file.endsWith('PersonalWorkspace.tsx') ? '\nexport { useLoad, Recurring, InstrumentPicker };' : '';
    const run = vm.runInContext(`(function(require,exports){${compile(fs.readFileSync(path.join(root, file), 'utf8') + extra)}\n})`, context);
    run(id => {
      if (id === 'react') return react;
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
      if (id === 'lucide-react') return new Proxy({}, { get: () => 'icon' });
      if (id.startsWith('@/lib/') && !id.endsWith('personal-navigation')) return load(`lib/${id.split('/').pop()}.ts`);
      return {};
    }, output); return output;
  }
  const module = load('components/PersonalWorkspace.tsx');
  function render(nextProps = props) { props = nextProps; cursor = 0; dirty = false; effects.length = 0; tree = target === 'useLoad' ? module.useLoad(props.url) : module[target](props); effects.splice(0).forEach(fn => fn()); return tree; }
  async function flush() { for (let n = 0; n < 6; n++) { await new Promise(resolve => setImmediate(resolve)); if (dirty) render(); } return tree; }
  return { render, flush, requests, load, get tree() { return tree; }, nodes: () => nodes(tree), text: () => text(tree),
    respond(index, payload, status = 200) { requests[index].finish({ ok: status >= 200 && status < 300, status, json: async () => payload }); },
    expire(delay) { for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.fn(); } },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

test('personal read guards accept supported contracts and reject malformed financial/collection data', () => {
  const check = harness().load('lib/personal-response.ts').validPersonalRead;
  const cases = {
    '/api/personal/notices': { items: [{ id: 'a', title: '공지', body: '내용', severity: 'INFO', createdAt: now }] },
    '/api/personal/inbox': { items: [{ key: 'a', title: '알림', body: '내용', at: now, read: false, href: '/#orders' }], hasMore: false, nextCursor: null },
    '/api/personal/support': { items: [{ id: 'a', category: 'BUG', subject: '문의', body: '내용', reply: null, status: 'OPEN', createdAt: now, updatedAt: now }], hasMore: false },
    '/api/personal/disclosures': { groups: [{ instrument: KR, items: [{ title: '공시', date: '20261025', receiptNo: 'abc', url: 'https://dart.fss.or.kr/' }], source: 'DART', asOf: now }], failed: [], hasMore: false },
    '/api/personal/recurring': recurring(),
    '/api/personal/fx/rate': { rate: '1400.123456', date: '2026-10-25', source: 'ECB', sourceUrl: 'https://www.ecb.europa.eu/' },
    '/api/trading/portfolio': { authenticated: true, cash: { KRW: 10000, USD: 25.15 } },
    '/api/personal/money': { items: [{ id: 'a', kind: 'FX', status: 'BOOKED', data: { message: '완료' }, createdAt: now, expiresAt: null }], hasMore: false },
    '/api/personal/corporate': { items: [{ kind: 'SPLIT', perShare: null, ratio: '2', payDate: null }], verified: [], partial: true },
    '/api/personal/operations': { tickets: [], actions: [], notices: [], hasMore: false },
  };
  for (const [url, value] of Object.entries(cases)) {
    const before = JSON.stringify(value); assert.equal(check(url + '?offset=0', value), true, url); assert.equal(JSON.stringify(value), before);
    for (const invalid of [null, [], {}, { items: null }, { items: [null] }]) assert.equal(check(url, invalid), false, url);
  }
  assert.equal(check('/api/personal/inbox', { ...cases['/api/personal/inbox'], hasMore: true }), false);
  assert.equal(check('/api/personal/inbox?cursor=stuck', { ...cases['/api/personal/inbox'], hasMore: true, nextCursor: 'stuck' }), false);
  assert.equal(check('/api/personal/inbox', { ...cases['/api/personal/inbox'], items: [{ ...cases['/api/personal/inbox'].items[0], href: '//external.example' }] }), false);
  assert.equal(check('/api/trading/portfolio', { cash: { KRW: Infinity, USD: 0 } }), false);
  assert.equal(check('/api/trading/portfolio', { authenticated: false, cash: { KRW: 100000000, USD: 100000 } }), false);
  assert.equal(check('/api/personal/fx/rate', { ...cases['/api/personal/fx/rate'], rate: 'NaN' }), false);
  assert.equal(check('/api/personal/disclosures', { ...cases['/api/personal/disclosures'], groups: [{ ...cases['/api/personal/disclosures'].groups[0], items: [{ title: null, date: null, receiptNo: null, url: 'https://dart.fss.or.kr/' }] }] }), true, 'DART optional metadata may be null; retain the valid source link');
});

test('malformed read exits loading, retry recovers, and permission loss removes private cached rows', async t => {
  const h = harness('useLoad', { url: '/api/personal/recurring' }); t.after(h.unmount); h.render();
  h.respond(0, { items: null, runs: [] }); await h.flush();
  assert.equal(h.tree.loading, false); assert(h.tree.error.includes('기록 응답')); assert.equal(h.tree.data, null);
  h.tree.refresh(); await h.flush(); h.respond(1, recurring()); await h.flush(); assert.equal(h.tree.data.items.length, 0);
  h.tree.refresh(); await h.flush(); h.respond(2, { detail: '일시 오류' }, 503); await h.flush(); assert(h.tree.data); assert(h.tree.error);
  h.tree.refresh(); await h.flush(); h.respond(3, { detail: '권한 없음' }, 403); await h.flush(); assert.equal(h.tree.data, null); assert.equal(h.tree.unauthorized, true);
});

test('late old-page reads and timeouts never replace the current personal page', async t => {
  const h = harness('useLoad', { url: '/api/personal/money?offset=0' }); t.after(h.unmount); h.render();
  h.render({ url: '/api/personal/money?offset=20' }); assert.equal(h.requests[0].init.signal.aborted, true);
  h.respond(0, { items: [{ id: 'private-old' }], hasMore: true }); h.respond(1, { items: [], hasMore: false }); await h.flush();
  assert.equal(h.tree.data.items.length, 0);
  h.tree.refresh(); await h.flush(); h.expire(25000); await h.flush(); assert.equal(h.tree.loading, false); assert(h.tree.error.includes('응답이 늦어'));
});

test('a successful guest portfolio response clears the previous private balance rather than showing demo money', async t => {
  const h = harness('useLoad', { url: '/api/trading/portfolio' }); t.after(h.unmount); h.render();
  h.respond(0, { authenticated: true, cash: { KRW: 12345, USD: 12.34 } }); await h.flush(); assert.equal(h.tree.data.cash.KRW, 12345);
  h.tree.refresh(); await h.flush(); h.respond(1, { authenticated: false, cash: { KRW: 100000000, USD: 100000 } }); await h.flush();
  assert.equal(h.tree.data, null); assert.equal(h.tree.unauthorized, true); assert.equal(h.tree.loading, false);
});

test('recurring validation matches currency precision and local-market sessions', () => {
  const check = harness().load('lib/personal-response.ts').recurringDraftError;
  for (const input of [['KR', '1', '0', '09:00'], ['KR', '50000000', '4', '15:00'], ['US', '.01', '0', '09:30'], ['US', '50000.00', '4', '15:50']]) {
    assert.equal(check(...input), '', input.join('/'));
  }
  for (const input of [['KR', '1.01', '0', '10:00'], ['US', '0.001', '0', '10:00'], ['US', '50001', '0', '10:00'], ['KR', '100', '0', '09:99'], ['US', '100', '0', '09:00'], ['KR', '1e5', '0', '10:00'], ['KR', '10', '7', '10:00']]) assert(check(...input), input.join('/'));
});

test('changing recurring stock clears the old budget; searching and busy writes block stale registration', async t => {
  const h = harness(); t.after(h.unmount); h.render(); h.respond(0, recurring()); await h.flush();
  const picker = () => h.nodes().find(n => n.type?.name === 'InstrumentPicker');
  const budget = () => h.nodes().find(n => n.type === 'input' && n.props.type === 'number');
  const submit = () => h.nodes().find(n => n.type === 'button' && n.props.type === 'submit');
  const form = () => h.nodes().find(n => n.type === 'form');
  picker().props.onSelect(KR); await h.flush(); budget().props.onChange({ target: { value: '10000' } }); await h.flush(); assert(h.text().includes('₩10,000'));
  picker().props.onSelect(US); await h.flush(); assert.equal(budget().props.value, ''); assert.equal(budget().props.step, '0.01');
  budget().props.onChange({ target: { value: '50.25' } }); await h.flush();
  picker().props.onQueryChange('다른 종목'); await h.flush(); assert.equal(submit().props.disabled, true);
  form().props.onSubmit({ preventDefault() {} }); await h.flush(); assert.equal(h.requests.length, 1, 'searching cannot send the previous instrument');
  picker().props.onQueryChange(''); await h.flush(); form().props.onSubmit({ preventDefault() {} }); await h.flush();
  assert.equal(h.requests.length, 2); assert.equal(picker().props.disabled, true); assert.equal(budget().props.disabled, true);
  const sent = JSON.parse(h.requests[1].init.body); assert.equal(sent.symbol, 'AAPL'); assert.equal(sent.amount, '50.25'); assert.equal(sent.exchange, 'NAS');
  h.respond(1, { id: 'new-plan' }); await h.flush(); h.respond(2, recurring()); await h.flush();
  assert(h.text().includes('정기 매수를 등록했어요')); assert.equal(budget().props.value, '');
});
