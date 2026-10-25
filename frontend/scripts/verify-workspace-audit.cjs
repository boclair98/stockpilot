/* eslint-disable @typescript-eslint/no-require-imports */
// Execute the actual components/helpers with isolated hooks and network/timers.
// These are behavior tests, not a substitute for browser layout measurements.
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
const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const KR = { id: "KR:KRX:005930", symbol: "005930", name: "삼성전자", market: "KR", currency: "KRW", exchange: "KRX", price: 70000, changePercent: -1 };
const US = { id: "US:NAS:AAPL", symbol: "AAPL", name: "애플", market: "US", currency: "USD", exchange: "NAS", price: 200, changePercent: 2 };
const stamp = "2026-10-25T01:00:00Z";

function harness(file, initialProps = {}, named = "default") {
  const slots = [], timers = new Map(), requests = [], modules = new Map();
  let cursor = 0, effects = [], dirty = false, tree, props = initialProps, timerId = 0, user = null;
  const react = {
    memo: component => component,
    useState(initial) { const i = cursor++; if (!slots[i]) slots[i] = { value: typeof initial === "function" ? initial() : initial }; return [slots[i].value, value => { const next = typeof value === "function" ? value(slots[i].value) : value; if (!Object.is(next, slots[i].value)) { slots[i].value = next; dirty = true; } }]; },
    useRef(initial) { const i = cursor++; if (!slots[i]) slots[i] = { current: initial }; return slots[i]; },
    useMemo(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { value: fn(), deps }; return slots[i].value; },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(effect, deps) { const i = cursor++, previous = slots[i]; if (!previous || !same(previous.deps, deps)) effects.push(() => { previous?.cleanup?.(); slots[i] = { deps, cleanup: effect() }; }); },
  };
  const clock = {
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms, interval: true }); return id; },
    clearInterval(id) { timers.delete(id); },
  };
  const events = [], notices = [], scrolls = [];
  const context = vm.createContext({ ...clock, AbortController, URLSearchParams, Intl, queueMicrotask,
    requestAnimationFrame: fn => clock.setTimeout(fn, 16), cancelAnimationFrame: id => clock.clearTimeout(id),
    localStorage: { getItem() { throw new Error("storage blocked"); } },
    location: { href: "https://example.test/", assign() {} },
    document: { hidden: false, addEventListener() {}, removeEventListener() {}, getElementById: () => ({ scrollIntoView() {} }) },
    window: { ...clock, scrollTo: value => scrolls.push(value), confirm: () => false, addEventListener() {}, removeEventListener() {} },
    fetch(url, init = {}) { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); requests.push({ url, init, resolve, reject }); init.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }); return promise; },
  });
  function load(relative) {
    if (modules.has(relative)) return modules.get(relative);
    const out = {}; modules.set(relative, out);
    const source = ts.transpileModule(fs.readFileSync(path.join(root, relative), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    vm.runInContext(`(function(require,exports){${source}\n})`, context)(id => {
      if (id === "react") return react;
      if (id === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
      if (id === "lucide-react") return new Proxy({}, { get: () => "icon" });
      if (id === "next/link") return { default: "a" };
      if (id.includes("/identity") || id === "./identity") return { useMe: () => user, signInHref: () => "/login" };
      if (id.includes("firebase-push")) return { browserPushState: () => "unsupported", listenForForegroundPush: async () => () => {}, restoreBrowserPush: async () => null };
      if (id === "./warming") return { tracked: fn => fn() };
      let target = id.startsWith("@/") ? id.slice(2) : path.posix.join(path.posix.dirname(relative), id);
      if (/StockLogo|LeagueRooms|AdSlot|InvestmentLicense|FinancialSafetyReport|PortfolioAnalytics|SignIn|ui\//.test(target)) return { default: "stub", SignInLink: "a", Skeleton: "skeleton" };
      if (!/\.[jt]sx?$/.test(target)) target += fs.existsSync(path.join(root, target + ".ts")) ? ".ts" : ".tsx";
      return load(target);
    }, out);
    return out;
  }
  const component = file ? load(file)[named] : null;
  const render = () => { cursor = 0; effects = []; dirty = false; tree = component(props); effects.forEach(effect => effect()); return tree; };
  const flush = async () => { for (let round = 0; round < 10; round++) { await new Promise(resolve => setImmediate(resolve)); if (dirty) render(); } };
  return { load, render, flush, requests, notices, events, scrolls, nodes: () => nodes(tree), tree: () => tree, text: () => text(tree),
    props(next) { props = next; render(); },
    user(next) { user = next; render(); },
    tick(ms = 0) { for (const [id, timer] of [...timers]) if (timer.ms === ms) { if (!timer.interval) timers.delete(id); timer.fn(); } },
    button(label) { return nodes(tree).find(node => node.type === "button" && (node.props["aria-label"] === label || text(node).replace(/\s+/g, " ").trim() === label)); },
    click(label) { const button = this.button(label); assert(button, `missing button: ${label}`); return button.props.onClick(); },
    respond(index, value, status = 200) { assert(requests[index], `missing request ${index}`); requests[index].resolve({ ok: status >= 200 && status < 300, status, json: async () => value }); },
    unmount() { slots.forEach(slot => slot.cleanup?.()); timers.clear(); },
  };
}

test("watchlist separates status/actions from fields and preserves filters/sort/reset", async t => {
  const h = harness("components/MarketWatchlist.tsx", { items: [KR, US], selectedId: "", onSelect() {}, onRemove() {} }); t.after(h.unmount); h.render();
  const field = name => h.nodes().find(node => node.type === "label" && text(node).startsWith(name));
  field("관심종목 찾기").props.children[1].props.onChange({ target: { value: "삼성" } }); await h.flush(); assert(h.text().includes("전체 2개 중 1개 표시"));
  field("시장").props.children[1].props.onChange({ target: { value: "US" } }); await h.flush(); assert(h.text().includes("조건에 맞는 관심종목이 없어요"));
  h.click("조건 초기화"); await h.flush(); assert(h.text().includes("2개 표시"));
  field("정렬").props.children[1].props.onChange({ target: { value: "change" } }); await h.flush();
  const rows = h.nodes().filter(node => typeof node.type === "function" && node.props.stock); assert.equal(rows[0].props.stock.symbol, "AAPL");
  const fields = h.nodes().find(node => node.props?.className === "watchlist-fields"); assert(!nodes(fields).some(node => node.props?.role === "status"));
  assert(h.nodes().find(node => node.props?.className === "watchlist-scope").props.children.some(node => node.props?.role === "status"));
});

test("shared stock row keeps identity, quote, save and open independent without phantom rank", () => {
  let opened = 0, saved = 0;
  const h = harness("components/StockRow.tsx", { stock: { ...KR, changePercent: NaN }, saved: false, onOpen: () => opened++, onSave: () => saved++ }); h.render();
  assert(h.tree().props.className.includes("without-rank"));
  h.click("삼성전자 상세 보기"); h.click("삼성전자 관심종목 추가"); assert.equal(opened, 1); assert.equal(saved, 1);
  assert(!h.text().includes("NaN"));
  assert(h.nodes().filter(node => node.type === "button").every(button => !nodes(button.props.children).some(child => child.type === "button")));
});

test("browser watchlist import reports partial failures, deduplicates and never replays failed writes", async () => {
  const h = harness(null), lib = h.load("lib/watchlist-import.ts"); let calls = 0;
  const result = await lib.importWatchlist([KR, KR, US], [], async () => ++calls < 2);
  assert.equal(result.imported, 1); assert.equal(result.skipped, 1); assert.equal(result.failed, true); assert.equal(calls, 2);
  assert(lib.watchlistImportMessage(result).includes("저장하지 못했어요"));
  assert(lib.watchlistImportMessage(await lib.importWatchlist([], [], async () => true)).includes("없어요"));
  await assert.rejects(lib.importWatchlist({}, [], async () => true));
});

test("practice quantity rejects empty/negative/fractional/exponential/out-of-range values", () => {
  const lib = harness(null).load("lib/practice-validation.ts");
  for (const value of ["", "0", "-3", ".5", "1.5", "1e3", "Infinity", "10001"]) assert.equal(lib.practiceQuantity(value), null);
  assert.equal(lib.practiceQuantity("1"), 1); assert.equal(lib.practiceQuantity("10000"), 10000);
});

const history = (instrument = KR) => ({ ...instrument, items: [{ date: "20261022", open: 100, high: 110, low: 90, close: 105, volume: 10 }, { date: "20261023", open: 105, high: 115, low: 100, close: 110, volume: 12 }] });
test("practice handles offline reads, exposes retry, and does not trade prior-symbol data", async t => {
  const h = harness("components/PracticeLab.tsx"); t.after(h.unmount); h.render(); h.tick(); await h.flush();
  h.requests[0].reject(new Error("offline")); await h.flush(); assert(h.text().includes("서버에 연결하지 못했어요")); assert(!h.text().includes("준비하고 있어요"));
  h.click("다시 불러오기"); await h.flush(); h.tick(); await h.flush(); h.respond(1, history()); await h.flush(); assert(h.text().includes("2026.10.23"));
  h.nodes().find(node => node.type === "input").props.onChange({ target: { value: "-1" } }); await h.flush(); h.click("가상매수"); await h.flush(); assert(h.text().includes("정수로 입력"));
  h.nodes().find(node => node.type === "button" && text(node).includes("Apple")).props.onClick(); await h.flush();
  assert(!h.button("가상매수"), "old KR history must disappear before the US request starts");
  h.tick(); await h.flush(); h.respond(2, history(KR)); await h.flush(); assert(h.text().includes("선택한 종목"));
});

const league = { title: "리그", participantCount: 1, asOf: stamp, rankings: [{ rank: 1, nickname: "연습왕", returnRate: 1, rankChange: 0, isMe: false }], me: { joined: false }, rules: { startingCapital: "동일 자금", scoring: "수익률", privacy: "비공개", trading: "모의" } };
test("league failure stops the spinner; retry clears error; later failure retains timestamped ranks", async t => {
  const h = harness("components/LeagueBoard.tsx"); t.after(h.unmount); h.render(); h.tick(); await h.flush();
  h.respond(0, {}, 503); await h.flush(); assert(!h.text().includes("계산하고 있어요")); assert(h.button("다시 조회"));
  h.click("다시 조회"); await h.flush(); h.respond(1, league); await h.flush(); assert(h.text().includes("연습왕")); assert(!h.button("다시 조회"));
  h.click("순위 새로고침"); await h.flush(); h.respond(2, {}, 503); await h.flush(); assert(h.text().includes("연습왕")); assert(h.text().includes("이전 조회 결과"));
});

test("feed rejects a failed or malformed response instead of presenting false empty success", async () => {
  const h = harness(null), api = h.load("lib/api.ts");
  const failed = api.fetchFeed(); h.respond(0, {}, 503); await assert.rejects(failed);
  const malformed = api.fetchFeed(); h.respond(1, {}); await assert.rejects(malformed);
  const empty = api.fetchFeed(); h.respond(2, []); assert.equal((await empty).length, 0);
  const removed = api.deletePost("isolated"); h.respond(3, null, 204); await removed;
  const request = h.load("lib/reliable-request.ts");
  const uncertain = request.requestVoid("/isolated", { method: "DELETE" }); h.tick(15000);
  await assert.rejects(uncertain, reason => reason.uncertain === true);
  assert.equal(h.requests.length, 5, "void writes also have a deadline and no automatic retry");
});

test("lounge distinguishes offline from empty and recovers without an unhandled rejection", async t => {
  const h = harness("components/CommunityLounge.tsx"); t.after(h.unmount); h.render(); h.tick(); await h.flush();
  h.requests[0].reject(new Error("offline")); await h.flush(); assert(!h.text().includes("첫 번째 이야기를 기다리고")); assert(h.button("다시 불러오기"));
  h.click("다시 불러오기"); await h.flush(); h.respond(1, []); await h.flush(); assert(h.text().includes("첫 번째 이야기를 기다리고")); assert(!h.button("다시 불러오기"));
});

test("growth failed reads show recovery instead of an endless challenge loader", async t => {
  const h = harness("components/GrowthHub.tsx"); t.after(h.unmount); h.render(); h.tick(); await h.flush();
  h.respond(0, {}, 503); await h.flush(); assert(h.button("다시 조회")); assert(!h.text().includes("문제를 준비하고 있어요"));
});

test("lounge posting cancels stale reads, blocks overlapping refresh, and keeps the confirmed new post", async t => {
  const h = harness("components/CommunityLounge.tsx"); t.after(h.unmount); h.user({ id: "isolated", display_name: "테스트" }); h.tick(); await h.flush();
  h.nodes().find(node => node.type === "textarea").props.onChange({ target: { value: "격리 테스트 게시글" } });
  h.nodes().find(node => node.type === "input" && node.props.type === "checkbox").props.onChange({ target: { checked: true } }); await h.flush();
  const write = h.nodes().find(node => node.type === "form").props.onSubmit({ preventDefault() {} }); await h.flush();
  assert(h.requests[0].init.signal.aborted); h.tick(30000); await h.flush(); assert.equal(h.requests.length, 2, "polling must not replace a post being created");
  h.respond(1, { id: "new", author_id: "isolated", author_name: "테스트", body: "격리 테스트 게시글", created_at: stamp }, 201); await write; await h.flush();
  assert(h.text().includes("격리 테스트 게시글")); assert(h.text().includes("라운지에 공유했어요"));
});

test("investor dashboard and news recover; quote ticks never replace a user's alert draft", async t => {
  const notices = [];
  const props = { selected: KR, authenticated: true, onSelect() {}, onNotice: value => notices.push(value), onAlertSummary() {}, focusAlertsKey: 0 };
  const h = harness("components/InvestorTools.tsx", props); t.after(h.unmount); h.render(); h.tick(); await h.flush();
  h.respond(0, {}, 503); await h.flush(); assert(h.button("다시 조회")); assert(!h.text().includes("투자 도구를 준비하고 있어요"));
  h.click("다시 조회"); await h.flush(); h.respond(1, { authenticated: true, watchlist: [], alerts: [], unreadAlerts: 0, push: { configured: false, deviceCount: 0 }, report: null, missions: [] }); await h.flush();
  let input = h.nodes().find(node => node.type === "input" && node.props["aria-label"] === "목표 가격");
  input.props.onChange({ target: { value: "80000" } }); await h.flush();
  h.props({ ...props, selected: { ...KR, price: 71000 } }); h.tick(); await h.flush();
  input = h.nodes().find(node => node.type === "input" && node.props["aria-label"] === "목표 가격"); assert.equal(input.props.value, "80000");
  input.props.onChange({ target: { value: "1.25" } }); await h.flush();
  await h.nodes().find(node => node.type === "form").props.onSubmit({ preventDefault() {} }); await h.flush();
  assert(notices.some(value => value.includes("정수"))); assert.equal(h.requests.length, 2, "invalid KRW alert must not be sent");
  h.click("종목 뉴스"); await h.flush(); h.respond(2, {}, 503); await h.flush();
  assert(h.text().includes("뉴스를 갱신하지 못했어요")); assert(!h.text().includes("조회된 이 종목의 뉴스가 없어요"));
});

test("company detail ignores an old symbol and treats malformed financial data as recoverable", async t => {
  const h = harness("components/CompanyInsight.tsx", { symbol: KR.symbol, market: "KR" }); t.after(h.unmount); h.render(); await h.flush();
  h.props({ symbol: "000660", market: "KR" }); await h.flush(); assert(h.requests[0].init.signal.aborted);
  h.respond(1, { symbol: KR.symbol, available: true }); await h.flush(); assert(h.text().includes("기업정보를 불러오지 못했어요"));
  h.click("다시 불러오기"); await h.flush(); h.respond(2, { symbol: "000660", available: true, financials: { metrics: {} } }); await h.flush(); assert(h.button("다시 불러오기"));
  h.click("다시 불러오기"); await h.flush(); h.respond(3, { symbol: "000660", available: false }); await h.flush(); assert(h.text().includes("기업정보가 아직 없어요"));
});

test("profile identity request has a finite timeout instead of a permanent loading state", async t => {
  const h = harness("lib/identity.ts", undefined, "useMe"); t.after(h.unmount); h.render(); await h.flush();
  assert.equal(h.tree(), undefined); h.tick(15000); await h.flush(); assert.equal(h.tree(), null);
});

test("saved data ignores a delayed pre-write read and reconciles the confirmed save", async t => {
  const h = harness("lib/cloud-saved.ts", "FAVORITE", "useCloudSaved"); t.after(h.unmount); h.render(); await h.flush();
  h.respond(0, { owner: "isolated-user", items: [] }); await h.flush();
  h.tree().refresh(); await h.flush();
  const saving = h.tree().save(KR.id, KR); await h.flush();
  h.respond(2, { key: KR.id, data: KR, version: 1, deleted: false, updatedAt: stamp }); await saving; await h.flush();
  h.respond(1, { owner: "isolated-user", items: [] }); await h.flush();
  assert.equal(h.tree().items.length, 1, "a read begun before the write must not erase it");
  h.respond(3, { owner: "isolated-user", items: [{ key: KR.id, data: KR, version: 1, deleted: false, updatedAt: stamp }] }); await h.flush(); assert.equal(h.tree().items.length, 1);
});

test("watchlist layout uses its own container and status row; no 112px phantom quote column", () => {
  const css = fs.readFileSync(path.join(root, "app/watchlist-layout.css"), "utf8");
  assert(css.includes("container: watchlist / inline-size")); assert(css.includes("@container watchlist (max-width: 430px)"));
  assert(css.includes(".watchlist-scope")); assert(css.includes("grid-auto-flow: row"));
  assert(css.includes(".consumer-app.view-watch .instrument-browser { display: none; }"));
  assert(!css.includes("overflow-x: hidden"));
  const readability = fs.readFileSync(path.join(root, "app/service-readability.css"), "utf8");
  assert(readability.includes(":not(.up, .down, .positive, .negative)"), "financial colors must not become generic metadata colors");
  assert(readability.includes('html[data-theme="dark"]'));
  assert(readability.includes("font-size: 12px"));
  const chart = fs.readFileSync(path.join(root, "components/StockTrendPanel.tsx"), "utf8");
  assert(chart.indexOf('className="broker-chart-canvas"') < chart.indexOf('className="broker-chart-inspection"'), "the price chart must precede its detailed inspection on mobile as well as in DOM order");
});

test("primary views start at the top after commit without jumping on same-view refreshes", () => {
  const h = harness("lib/workspace-scroll.ts", "MARKET", "useWorkspaceStart"); h.render(); h.tick(16); assert.equal(h.scrolls.length, 0);
  for (const view of ["WATCH", "ASSETS", "RECORDS"]) {
    h.props(view); h.tick(16); const count = h.scrolls.length; assert.equal(h.scrolls.at(-1).top, 0);
    h.props(view); h.tick(16); assert.equal(h.scrolls.length, count, "filtering or quote updates must not reset scroll");
  }
  h.props("WATCH"); h.unmount(); h.tick(16); assert.equal(h.scrolls.length, 3, "unmount cancels the queued frame");
});

test("direct detail entry renders primary content without waiting for intersection and retains it", async () => {
  const h = harness("components/DeferredMount.tsx", { children: "primary chart", eager: true });
  h.render(); assert.equal(h.text(), "primary chart");
  assert.equal(h.tree().props.style.minHeight, undefined);
  h.tick(16); await h.flush(); h.props({ children: "primary chart", eager: false });
  assert.equal(h.text(), "primary chart", "returning to the market must not unload mounted content");
  h.unmount();
  const terminal = fs.readFileSync(path.join(root, "components/TradingTerminal.tsx"), "utf8");
  assert.match(terminal, /<DeferredMount[^>]+eager=\{workspaceView === "DETAIL"\}>\s*<StockTrendPanel/);
  assert.match(terminal, /<DeferredMount[^>]+eager=\{workspaceView === "DETAIL"\}>\s*<CompanyInsight/);
});
