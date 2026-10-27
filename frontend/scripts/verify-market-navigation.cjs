// Executes the production handlers and component with deterministic reads only.
// No production API, account, market data, or order mutation is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const options = {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX};
const terminalText = fs.readFileSync('components/TradingTerminal.tsx', 'utf8');
const terminal = ts.createSourceFile('TradingTerminal.tsx', terminalText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const all = [];
function visit(node) { all.push(node); ts.forEachChild(node, visit); }
visit(terminal);
function declaration(name) {
  const node = all.find(n => (ts.isVariableDeclaration(n) || ts.isFunctionDeclaration(n)) && n.name?.getText(terminal) === name);
  assert(node, `Missing production declaration: ${name}`);
  return node;
}
function execute(expression, context) {
  const source = `__result = (${typeof expression === 'string' ? expression : expression.getText(terminal)});`;
  vm.runInContext(ts.transpileModule(source, {compilerOptions: options}).outputText, context);
  return context.__result;
}
function effectContaining(name) {
  return all.find(n => ts.isCallExpression(n) && n.expression.getText(terminal) === 'useEffect' && n.arguments[0]?.getText(terminal).includes(`const ${name} =`)).arguments[0];
}
function attributeHandler(element, name) {
  return element.attributes.properties.find(p => p.name?.getText(terminal) === name).initializer.expression;
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const instrument = (symbol, market = 'KR') => ({id: `${market}:${market === 'KR' ? 'KRX' : 'NAS'}:${symbol}`, symbol, name: `종목 ${symbol}`, englishName: `Company ${symbol}`, market, exchange: market === 'KR' ? 'KRX' : 'NAS', currency: market === 'KR' ? 'KRW' : 'USD',asOf:'2026-10-27T00:00:00Z'});
const a = instrument('005930'), b = instrument('000660');

async function navigationTests() {
  const listeners = new Map(), reads = [], pushes = [], notices = [];
  const ctx = vm.createContext({
    URL, URLSearchParams, AbortController, Error, Set,
    useCallback: fn => fn,
    selectedIdentity: {current: a.id}, selectionRequest: {current: 0}, searchRequest: {current: 0},
    selected: a.id, searchQuery: '', searchResults: [], searchMarket: 'ALL', searching: false, searchFailed: false,
    location: new URL('https://example.test/'),
    history: {pushState: (...args) => pushes.push(args)},
    window: {innerWidth: 390, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name), scrollTo: () => {}},
    requestAnimationFrame: fn => fn(), rememberStock: () => {}, notify: message => notices.push(message),
    loadQuote: item => { const pending = deferred(); reads.push({item, ...pending}); return pending.promise; },
    quotes: [],
  });
  const quoteModule={exports:{}};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/quote-snapshots.ts','utf8'),{compilerOptions:options}).outputText,{exports:quoteModule.exports});
  ctx.mergeQuoteSnapshots=quoteModule.exports.mergeQuoteSnapshots;
  for (const name of ['Selected','Side','Kind','Quantity','LimitPrice','TriggerPrice','ProtectionQuantity','TakeProfitPrice','StopLossPrice','ConfirmingOrder','MobileOrderOpen','OrderSafetyChecks','Searching','Quotes','WorkspaceView','SearchQuery','SearchResults','SearchFailed','SearchMarket','SearchAttempt','QuoteReadError']) {
    const state = name[0].toLowerCase() + name.slice(1);
    ctx[`set${name}`] = next => { ctx[state] = typeof next === 'function' ? next(ctx[state]) : next; };
  }
  ctx.activateInstrument = execute(declaration('activateInstrument').initializer, ctx);
  ctx.chooseSearchResult = execute(declaration('chooseSearchResult'), ctx);
  ctx.activateInstrument(a.id, 100);
  const cleanup = execute(effectContaining('restoreInstrument'), ctx)();
  const pendingChoice = ctx.chooseSearchResult(b);
  ctx.location = new URL(`https://example.test/?view=detail&symbol=${a.symbol}&market=KR&exchange=KRX`);
  listeners.get('popstate')();
  reads[0].resolve({...b, price: 200});
  await pendingChoice;
  assert.equal(ctx.selected, a.id, 'A late B response must not undo browser Back');
  assert.equal(pushes.length, 0, 'A canceled selection must not create a new history entry');
  reads[1].resolve({...a, price: 100});
  await flush();

  ctx.activateInstrument(b.id, 200);
  ctx.quantity = '91'; ctx.kind = 'LIMIT'; ctx.side = 'SELL'; ctx.confirmingOrder = true;
  ctx.protectionQuantity = '40'; ctx.takeProfitPrice = '700'; ctx.stopLossPrice = '3';
  listeners.get('popstate')();
  assert.equal(ctx.selected, a.id);
  assert.equal(ctx.quantity, '1'); assert.equal(ctx.kind, 'MARKET'); assert.equal(ctx.side, 'BUY');
  assert.equal(ctx.limitPrice, ''); assert.equal(ctx.triggerPrice, '');
  assert.equal(ctx.protectionQuantity, '1'); assert.equal(ctx.takeProfitPrice, ''); assert.equal(ctx.stopLossPrice, '');
  assert.equal(ctx.confirmingOrder, false); assert.equal(ctx.mobileOrderOpen, false);
  ctx.limitPrice = '123';
  reads[2].resolve({...a, price: 100});
  await flush();
  assert.equal(ctx.limitPrice, '123', 'A delayed quote cannot overwrite a price being typed');

  ctx.quantity = '7';
  ctx.location.hash = 'order-ticket';
  listeners.get('hashchange')();
  assert.equal(ctx.quantity, '7', 'Navigation inside the same instrument preserves the draft');
  assert.equal(ctx.mobileOrderOpen, true, 'Direct mobile order entry remains available');
  reads[3].resolve({...a, price: 101});
  await flush();
  assert.equal(ctx.limitPrice, '123');

  const input = all.find(n => ts.isJsxSelfClosingElement(n) && n.tagName.getText(terminal) === 'input' && n.attributes.getText(terminal).includes('종목명·종목코드·티커 검색'));
  const change = execute(attributeHandler(input, 'onChange'), ctx);
  const key = execute(attributeHandler(input, 'onKeyDown'), ctx);
  const selectedByEnter = [];
  ctx.chooseSearchResult = item => selectedByEnter.push(item);
  ctx.searchResults = [a];
  change({target: {value: 'SK'}});
  assert.equal(ctx.searchResults.length, 0, 'Typing invalidates old visible results immediately');
  assert.equal(ctx.searching, true);
  ctx.searchResults = [a]; // Even an interrupted old render cannot select a stale result while loading.
  const enter = composing => ({key: 'Enter', nativeEvent: {isComposing: composing}, preventDefault: () => {}});
  key(enter(false)); assert.equal(selectedByEnter.length, 0);
  ctx.searching = false;
  key(enter(true)); assert.equal(selectedByEnter.length, 0, 'Korean IME confirmation is not selection');
  key(enter(false)); assert.equal(selectedByEnter[0].id, a.id);
  const marketButton = all.find(n => ts.isJsxOpeningElement(n) && n.tagName.getText(terminal) === 'button' && n.attributes.getText(terminal).includes('searchMarket === item'));
  const marketClick = execute(attributeHandler(marketButton, 'onClick'), ctx);
  ctx.item = 'ALL'; ctx.searchMarket = 'ALL'; ctx.searching = false;
  marketClick();
  assert.equal(ctx.searching, false, 'Clicking the active market does not start an endless loading state');
  ctx.location = new URL('https://example.test/?view=detail&symbol=BRK%2FB&market=US&exchange=NYS');
  listeners.get('popstate')();
  assert.equal(reads[4].item.symbol, 'BRK/B', 'A slash share-class ticker must not be silently rejected or normalized');
  assert.equal(reads[4].item.exchange, 'NYS');
  reads[4].resolve({...instrument('BRK/B','US'),exchange:'NYS',id:'US:NYS:BRK/B',price:500});
  await flush();
  assert.equal(ctx.selected, 'US:NYS:BRK/B');
  assert.equal(notices.length,0,'Successful navigation and canceled old reads must not show an error');
  ctx.location = new URL('https://example.test/?view=detail&symbol=ABR%2FD&market=US&exchange=NYS');
  listeners.get('popstate')();
  reads[5].reject(new Error('offline'));await flush();
  assert.equal(ctx.quoteReadError.id,'US:NYS:ABR/D','A failed detail read has a durable recoverable error, not an endless loading label');
  listeners.get('popstate')();
  assert.equal(ctx.quoteReadError,null,'Explicit read retry clears the old error without replaying an order');
  reads[6].resolve({...instrument('ABR/D','US'),exchange:'NYS',id:'US:NYS:ABR/D',price:20});await flush();
  assert.equal(ctx.quotes.some(q=>q.id==='US:NYS:ABR/D'),true);
  cleanup();
  assert.equal(listeners.size, 0);
  assert.equal(notices.length, 1, 'Only the explicitly simulated offline read should show an error');
  assert.match(notices[0],/시세를 불러오지 못했어요/);
}

async function searchTests() {
  const timers = [], reads = [];
  const ctx = vm.createContext({
    AbortController, Error, searchQuery: '삼성', searchMarket: 'KR', searchRequest: {current: 0},
    searchResults: [], searchFailed: false, searching: true,
    window: {setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout: () => {}},
    requestJson: (url, options) => { const pending = deferred(); reads.push({url, options, ...pending}); return pending.promise; },
    isInstrument: value => value && typeof value.id === 'string',
  });
  for (const name of ['SearchResults','SearchFailed','Searching']) {
    const state = name[0].toLowerCase() + name.slice(1);
    ctx[`set${name}`] = value => { ctx[state] = value; };
  }
  const searchEffect = all.find(n => ts.isCallExpression(n) && n.expression.getText(terminal) === 'useEffect' && n.arguments[1]?.getText(terminal).includes('searchAttempt')).arguments[0];
  const run = execute(searchEffect, ctx);
  const stopFirst = run(); const first = timers.shift()();
  ctx.searchRequest.current++; ctx.searchQuery = 'SK';
  stopFirst();
  const stopSecond = run(); const second = timers.shift()();
  reads[1].resolve({items: [b]}); await second;
  reads[0].resolve({items: [a]}); await first;
  assert.equal(ctx.searchResults[0].id, b.id, 'Late search responses cannot replace the current query');
  assert.equal(ctx.searchResults[0].englishName, b.englishName);
  assert.equal(reads[0].options.signal.aborted, true);
  stopSecond();
  const stopThird = run(); const third = timers.shift()();
  reads[2].reject(new Error('timeout')); await third;
  assert.equal(ctx.searchFailed, true); assert.equal(ctx.searching, false);
  stopThird();
}

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
async function catalogTests() {
  const slots = [], refs = [], reads = [];
  let cursor = 0, refCursor = 0;
  const jsx = (type, props) => ({type, props});
  const exported = {};
  const context = {exports: exported, AbortController, URLSearchParams, Error, Set, require: name => {
    if (name === 'react') return {
      useState: initial => { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
      useRef: initial => { const index = refCursor++; return refs[index] ||= {current: initial}; },
      useEffect: () => {}, useCallback: fn => fn,
    };
    if (name === 'react/jsx-runtime') return {jsx, jsxs: jsx};
    if (name === '@/lib/instrument-identity') return {isInstrument: item => item && typeof item.id === 'string'};
    if (name === '@/lib/reliable-request') return {requestJson: (url, options) => { const pending = deferred(); reads.push({url, options, ...pending}); return pending.promise; }};
    return {default: 'StockRow', ChevronDown: 'icon', RefreshCw: 'icon'};
  }};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('components/FullMarketCatalog.tsx', 'utf8'), {compilerOptions: options}).outputText, context);
  const render = () => { cursor = 0; refCursor = 0; return nodes(exported.default({selectedId: '', savedIds: new Set(), onSelect: async () => {}, onSave: () => {}})); };
  const rows = tree => tree.filter(n => n.props?.stock);
  const page = (offset, market = 'KR') => ({items: Array.from({length: 20}, (_, index) => instrument(String(offset + index).padStart(6, '0'), market)), total: 100, hasMore: true, nextOffset: offset + 20, partial: false});
  render()[0].props.onToggle({currentTarget: {open: true}});
  reads[0].resolve(page(0)); await flush();
  let tree = render(); assert.equal(rows(tree).length, 20);
  const more = tree.find(n => n.props?.className === 'ranked-more');
  more.props.onClick(); more.props.onClick();
  assert.equal(reads.length, 2, 'Repeated More clicks are coalesced before the next render');
  reads[1].reject(new Error('잠시 연결할 수 없어요')); await flush();
  tree = render(); assert.equal(rows(tree).length, 20, 'Next-page errors retain loaded rows');
  const retry = tree.find(n => n.type === 'button' && n.props.children === '다음 종목 다시 조회');
  assert(retry); retry.props.onClick();
  assert.equal(new URL(reads[2].url, 'https://example.test').searchParams.get('offset'), '20');
  reads[2].resolve(page(20)); await flush();
  tree = render(); assert.equal(rows(tree).length, 40);
  tree.find(n => n.props?.className === 'ranked-more').props.onClick();
  tree = render();
  tree.find(n => n.type === 'button' && n.props.children === '미국').props.onClick();
  assert.equal(reads[3].options.signal.aborted, true);
  reads[4].resolve(page(0, 'US')); await flush();
  reads[3].resolve(page(40)); await flush();
  tree = render(); assert.equal(rows(tree).length, 20);
  assert(rows(tree).every(n => n.props.stock.market === 'US'), 'Old-market pages cannot leak into the new filter');
  tree.find(n => n.props?.className === 'ranked-more').props.onClick();
  reads[5].resolve(page(0, 'US')); await flush();
  tree = render();
  assert.equal(rows(tree).length, 20);
  assert(!tree.some(n => n.props?.className === 'ranked-more'), 'Changed page boundaries stop repeated duplicate requests');
  const refresh = tree.find(n => n.type === 'button' && n.props.children === '다시 조회');
  assert(refresh); refresh.props.onClick();
  assert.equal(new URL(reads[6].url, 'https://example.test').searchParams.get('offset'), '0');
  reads[6].resolve({items: null, total: 100}); await flush();
  tree = render();
  assert(tree.some(n => n.props?.role === 'alert'), 'Malformed responses produce a recoverable error');
  assert.equal(rows(tree).length, 20);
}

async function boundedReadTest() {
  const exported = {}, timers = [];
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/reliable-request.ts', 'utf8'), {compilerOptions: options}).outputText, {
    exports: exported, AbortController, Error,
    setTimeout: (fn, ms) => { timers.push({fn, ms}); return timers.length; }, clearTimeout: () => {},
    fetch: (_url, {signal}) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), {once: true})),
  });
  const read = exported.requestJson('/read-only-test');
  assert.equal(timers[0].ms, 15000, 'Search and catalog use the common 15-second read bound');
  timers[0].fn();
  await assert.rejects(read, /응답이 늦어/);
}

(async () => {
  await navigationTests(); await searchTests(); await catalogTests(); await boundedReadTest();
  console.log('PASS: stale search/IME, Back/forward draft isolation, delayed quote typing, catalog cursor retry/cancellation, duplicate-page recovery and bounded reads');
})().catch(error => { console.error(error); process.exitCode = 1; });
