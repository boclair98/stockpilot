// Actual TypeScript component and validators; only React scheduling/network are isolated.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const jsx = (type, props) => ({ type, props });
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === "object" ? [tree, ...nodes(tree.props?.children)] : [];
const text = tree => Array.isArray(tree) ? tree.map(text).join(" ") : tree && typeof tree === "object" ? text(tree.props?.children) : typeof tree === "string" || typeof tree === "number" ? String(tree) : "";
const identity = { symbol: "AAPL", exchange: "NAS", market: "US", currency: "USD" };
const payload = (symbol = "AAPL", exchange = "NAS") => ({
  symbol, exchange, currency: "USD", asOf: "2024-10-20T11:12:13.123456+00:00", marketCapUsd: 3_000_000_000_000,
  listedShares: 15_000_000_000, open: 200.1234, high: 205, low: 199.99, previousClose: 198,
  week52High: 250, week52Low: 150, per: 30.5, pbr: 5.6,
});

function harness() {
  const slots = [], requests = [], modules = new Map(), timers = new Map();
  let cursor = 0, effects = [], dirty = false, tree, props = identity, timerId = 0;
  const react = {
    useState(initial) { const index = cursor++; if (!slots[index]) slots[index] = { value: typeof initial === "function" ? initial() : initial }; return [slots[index].value, value => { const next = typeof value === "function" ? value(slots[index].value) : value; if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; } }]; },
    useEffect(effect, deps) { const index = cursor++, previous = slots[index]; if (!previous || previous.deps.some((dep, i) => !Object.is(dep, deps[i]))) effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: effect() }; }); },
  };
  const context = vm.createContext({ AbortController, Intl, URLSearchParams,
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
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
      if (id.startsWith("@/lib/")) return load(id.replace("@/", "") + ".ts");
      throw new Error(id);
    }, out);
    return out;
  }
  const component = load("components/USMarketDetails.tsx").default;
  const render = (next = props) => { props = next; cursor = 0; effects = []; dirty = false; tree = component(props); effects.forEach(effect => effect()); return tree; };
  const flush = async () => { for (let round = 0; round < 6; round++) { await new Promise(resolve => setImmediate(resolve)); if (dirty) render(); } };
  return { load, render, flush, requests, timers, text: () => text(tree), nodes: () => nodes(tree),
    click(label) { const button = nodes(tree).find(node => node.type === "button" && (node.props["aria-label"] === label || text(node).trim() === label)); assert(button, label); assert(!button.props.disabled); button.props.onClick(); },
    respond(index, data, status = 200) { requests[index].resolve({ ok: status >= 200 && status < 300, status, json: async () => data }); },
    expire() { for (const timer of [...timers.values()]) timer.callback(); },
    unmount() { slots.forEach(slot => slot.cleanup?.()); },
  };
}

test("details validate instrument, currency, real dates, timezone and future timestamps", t => {
  const h = harness(); t.after(h.unmount); const lib = h.load("lib/us-market-details.ts");
  const now = Date.parse("2026-10-25T00:00:00Z");
  const check = row => lib.parseUSMarketDetails(row, identity, now);
  assert.equal(check(payload()).availableCount, 10);
  assert.equal(check(payload()).oldRetrieval, true);
  assert.equal(check({ ...payload(), asOf: "2026-10-25T00:00:00Z" }).oldRetrieval, false);
  for (const changes of [{ symbol: "NVDA" }, { exchange: "NYS" }, { currency: "KRW" }, { asOf: "bad" }, { asOf: "2024-02-30T00:00:00Z" }, { asOf: "2024-01-01" }, { asOf: "2024-01-01T00:00:00" }, { asOf: "2024-01-01T25:00:00Z" }, { asOf: "2024-01-01T00:00:00+14:30" }, { asOf: "2026-10-25T01:00:00Z" }]) assert.equal(check({ ...payload(), ...changes }), null, JSON.stringify(changes));
  assert(check({ ...payload(), asOf: "2024-02-29T09:00:00+09:00" }));
  assert.equal(lib.parseUSMarketDetails(payload(), { ...identity, market: "KR" }, now), null);
  assert.equal(lib.supportsUSDetails({ ...identity, symbol: "AAPL&secret=x" }), false);
  assert.equal(lib.supportsUSDetails({ ...identity, exchange: "KRX" }), false);
  assert.equal(lib.supportsUSDetails({ ...identity, symbol: "BRK.B", exchange: "NYS" }), true);
});

test("missing, malformed and contradictory optional values remain unknown, never zero", t => {
  const h = harness(); t.after(h.unmount); const lib = h.load("lib/us-market-details.ts");
  const row = lib.parseUSMarketDetails({ ...payload(), per: null, pbr: "5", high: Infinity, low: -1, listedShares: 1.5, marketCapUsd: 0, week52Low: 300, week52High: 200 }, identity);
  for (const field of ["per", "pbr", "high", "low", "listedShares", "marketCapUsd", "week52High", "week52Low"]) assert.equal(row[field], null);
  assert.equal(row.availableCount, 2);
  assert.equal(lib.parseUSMarketDetails({ ...payload(), open: 300 }, identity).open, null);
  assert.equal(lib.parseUSMarketDetails({ ...identity, asOf: payload().asOf }, identity).availableCount, 0);
  assert.equal(lib.usDetailMoney(null), "—");
  assert.equal(lib.usDetailMoney(200.1234), "US$200.1234");
  assert.equal(lib.usDetailMoney(3_000_000_000_000, true), "US$3조");
  assert.equal(lib.usDetailNumber(null, "배"), "—");
  assert.equal(lib.usDetailNumber(30.5, "배"), "30.5배");
});

test("actual component renders USD facts and hides old symbol data before the next response", async t => {
  const h = harness(); t.after(h.unmount); h.render(); await h.flush();
  assert(h.text().includes("불러오고"));
  assert.equal(h.timers.values().next().value.delay, 15000);
  h.respond(0, payload()); await h.flush();
  assert(h.text().includes("US$200.1234")); assert(h.text().includes("52주 가격 범위")); assert(h.text().includes("시세 수신 시각이나 개장 상태를 뜻하지 않아요"));
  assert(h.text().includes("10분 이상 지난 자료")); assert(h.text().includes("2024"));
  h.render({ ...identity, symbol: "NVDA" });
  assert(!h.text().includes("US$200.1234"));
  await h.flush();
  h.render({ ...identity, symbol: "MSFT" }); await h.flush();
  assert(h.requests[1].init.signal.aborted);
  h.respond(1, payload("NVDA")); h.respond(2, { ...payload("MSFT"), marketCapUsd: 123000000000 }); await h.flush();
  assert(h.text().includes("MSFT")); assert(!h.text().includes("NVDA"));
  const count = h.requests.length;
  assert.equal(h.render({ symbol: "005930", exchange: "KRX", currency: "KRW", market: "KR" }), null);
  await h.flush(); assert.equal(h.requests.length, count);
  assert(h.requests.every(request => !request.init.method && !request.init.body && request.init.cache === "no-store"));
});

test("503 and retry recover into partial data; all unknown data is its own state", async t => {
  const h = harness(); t.after(h.unmount); h.render(); await h.flush();
  h.respond(0, { detail: "internal provider trace must not be displayed" }, 503); await h.flush();
  assert(h.text().includes("지표 제공이 잠시 지연")); assert(!h.text().includes("internal provider"));
  h.click("다시 조회"); await h.flush();
  h.respond(1, { ...payload(), marketCapUsd: null, per: null }); await h.flush();
  assert(h.text().includes("일부 항목")); assert(h.text().includes("—"));
  h.click("미국 종목 지표 새로고침"); await h.flush();
  h.respond(2, { ...identity, asOf: payload().asOf }); await h.flush();
  assert(h.text().includes("아직 확인할 수 있는 종목 지표가 없어요")); assert(!h.text().includes("US$0"));
});

test("timeout cancels the request, supports retry and rejects wrong response identity", async t => {
  const h = harness(); t.after(h.unmount); h.render(); await h.flush();
  h.expire(); await h.flush(); assert(h.requests[0].init.signal.aborted);
  assert(h.text().includes("연결이 끊겼거나 응답이 늦어요"));
  h.click("다시 조회"); await h.flush(); h.respond(1, payload("NVDA")); await h.flush();
  assert(h.text().includes("응답을 확인하지 못했어요")); assert(!h.text().includes("US$3조"));
  h.click("다시 조회"); await h.flush(); h.respond(2, payload()); await h.flush(); assert(h.text().includes("US$3조"));
  assert.equal(h.timers.size, 0);
});
