// Real validators/components/request wrapper; fake hooks, clock and network only.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const jsx = (type, props) => ({ type, props });
const sameDeps = (a, b) => a && b && a.length === b.length && a.every((item, index) => Object.is(item, b[index]));
function nodes(tree) { return Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === "object" ? [tree, ...nodes(tree.props?.children)] : []; }
function text(tree) { return Array.isArray(tree) ? tree.map(text).join(" ") : tree && typeof tree === "object" ? text(tree.props?.children) : typeof tree === "string" || typeof tree === "number" ? String(tree) : ""; }
const series = [{ date: "2026-10-21", returnRate: -1, change: null }, { date: "2026-10-23", returnRate: 2, change: 3 }];
function analytics() {
  return { authenticated: true, analytics: {
    dataQuality: "TRACKING", periodDays: 2, openPositionCount: 1, totalReturn: 2,
    maxDrawdown: 0, dailyVolatility: null, annualizedVolatility: null, sharpeRatio: null,
    winRate: 50, profitFactor: 1.5, fillRate: 100, averageSlippageBps: 2, averageSpreadBps: 1,
    filledOrderCount: 2, closedTradeCount: 1, dailySeries: series.map(row => ({ ...row })),
  } };
}
function statement() {
  return { authenticated: true, asOf: "2026-10-23T01:00:00Z", cash: { KRW: 125000, USD: 75 }, equity: { KRW: 125000, USD: 75 }, positions: [],
    summary: { marketValue: { KRW: 0, USD: 0 }, unrealizedPnl: { KRW: 0, USD: 0 }, realizedPnl: { KRW: -5, USD: 0 }, costs: { KRW: 0, USD: 0 }, filledOrders: 0, openOrders: 0, rejectedOrders: 0 },
    rules: { isSimulation: true, initialCash: { KRW: 100000000, USD: 100000 }, disclaimer: "격리 테스트 규칙", fees: { commissionRate: .015, krSellTaxRate: .2, slippage: "모의 체결 규칙" },
      dataPolicy: { maxQuoteAgeSeconds: 30 }, orderTypes: [{ label: "시장가" }], sessions: [{ label: "한국", time: "09:00" }] },
  };
}

function harness(componentFile, props = {}) {
  const slots = [], requests = [], timers = new Map(), modules = new Map();
  let cursor = 0, effects = [], dirty = false, mounted = true, tree, nextTimer = 0;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { type: "state", value: typeof initial === "function" ? initial() : initial };
      return [slots[index].value, value => { if (!mounted) return; const next = typeof value === "function" ? value(slots[index].value) : value; if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; } }];
    },
    useMemo(compute, deps) { const index = cursor++; if (!slots[index] || !sameDeps(slots[index].deps, deps)) slots[index] = { type: "memo", deps, value: compute() }; return slots[index].value; },
    useEffect(effect, deps) { const index = cursor++, previous = slots[index]; if (!previous || !sameDeps(previous.deps, deps)) effects.push(() => { previous?.cleanup?.(); slots[index] = { type: "effect", deps, cleanup: effect() }; }); },
  };
  const clock = {
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay, interval: false }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay, interval: true }); return id; },
    clearInterval(id) { timers.delete(id); },
  };
  const context = vm.createContext({ AbortController, ...clock, window: clock,
    fetch(url, init) {
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      const request = { url, init, settled: false, finish(value, fail = false) { if (request.settled) return; request.settled = true; if (fail) reject(value); else resolve(value); } };
      init.signal.addEventListener("abort", () => request.finish(new Error("isolated abort"), true), { once: true });
      requests.push(request); return promise;
    },
  });
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const output = {}; modules.set(file, output);
    const code = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const run = vm.runInContext(`(function(require,exports){${code}\n})`, context);
    run(id => {
      if (id === "react") return react;
      if (id === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
      if (id === "lucide-react") return new Proxy({}, { get: () => "icon" });
      if (id === "@/lib/identity") return { signInHref: destination => `/api/auth/google/login?return_to=${encodeURIComponent(destination)}` };
      if (id === "@/lib/reliable-request") return load("lib/reliable-request.ts");
      if (id === "@/lib/analytics-response") return load("lib/analytics-response.ts");
      throw new Error(`Unexpected dependency ${id}`);
    }, output);
    return output;
  }
  const component = load(componentFile);
  function render(nextProps = props) { props = nextProps; cursor = 0; effects = []; dirty = false; tree = component.default(props); effects.forEach(effect => effect()); return tree; }
  async function flush() {
    for (let round = 0; round < 6; round++) {
      for (const [id, timer] of [...timers]) if (timer.delay === 0 && !timer.interval) { timers.delete(id); timer.callback(); }
      await new Promise(resolve => setImmediate(resolve));
      if (dirty && mounted) render();
    }
    return tree;
  }
  return { render, flush, requests, component, load, timers, text: () => text(tree), nodes: () => nodes(tree),
    respond(index, payload, status = 200) { requests[index].finish({ ok: status >= 200 && status < 300, status, json: async () => payload }); },
    click(label) { const button = nodes(tree).find(node => node.type === "button" && text(node).trim() === label); assert(button, `button '${label}' not found`); button.props.onClick(); },
    expire() { for (const [id, timer] of [...timers]) if (timer.delay === 15000) { timers.delete(id); timer.callback(); } },
    unmount() { mounted = false; slots.filter(slot => slot?.type === "effect").forEach(slot => slot.cleanup?.()); },
  };
}

test("analytics validator accepts real nullable metrics and rejects malformed financial/date data without mutation", () => {
  const h = harness("components/PortfolioAnalytics.tsx");
  const valid = analytics(), before = JSON.stringify(valid), check = h.load("lib/analytics-response.ts").isAnalyticsResponse;
  assert.equal(check(valid), true); assert.equal(JSON.stringify(valid), before);
  assert.equal(check({ authenticated: false, analytics: null }), true);
  assert.equal(check({ authenticated: true, analytics: null }), true);
  for (const update of [{ totalReturn: "2" }, { totalReturn: Infinity }, { winRate: 101 }, { fillRate: -1 }, { periodDays: -1 }, { maxDrawdown: NaN }, { dailySeries: [{ ...series[0], date: "2026-02-30" }] }, { dailySeries: [...series].reverse() }, { dailySeries: [series[0], series[0]] }]) {
    assert.equal(check({ ...valid, analytics: { ...valid.analytics, ...update } }), false);
  }
  assert.equal(check({ authenticated: false, analytics: valid.analytics }), false);
});

test("analytics error exits loading, retry recovers, and actual series is accessible with percentage-point changes", async t => {
  const h = harness("components/PortfolioAnalytics.tsx"); t.after(h.unmount); h.render();
  assert(h.text().includes("최근 기록을 분석")); assert.equal(h.requests.length, 1);
  h.respond(0, { detail: "격리된 일시 오류" }, 503); await h.flush();
  assert(h.text().includes("투자 분석을 불러오지 못했어요")); assert.equal(h.text().includes("최근 기록을 분석"), false);
  h.click("다시 조회"); await h.flush(); assert.equal(h.requests.length, 2);
  const payload = analytics(), before = JSON.stringify(payload); h.respond(1, payload); await h.flush();
  assert(h.nodes().some(node => node.type === "table")); assert(h.nodes().some(node => node.type === "caption"));
  assert(h.nodes().some(node => node.type === "th" && node.props.scope === "row"));
  assert(h.text().includes("+3.00%p")); assert(h.text().includes("2026-10-23"));
  assert.equal(h.text().includes("2026-10-22"), false, "missing dates must not be invented");
  assert.equal(JSON.stringify(payload), before);
  assert(h.requests.every(request => request.url === "/api/growth/analytics" && !request.init.body && !request.init.method));
});

test("analytics timeout, malformed payload, guest and empty responses all have finite recoverable states", async t => {
  const h = harness("components/PortfolioAnalytics.tsx"); t.after(h.unmount); h.render();
  assert([...h.timers.values()].some(timer => timer.delay === 15000)); h.expire(); await h.flush();
  assert(h.text().includes("불러오지 못했어요"));
  h.click("다시 조회"); await h.flush(); h.respond(1, { authenticated: true, analytics: { totalReturn: "wrong" } }); await h.flush();
  assert(h.text().includes("분석 응답을 확인하지 못했어요")); assert.equal(h.nodes().some(node => node.type === "table"), false);
  h.click("다시 조회"); await h.flush(); h.respond(2, { authenticated: true, analytics: null }); await h.flush();
  assert(h.text().includes("아직 분석할 기록이 없어요"));
  h.click("기록 다시 조회"); await h.flush(); h.respond(3, { detail: "expired" }, 401); await h.flush();
  assert(h.text().includes("로그인이 만료")); assert(h.nodes().some(node => node.type === "a" && node.props.href.includes("/api/auth/google/login")));
  assert.equal(h.text().includes("최근 기록을 분석"), false);
});

test("analytics with no daily snapshots displays no invented curve or zero return", async t => {
  const h = harness("components/PortfolioAnalytics.tsx"); t.after(h.unmount); h.render();
  const payload = analytics(); payload.analytics.dailySeries = []; payload.analytics.periodDays = 0; payload.analytics.totalReturn = null; payload.analytics.dataQuality = "STARTING";
  h.respond(0, payload); await h.flush();
  assert(h.text().includes("아직 일별 수익률 기록이 없어요"));
  assert.equal(h.nodes().some(node => node.type === "table"), false);
  assert.equal(h.text().includes("+0.00%"), false);
});

test("failed and guest statement reads never become fabricated starting assets; successful retry uses server values", async t => {
  const h = harness("components/SimulationControlCenter.tsx", { authenticated: true, onNotice: () => {} }); t.after(h.unmount);
  h.render(); h.click("모의투자 운영센터 거래 가정·계좌 명세·리스크 한눈에 보기 SIMULATION"); await h.flush();
  h.respond(0, { detail: "명세서 연결 오류" }, 500); await h.flush();
  assert(h.text().includes("거래 명세서를 불러오지 못했어요"));
  assert.equal(h.text().includes("100,000,000"), false); assert.equal(h.text().includes("원화 총자산"), false);
  h.click("명세서 다시 조회"); await h.flush(); h.respond(1, { authenticated: false, cash: { KRW: 100000000, USD: 100000 } }); await h.flush();
  assert(h.text().includes("로그인 후 내 거래 명세서")); assert.equal(h.text().includes("원화 총자산"), false);
  // A separate authorized mount must render only its verified account response.
  const own = harness("components/SimulationControlCenter.tsx", { authenticated: true, onNotice: () => {} }); t.after(own.unmount);
  own.render(); own.click("모의투자 운영센터 거래 가정·계좌 명세·리스크 한눈에 보기 SIMULATION"); await own.flush(); own.respond(0, statement()); await own.flush();
  assert(own.text().includes("125,000")); assert(own.text().includes("원화 총자산")); assert.equal(own.text().includes("100,000,000"), false);
});

test("statement validator rejects malformed amounts and auth changes immediately hide old private figures", async t => {
  const props = { authenticated: true, onNotice: () => {} }, h = harness("components/SimulationControlCenter.tsx", props); t.after(h.unmount);
  const value = statement(), before = JSON.stringify(value), check = h.component.isStatementResponse;
  assert.equal(check(value), true); assert.equal(JSON.stringify(value), before);
  assert.equal(check({ ...value, cash: { KRW: "125000", USD: 75 } }), false);
  assert.equal(check({ ...value, positions: [{ symbol: "A", name: "A", currency: "USD", quantity: 1, marketValue: NaN, unrealizedPnl: 0 }] }), false);
  h.render(); h.click("모의투자 운영센터 거래 가정·계좌 명세·리스크 한눈에 보기 SIMULATION"); await h.flush(); h.respond(0, value); await h.flush();
  assert(h.text().includes("125,000"));
  h.render({ ...props, authenticated: false });
  assert.equal(h.text().includes("125,000"), false);
  await h.flush(); h.respond(1, { authenticated: false }); await h.flush();
  assert(h.text().includes("로그인 후 내 거래 명세서"));
});

test("an in-flight statement is aborted when its authentication context changes", async t => {
  const props = { authenticated: true, onNotice: () => {} }, h = harness("components/SimulationControlCenter.tsx", props); t.after(h.unmount);
  h.render(); h.click("모의투자 운영센터 거래 가정·계좌 명세·리스크 한눈에 보기 SIMULATION"); await h.flush();
  h.render({ ...props, authenticated: false }); await h.flush();
  assert.equal(h.requests[0].init.signal.aborted, true);
  h.respond(0, statement()); h.respond(1, { authenticated: false }); await h.flush();
  assert.equal(h.text().includes("125,000"), false);
});
