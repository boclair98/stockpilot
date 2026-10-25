// Actual ranking/row/helper code; isolated hooks, timers and API responses only.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const jsx = (type, props) => typeof type === "function" ? type(props) : ({ type, props });
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === "object" ? [tree, ...nodes(tree.props?.children)] : [];
const text = tree => Array.isArray(tree) ? tree.map(text).join("") : tree && typeof tree === "object" ? text(tree.props?.children) : typeof tree === "string" || typeof tree === "number" ? String(tree) : "";
const kr = (symbol = "005930", name = "삼성전자") => ({ id: `KR:KRX:${symbol}`, symbol, name, market: "KR", exchange: "KRX", currency: "KRW", price: 70000, changePercent: 1.23, marketCapEok: 4000000, volume: 10000 });
const us = (symbol = "AAPL", name = "애플") => ({ id: `US:NAS:${symbol}`, symbol, name, market: "US", exchange: "NAS", currency: "USD", price: 200, changePercent: -0.34, marketCapUsd: 3000000000000, volume: 5000 });
const stamp = "2026-10-25T01:00:00Z";
const page = (items, extra = {}) => ({ items, asOf: stamp, hasMore: false, nextOffset: null, partial: false, ...extra });

function harness() {
  const slots = [], requests = [], modules = new Map(), timers = new Map(), opened = [], saved = [];
  let cursor = 0, effects = [], dirty = false, tree, timerId = 0;
  const react = {
    useState(initial) { const index = cursor++; if (!slots[index]) slots[index] = { value: typeof initial === "function" ? initial() : initial }; return [slots[index].value, value => { const next = typeof value === "function" ? value(slots[index].value) : value; if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; } }]; },
    useRef(initial) { const index = cursor++; if (!slots[index]) slots[index] = { value: { current: initial } }; return slots[index].value; },
    useEffect(effect, deps) { const index = cursor++, previous = slots[index]; if (!previous || previous.deps.some((dep, i) => !Object.is(dep, deps[i]))) effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: effect() }; }); },
  };
  const context = vm.createContext({ AbortController, URLSearchParams, Intl,
    location: { hash: "" }, window: { addEventListener() {}, removeEventListener() {} },
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); },
    fetch(url, init) { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); requests.push({ url, init, resolve, reject }); init.signal.addEventListener("abort", () => reject(new Error("abort")), { once: true }); return promise; },
  });
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const out = {}; modules.set(file, out);
    const code = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    vm.runInContext(`(function(require,exports){${code}\n})`, context)(id => {
      if (id === "react") return react;
      if (id === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
      if (id === "lucide-react") return new Proxy({}, { get: () => "icon" });
      if (id === "next/link") return { default: "a" };
      if (id === "./StockLogo") return { default: "logo" };
      if (id.startsWith("@/")) return load(id.replace("@/", "") + ".ts");
      if (id.startsWith("./")) return load(path.posix.join(path.posix.dirname(file), id) + (file.startsWith("components/") ? ".tsx" : ".ts"));
      throw new Error(id);
    }, out);
    return out;
  }
  const component = load("components/RankedMarketBrowser.tsx").default;
  const render = () => { cursor = 0; effects = []; dirty = false; tree = component({ selectedId: "", savedIds: new Set(), onSelect: async item => opened.push(item.id), onSave: item => saved.push(item.id) }); effects.forEach(effect => effect()); return tree; };
  const flush = async () => { for (let round = 0; round < 6; round++) { await new Promise(resolve => setImmediate(resolve)); if (dirty) render(); } };
  return { load, render, flush, requests, opened, saved, text: () => text(tree), nodes: () => nodes(tree),
    findButton(label) { return nodes(tree).find(node => node.type === "button" && (node.props["aria-label"] === label || text(node).trim() === label)); },
    click(label) { const button = this.findButton(label); assert(button, label); assert(!button.props.disabled, label); button.props.onClick(); },
    respond(index, data, status = 200) { requests[index].resolve({ ok: status >= 200 && status < 300, status, json: async () => data }); },
    expire() { for (const [id, timer] of timers) if (timer.ms === 15000) { timers.delete(id); timer.fn(); } },
    unmount() { slots.forEach(slot => slot.cleanup?.()); timers.clear(); },
  };
}

test("comparison accepts canonical public identities only and caps two-to-three-item URLs", t => {
  const h = harness(); t.after(h.unmount); const lib = h.load("lib/ranking-comparison.ts");
  const privateRow = { ...kr(), cash: 100000000, quantity: 30, note: "private", token: "not-a-real-token" };
  const id = lib.comparisonIdentity(privateRow);
  assert.deepEqual(Object.keys(id).sort(), ["currency", "exchange", "id", "market", "name", "symbol"]);
  let selection = lib.toggleComparison([], privateRow).items;
  assert.equal(lib.rankingComparisonHref(selection), null);
  selection = lib.toggleComparison(selection, us()).items;
  const href = lib.rankingComparisonHref(selection);
  assert.equal(new URL(href, "https://example.test").searchParams.get("items"), "KR:KRX:005930,US:NAS:AAPL");
  assert(!/cash|quantity|note|token|private|100000000/.test(href));
  selection = lib.toggleComparison(selection, kr("000660", "SK하이닉스")).items;
  assert.equal(selection.length, 3);
  assert.equal(lib.toggleComparison(selection, us("NVDA", "엔비디아")).items.length, 3);
  assert.equal(lib.toggleComparison(selection, kr()).items.length, 2);
  assert.equal(lib.rankingComparisonHref([id, id]), null);
  for (const bad of [{ ...kr(), id: "US:NAS:AAPL" }, { ...kr(), symbol: "005930&private=1" }, { ...us(), exchange: "KRX" }, { ...us(), currency: "KRW" }, null]) assert.equal(lib.comparisonIdentity(bad), null);
  const compare = h.load("lib/stock-comparison.ts");
  assert.equal(compare.parseComparisonIds(new URL(href, "https://example.test").searchParams.get("items")).length, 2);
});

test("ranking read validation preserves unknown metrics, valid zeros and cursor progress", t => {
  const h = harness(); t.after(h.unmount); const lib = h.load("lib/ranking-comparison.ts");
  const payload = page([null, {}, kr(), { ...kr("000660"), volume: 0, marketCapEok: NaN, changePercent: Infinity }, us()], { hasMore: true, nextOffset: 20 });
  const data = lib.normalizeRankingPage(payload, "KR", 0);
  assert.equal(data.items.length, 2); assert.equal(data.partial, true); assert.equal(data.hasMore, true);
  assert.equal(data.items[1].volume, 0); assert.equal(data.items[1].marketCapEok, null); assert.equal(data.items[1].changePercent, null);
  for (const offset of [0, -1, "20", null, Infinity]) assert.equal(lib.normalizeRankingPage({ ...payload, nextOffset: offset }, "KR", 0).hasMore, false);
  assert.throws(() => lib.normalizeRankingPage({ ...payload, asOf: "invalid" }, "KR", 0));
  assert.equal(lib.normalizeRankingPage(page([kr(), kr()]), "KR", 0).items.length, 1);
});

test("actual ranking selection survives more pages and market changes without nesting buttons", async t => {
  const h = harness(); t.after(h.unmount); h.render(); await h.flush();
  h.respond(0, page([kr(), kr("000660", "SK하이닉스")], { hasMore: true, nextOffset: 20 })); await h.flush();
  h.click("삼성전자 비교 추가"); await h.flush(); h.click("SK하이닉스 비교 추가"); await h.flush();
  assert(h.nodes().some(node => node.type === "a" && node.props.href.startsWith("/compare?items=")));
  h.click("삼성전자 관심종목 추가"); assert.deepEqual(h.saved, ["KR:KRX:005930"]);
  h.click("삼성전자 상세 보기"); assert.deepEqual(h.opened, ["KR:KRX:005930"]);
  assert(h.nodes().filter(node => node.type === "button").every(button => !nodes(button.props.children).some(node => node.type === "button" || node.type === "a")));
  h.click("20개 더 보기 · 2개 조회"); await h.flush();
  assert.equal(new URL(h.requests[1].url, "https://example.test").searchParams.get("snapshot"), stamp);
  h.respond(1, page([kr("035420", "NAVER")])); await h.flush();
  h.click("미국"); await h.flush(); h.respond(2, page([us(), us("NVDA", "엔비디아")])); await h.flush();
  assert(h.text().includes("SK하이닉스")); h.click("애플 비교 추가"); await h.flush();
  h.click("엔비디아 비교 추가"); await h.flush(); assert(h.text().includes("최대 3개"));
  h.click("SK하이닉스 비교 선택 해제"); await h.flush();
  const links = h.nodes().filter(node => node.type === "a" && node.props.href.startsWith("/compare?"));
  assert(links.length); assert(links.every(node => !decodeURIComponent(node.props.href).includes("000660")));
  h.click("선택 초기화"); await h.flush();
  assert.equal(h.nodes().some(node => node.type === "a" && node.props.href.startsWith("/compare?")), false);
});

test("timeout, malformed response, first-page retry and stale pagination recover safely", async t => {
  const h = harness(); t.after(h.unmount); h.render(); await h.flush(); h.expire(); await h.flush();
  assert(h.text().includes("응답이 늦어")); h.click("다시 조회"); await h.flush();
  h.respond(1, null); await h.flush(); assert(h.text().includes("확인 가능한 목록"));
  h.click("다시 조회"); await h.flush(); h.respond(2, page([kr()], { hasMore: true, nextOffset: 20 })); await h.flush();
  h.click("20개 더 보기 · 1개 조회"); await h.flush(); h.respond(3, page([kr("000660")], { asOf: "2026-10-25T02:00:00Z" })); await h.flush();
  assert(h.text().includes("순위가 바뀌었어요")); assert(h.findButton("삼성전자 비교 추가"));
  h.click("다시 조회"); await h.flush(); assert.equal(new URL(h.requests[4].url, "https://example.test").searchParams.get("offset"), "0");
  h.respond(4, page([kr()], { hasMore: true, nextOffset: 20 })); await h.flush();
  h.click("순위 새로고침"); await h.flush(); h.respond(5, { detail: "temporarily unavailable" }, 503); await h.flush();
  h.click("다시 조회"); await h.flush(); assert.equal(new URL(h.requests[6].url, "https://example.test").searchParams.get("offset"), "0");
  h.click("미국"); await h.flush(); assert(h.requests[6].init.signal.aborted);
  h.respond(6, page([kr("000660", "old data")])); h.respond(7, page([us()])); await h.flush();
  assert(!h.text().includes("old data")); assert(h.findButton("애플 비교 추가"));
  assert(h.requests.every(request => !request.init.method && !request.init.body && request.init.cache === "no-store"));
});
