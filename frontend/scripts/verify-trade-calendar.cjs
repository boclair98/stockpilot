// Compile the actual component/helpers; only hooks and network are isolated.
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
const summary = (currency, values = {}) => ({ currency, count: 0, buyCount: 0, sellCount: 0, buyAmount: 0, sellAmount: 0, fees: 0, taxes: 0, realizedPnl: 0, ...values });
function payload(month) {
  const kr = summary("KRW", { count: 1, buyCount: 1, buyAmount: 10000, fees: 1.5 });
  const us = summary("USD", { count: 1, sellCount: 1, sellAmount: 123.4567, realizedPnl: -5 });
  return { month, timezone: "Asia/Seoul", basis: "execution", asOf: "2026-10-25T01:00:00Z", days: [{ date: `${month}-03`, currencies: [kr, us], unknownCurrencyCount: 0, legacyDateCount: 1 }], totals: [kr, us], unknownCurrencyCount: 0, legacyDateCount: 1 };
}
function harness() {
  const slots = [], requests = [], modules = new Map(), selected = [];
  let cursor = 0, effects = [], dirty = false, tree, props = { authenticated: true, onSelectDate: date => selected.push(date) };
  const react = {
    useId: () => "calendar-test",
    useState(initial) { const index = cursor++; if (!slots[index]) slots[index] = { value: typeof initial === "function" ? initial() : initial }; return [slots[index].value, value => { const next = typeof value === "function" ? value(slots[index].value) : value; if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; } }]; },
    useEffect(effect, deps) { const index = cursor++, previous = slots[index]; if (!previous || previous.deps.some((dep, i) => !Object.is(dep, deps[i]))) effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: effect() }; }); },
  };
  const context = vm.createContext({ AbortController, setTimeout, clearTimeout, Intl, URLSearchParams,
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
  const component = load("components/TradeCalendar.tsx").default;
  const render = (next = props) => { props = next; cursor = 0; effects = []; dirty = false; tree = component(props); effects.forEach(effect => effect()); return tree; };
  const flush = async () => { for (let round = 0; round < 5; round++) { await new Promise(resolve => setImmediate(resolve)); if (dirty) render(); } };
  return { load, render, flush, requests, selected, text: () => text(tree), nodes: () => nodes(tree),
    click(label) { const button = nodes(tree).find(node => node.type === "button" && (node.props["aria-label"] === label || text(node).trim() === label)); assert(button, label); button.props.onClick(); },
    respond(index, data, status = 200) { requests[index].resolve({ ok: status >= 200 && status < 300, status, json: async () => data }); },
    unmount() { slots.forEach(slot => slot.cleanup?.()); },
  };
}
test("calendar month math and financial response validation use real dates and separate currencies", t => {
  const h = harness(); t.after(h.unmount); const lib = h.load("lib/trade-calendar.ts");
  assert.equal(lib.currentKstMonth(new Date("2024-01-31T15:00:00Z")), "2024-02");
  assert.equal(lib.shiftCalendarMonth("2024-12", 1), "2025-01");
  assert.equal(lib.shiftCalendarMonth("1900-01", -1), "1900-01");
  assert.equal(lib.calendarCells("2024-02").filter(Boolean).length, 29);
  assert.equal(lib.calendarCells("2023-02").filter(Boolean).length, 28);
  const valid = payload("2024-02"), check = value => lib.isTradeActivity(value, "2024-02");
  assert(check(valid));
  for (const update of [{ month: "2024-03" }, { timezone: "UTC" }, { asOf: "2024-02-01" }, { legacyDateCount: 999 }, { days: [{ ...valid.days[0], date: "2024-02-30" }] }, { days: [...valid.days, ...valid.days] }, { totals: [valid.totals[0], valid.totals[0]] }, { totals: [{ ...valid.totals[0], buyAmount: Infinity }, valid.totals[1]] }, { totals: [{ ...valid.totals[0], count: 50 }, valid.totals[1]] }]) assert.equal(check({ ...valid, ...update }), false);
  const missing = JSON.parse(JSON.stringify(valid)); missing.days[0].currencies[1].realizedPnl = missing.totals[1].realizedPnl = null;
  assert(check(missing)); missing.totals[1].realizedPnl = 0; assert.equal(check(missing), false);
  assert.equal(lib.activityMoney(null, "KRW"), "확인 필요");
  assert.equal(lib.activityMoney(-5, "USD", true), "−US$5");
});
test("calendar returns dates through the actual action and ignores outdated responses", async t => {
  const h = harness(); t.after(h.unmount); h.render(); await h.flush();
  const firstMonth = h.requests[0].url.split("=")[1];
  h.click("이전 달"); await h.flush(); assert(h.requests[0].init.signal.aborted);
  const month = h.requests[1].url.split("=")[1]; assert.notEqual(firstMonth, month);
  h.respond(0, payload(firstMonth)); h.respond(1, payload(month)); await h.flush();
  assert(h.text().includes("체결 요약")); assert(h.text().includes("체결 시각이 없는 과거 기록"));
  h.click(`${month}-03, 체결 2건`); await h.flush(); h.click("이날 체결 내역 보기");
  assert.deepEqual(h.selected, [`${month}-03`]);
  assert(h.requests.every(request => !request.init.method && !request.init.body && request.init.cache === "no-store"));
  const requestCount = h.requests.length;
  h.render({ authenticated: false, onSelectDate: () => {} }); await h.flush();
  assert(h.text().includes("로그인하고 확인하기")); assert.equal(h.requests.length, requestCount);
  assert.equal(h.nodes().some(node => node.props?.className === "trade-calendar-grid"), false);
});
test("calendar error, retry, empty month and expired session are distinct states", async t => {
  const h = harness(); t.after(h.unmount); h.render(); await h.flush();
  const month = h.requests[0].url.split("=")[1];
  h.respond(0, { detail: "일시 오류" }, 503); await h.flush(); assert(h.text().includes("일시 오류"));
  h.click("다시 조회"); await h.flush(); h.respond(1, { ...payload(month), days: [], totals: [summary("KRW"), summary("USD")], legacyDateCount: 0 }); await h.flush();
  assert(h.text().includes("이달에는 체결된 주문이 없어요"));
  h.click("새로고침"); await h.flush(); h.respond(2, { detail: "expired" }, 401); await h.flush();
  assert(h.text().includes("로그인이 만료됐어요")); assert.equal(h.nodes().some(node => node.props?.className === "trade-calendar-grid"), false);
});
