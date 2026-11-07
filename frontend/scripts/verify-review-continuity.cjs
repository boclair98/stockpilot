/* eslint-disable @typescript-eslint/no-require-imports */
// Actual notebook and parent/calendar components with keyed component lifetimes.
// Hooks, storage and network are isolated; no private account or real API is used.
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

function harness(target = 'notebook', initial = {}) {
  const instances = new Map(), modules = new Map(), timers = new Map(), requests = [], writes = [], storageWrites = [], storage = new Map();
  let active, effects = [], seen, dirty = false, tree, timerId = 0, identity = 'owner-a';
  let props = target === 'notebook' ? { symbol: '005930', exchange: 'KRX', orders: [], ...initial } : { authenticated: true, ...initial };
  const cloud = { authenticated: true, owner: 'owner-a', busy: false, error: '', items: [{ key: 'KRX:005930', data: { note: 'server note A' }, deleted: false }], refresh() {},
    save(key, data) {
      const owner = cloud.owner; cloud.busy = true;
      return new Promise(resolve => writes.push({ key, data, owner, finish(success = true) {
        if (cloud.owner === owner) {
          cloud.busy = false;
          if (success) cloud.items = [{ key, data, deleted: false }, ...cloud.items.filter(row => row.key !== key)];
        }
        resolve(success); dirty = true;
      } }));
    },
  };
  const react = {
    useState(initial) { const instance = active, index = instance.cursor++; if (!instance.slots[index]) instance.slots[index] = { value: typeof initial === 'function' ? initial() : initial }; const slot = instance.slots[index]; return [slot.value, value => { const next = typeof value === 'function' ? value(slot.value) : value; if (!Object.is(next, slot.value)) { slot.value = next; if (instance.mounted) dirty = true; } }]; },
    useRef(initial) { const index = active.cursor++; if (!active.slots[index]) active.slots[index] = { current: initial }; return active.slots[index]; },
    useCallback(callback, deps) { const index = active.cursor++; if (!active.slots[index] || !same(active.slots[index].deps, deps)) active.slots[index] = { value: callback, deps }; return active.slots[index].value; },
    useEffect(effect, deps) { const instance = active, index = instance.cursor++, previous = instance.slots[index]; if (!previous || !same(previous.deps, deps)) effects.push(() => { previous?.cleanup?.(); instance.slots[index] = { deps, cleanup: effect() }; }); },
  };
  const context = vm.createContext({ AbortController, URLSearchParams, Intl, window: {},
    localStorage: { getItem: key => storage.get(key) ?? null, setItem(key, value) { storageWrites.push({ key, value }); storage.set(key, value); } },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; }, clearTimeout(id) { timers.delete(id); },
    fetch(url, init) { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); requests.push({ url, init, resolve }); init.signal.addEventListener('abort', () => reject(new Error('isolated abort')), { once: true }); return promise; },
  });
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const output = {}; modules.set(file, output);
    const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    vm.runInContext(`(function(require,exports){${code}\n})`, context)(id => {
      if (id === 'react') return react;
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
      if (id === 'lucide-react') return new Proxy({}, { get: () => 'icon' });
      if (id === 'next/link') return { default: 'a' };
      if (id === '@/lib/cloud-saved') return { useCloudSaved: () => cloud };
      if (id.startsWith('@/lib/')) return load(`lib/${id.split('/').pop()}.ts`);
      if (id.startsWith('./')) return load(`components/${id.slice(2)}.tsx`);
      throw new Error(`Unexpected dependency ${id}`);
    }, output);
    return output;
  }
  const component = load(`components/${target === 'notebook' ? 'DecisionNotebook' : 'InvestmentHistory'}.tsx`).default;
  function resolve(node, location) {
    if (Array.isArray(node)) return node.map((child, index) => resolve(child, `${location}/${index}`));
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') {
      const id = `${location}/${node.type.name}:${node.key ?? ''}`;
      let instance = instances.get(id);
      if (!instance) { instance = { slots: [], mounted: true, cursor: 0 }; instances.set(id, instance); }
      seen.add(id); instance.cursor = 0; active = instance;
      return resolve(node.type(node.props), `${id}/render`);
    }
    return { ...node, props: { ...node.props, children: resolve(node.props?.children, `${location}/${String(node.type)}`) } };
  }
  function render(next = props, nextIdentity = identity) {
    props = next; identity = nextIdentity; dirty = false; effects = []; seen = new Set();
    tree = resolve(jsx(component, props, identity), 'root');
    for (const [key, instance] of instances) if (!seen.has(key)) { instance.mounted = false; instance.slots.forEach(slot => slot?.cleanup?.()); instances.delete(key); }
    effects.forEach(effect => effect()); return tree;
  }
  async function flush() { for (let round = 0; round < 10; round++) { await new Promise(resolve => setImmediate(resolve)); if (dirty) render(); } }
  const findButton = label => nodes(tree).find(node => node.type === 'button' && (node.props['aria-label'] === label || text(node).replace(/\s+/g, ' ').trim() === label));
  return { render, flush, cloud, writes, requests, storage, storageWrites, load, text: () => text(tree), nodes: () => nodes(tree), button: findButton,
    textarea: () => nodes(tree).find(node => node.type === 'textarea'),
    edit(value) { const field = this.textarea(); assert(field && !field.props.disabled); field.props.onChange({ target: { value } }); },
    click(label) { const button = findButton(label); assert(button, `missing button ${label}`); assert(!button.props.disabled, `disabled button ${label}`); button.props.onClick(); },
    month(value) { nodes(tree).find(node => node.type === 'input' && node.props.type === 'month').props.onChange({ target: { value } }); },
    respond(index, value, status = 200) { assert(requests[index], `missing request ${index}`); requests[index].resolve({ ok: status >= 200 && status < 300, status, json: async () => value }); },
    unmount() { for (const instance of instances.values()) { instance.mounted = false; instance.slots.forEach(slot => slot?.cleanup?.()); } instances.clear(); timers.clear(); },
  };
}

const summary = (currency, changes = {}) => ({ currency, count: 0, buyCount: 0, sellCount: 0, buyAmount: 0, sellAmount: 0, fees: 0, taxes: 0, realizedPnl: 0, ...changes });
function activity(month) {
  const kr = summary('KRW', { count: 1, buyCount: 1, buyAmount: 100, fees: 1 });
  return { month, timezone: 'Asia/Seoul', basis: 'execution', asOf: '2026-11-06T01:00:00Z', totals: [kr, summary('USD')], days: [{ date: `${month}-03`, currencies: [kr], unknownCurrencyCount: 0, legacyDateCount: 0 }], unknownCurrencyCount: 0, legacyDateCount: 0 };
}
const history = { items: [], hasMore: false, nextCursor: null, asOf: '2026-11-06T01:00:00Z' };

test('save acknowledgement keeps a newer draft and only marks the exact submitted revision saved', async t => {
  const h = harness(); t.after(h.unmount); h.render();
  h.edit('first submitted revision'); await h.flush(); h.click('기록 저장'); await h.flush();
  assert(h.button('저장 중…').props.disabled); assert.equal(h.writes.length, 1);
  h.edit('newer draft typed during save'); await h.flush(); h.writes[0].finish(); await h.flush();
  assert.equal(h.textarea().props.value, 'newer draft typed during save'); assert(h.text().includes('추가로 입력한 내용은 아직 저장하지 않았어요'));
  assert(h.button('기록 저장')); assert(!h.button('저장됨')); assert.equal(h.writes.length, 1);
  h.click('기록 저장'); await h.flush(); assert.equal(h.writes[1].data.note, 'newer draft typed during save');
  h.writes[1].finish(); await h.flush(); assert(h.button('저장됨')); assert.equal(h.textarea().props.value, 'newer draft typed during save');
  assert.equal(h.storageWrites.length, 0, 'private drafts never auto-save to browser storage');
});

test('even an edit reverted to the same text is a new revision and duplicate save clicks do not replay', async t => {
  const h = harness(); t.after(h.unmount); h.render(); h.edit('A'); await h.flush();
  const originalClick = h.button('기록 저장').props.onClick; originalClick(); originalClick(); await h.flush(); assert.equal(h.writes.length, 1);
  h.edit('B'); h.edit('A'); await h.flush(); h.writes[0].finish(); await h.flush();
  assert.equal(h.textarea().props.value, 'A'); assert(h.button('기록 저장')); assert(!h.button('저장됨'));
});

test('failed/conflicting saves preserve the current editor without automatic replay', async t => {
  const h = harness(); t.after(h.unmount); h.render(); h.edit('unsaved draft'); await h.flush(); h.click('기록 저장'); await h.flush();
  h.cloud.error = '다른 기기의 변경을 확인해 주세요.'; h.writes[0].finish(false); await h.flush();
  assert.equal(h.textarea().props.value, 'unsaved draft'); assert(h.text().includes(h.cloud.error)); assert(!h.button('저장됨')); assert.equal(h.writes.length, 1);
});

test('owner and instrument boundaries discard private editor state and ignore old acknowledgements', async t => {
  const h = harness(); t.after(h.unmount); h.render(); h.edit('owner A private pending'); await h.flush(); h.click('기록 저장'); await h.flush();
  Object.assign(h.cloud, { owner: 'owner-b', busy: false, items: [{ key: 'KRX:005930', data: { note: 'owner B server note' }, deleted: false }] });
  h.render(); await h.flush(); assert.equal(h.textarea().props.value, 'owner B server note');
  h.writes[0].finish(); await h.flush(); assert.equal(h.textarea().props.value, 'owner B server note'); assert(!h.button('저장됨')); assert(!h.text().includes('메모를 저장했어요'));
  h.edit('owner B old instrument draft'); await h.flush(); h.click('기록 저장'); await h.flush();
  h.render({ symbol: 'AAPL', exchange: 'NAS', orders: [] }); await h.flush(); assert.equal(h.textarea().props.value, '');
  h.writes[1].finish(); await h.flush(); assert.equal(h.textarea().props.value, ''); assert(!h.button('저장됨'));
});

test('guest writes remain explicit, account transitions do not inherit drafts, and unknown auth disables editing', async t => {
  const h = harness(); t.after(h.unmount); h.storage.set('stockpilot:decision:v1:KRX:005930', 'existing browser note');
  Object.assign(h.cloud, { authenticated: false, owner: null, items: [] }); h.render();
  assert.equal(h.textarea().props.value, 'existing browser note'); h.edit('guest unsaved edit'); await h.flush(); assert.equal(h.storageWrites.length, 0);
  h.click('기록 저장'); await h.flush(); assert.equal(h.storageWrites.length, 1);
  Object.assign(h.cloud, { authenticated: null }); h.render(); await h.flush(); assert(h.textarea().props.disabled); assert.equal(h.textarea().props.value, '');
  Object.assign(h.cloud, { authenticated: true, owner: 'signed-in-owner', items: [] }); h.render(); await h.flush(); assert.equal(h.textarea().props.value, '');
  h.click('이 브라우저의 메모 가져오기'); await h.flush(); assert.equal(h.textarea().props.value, 'guest unsaved edit'); assert.equal(h.writes.length, 0);
  Object.assign(h.cloud, { authenticated: false, owner: null, items: [] }); h.render(); await h.flush(); assert(!h.text().includes('메모를 저장했어요')); assert.equal(h.storageWrites.length, 1);
});

test('notebook describes the loaded recent-order scope instead of claiming no lifetime orders', t => {
  const h = harness('notebook', { orders: [{ id: 'other', symbol: 'AAPL', exchange: 'NAS', side: 'BUY', quantity: 1, status: 'FILLED', fillPrice: 10, createdAt: '2026-11-05T01:00:00Z' }] }); t.after(h.unmount); h.render();
  assert(h.text().includes('최근 전체 주문 최대 30건')); assert(h.text().includes('불러온 최근 주문에는 이 종목의 기록이 없어요'));
  assert(!h.text().includes('이 종목의 주문 기록이 아직 없어요')); assert(h.nodes().some(node => node.type === 'a' && node.props.href === '#decision-review'));
});

test('the actual history parent restores the historical month and selected day after detail drill-down', async t => {
  const h = harness('history'); t.after(h.unmount); h.render(); await h.flush(); assert(h.requests[0].url.includes('/orders/history'));
  h.click('매매 캘린더'); await h.flush(); assert(h.requests[0].init.signal.aborted);
  h.month('2024-02'); await h.flush(); assert(h.requests[1].init.signal.aborted); h.respond(2, activity('2024-02')); await h.flush();
  h.click('2024-02-03, 체결 1건'); await h.flush(); h.click('이날 체결 내역 보기'); await h.flush();
  const query = new URL(h.requests[3].url, 'https://example.test').searchParams;
  assert.equal(query.get('from'), '2024-02-03'); assert.equal(query.get('to'), '2024-02-03'); assert.equal(query.get('dateBasis'), 'execution');
  h.respond(3, history); await h.flush(); h.click('매매 캘린더'); await h.flush();
  assert.equal(h.requests[4].url, '/api/trading/activity?month=2024-02'); h.respond(4, activity('2024-02')); await h.flush();
  assert(h.button('2024-02-03, 체결 1건').props['aria-pressed']); assert(h.text().includes('2월 3일'));
  h.click('주문 목록'); await h.flush(); const restored = new URL(h.requests[5].url, 'https://example.test').searchParams; assert.equal(restored.get('from'), '2024-02-03');
  assert.equal(h.storageWrites.length, 0); assert(h.requests.every(request => !request.init.method && !request.init.body && request.init.cache === 'no-store'));
});

test('calendar month-only navigation survives list switching; logout and owner remount clear private context', async t => {
  const h = harness('history'); t.after(h.unmount); h.render(); await h.flush(); h.click('매매 캘린더'); await h.flush();
  h.month('2023-09'); await h.flush(); h.click('주문 목록'); await h.flush(); h.click('매매 캘린더'); await h.flush();
  assert.equal(h.requests.at(-1).url, '/api/trading/activity?month=2023-09');
  h.render({ authenticated: false }); await h.flush(); assert(h.requests.at(-1).init.signal.aborted); assert(!h.nodes().some(node => node.props?.className === 'trade-calendar-grid'));
  h.render({ authenticated: true }); await h.flush(); const current = h.load('lib/trade-calendar.ts').currentKstMonth();
  assert.equal(h.requests.at(-1).url, `/api/trading/activity?month=${current}`);
  h.render({ authenticated: true }, 'owner-b'); await h.flush(); assert(h.requests.at(-1).url.includes('/orders/history')); assert(!h.requests.at(-1).url.includes('2023-09'));
  h.click('매매 캘린더'); await h.flush(); assert.equal(h.requests.at(-1).url, `/api/trading/activity?month=${current}`);
});
