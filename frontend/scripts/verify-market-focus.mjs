// Opt-in browser QA against the static loopback preview. No submit or live traffic.
// Start preview-functional.mjs with UPGRADE_FIXTURE=1 from the candidate frontend.
// STOCKPILOT_VERIFY_URL=http://127.0.0.1:<port> node scripts/verify-market-focus.mjs
// Optional: --screenshots=<directory>.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const origin = process.env.STOCKPILOT_VERIFY_URL ?? "";
assert(
  /^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(origin)
    && new URL(origin).origin === origin,
  "Use a literal loopback fixture origin",
);
const args = process.argv.slice(2);
assert(args.length <= 1 && args.every((arg) => /^--screenshots=.+$/.test(arg)), "Invalid market-focus test argument");
const output = args[0] ? resolve(args[0].slice("--screenshots=".length)) : null;
if (output) await mkdir(output, { recursive: true });

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.STOCKPILOT_PLAYWRIGHT || "playwright");
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.STOCKPILOT_BROWSER_EXECUTABLE || undefined,
  args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"],
});
const viewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
];
const searchName = /(?:종목명|회사명).*종목코드.*티커 검색/;
const stockName = "삼성전자";
const indexFixture = (refreshed) => ({
  name: "KOSPI",
  value: refreshed ? 6088.42 : 5555.55,
  change: 10,
  changePercent: 0.2,
  asOf: refreshed ? "2026-10-23T01:00:00Z" : "2026-10-22T01:00:00Z",
  source: "격리된 로컬 검증 자료",
  points: [{ date: "2026-10-22", close: 5555.55 }],
});

const shot = (page, name) => output
  ? page.screenshot({ path: join(output, `${name}.png`), animations: "disabled" })
  : Promise.resolve();

async function assertNoOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert(dimensions.document <= dimensions.viewport + 1 && dimensions.body <= dimensions.viewport + 1,
    `${label}: horizontal overflow ${JSON.stringify(dimensions)}`);
}

async function assertBalanceLabels(overview) {
  const labels = await overview.locator(".balance-card").evaluate((card) => {
    const luminance = (color) => color.match(/[\d.]+/g).slice(0, 3).map(Number).map((value) => {
      const s = value / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    }).reduce((total, value, i) => total + value * [0.2126, 0.7152, 0.0722][i], 0);
    const surface = luminance(getComputedStyle(card).backgroundColor);
    return [...card.querySelectorAll(".balance-detail > span")].slice(0, 2).map((label) => {
      const color = getComputedStyle(label).color;
      const numbers = color.match(/[\d.]+/g);
      if (numbers.length === 4 && Number(numbers[3]) < 1) return 1;
      const ink = luminance(color);
      return (Math.max(surface, ink) + 0.05) / (Math.min(surface, ink) + 0.05);
    });
  });
  assert(labels.length === 2 && labels.every((ratio) => ratio >= 4.5), `Unreadable cash labels: ${labels.join(", ")}`);
}

async function assertInitiallyReachable(page, locator, label) {
  const target = await locator.evaluate((element) => {
    const { x, y, width, height, bottom } = element.getBoundingClientRect();
    const hit = document.elementFromPoint(x + width / 2, y + height / 2);
    return { x, y, width, height, bottom, overlay: !element.contains(hit), scroll: scrollY };
  });
  assert.equal(target.scroll, 0, `${label}: verify from the initial viewport before scrolling`);
  assert(target.width > 0 && target.height > 0 && target.y >= -1 && target.bottom <= await page.evaluate(() => innerHeight) + 1
    && !target.overlay, `${label}: not fully in view and reachable ${JSON.stringify(target)}`);
}

async function assertLayout(page, viewport, stage, searchCard, rankings, overview) {
  const order = await page.evaluate(() => {
    const stage = document.querySelector("main .market-discovery-stage");
    const search = document.getElementById("search-card");
    const rankings = document.querySelector(".market-rankings-panel");
    const overview = document.getElementById("market-overview");
    if (!stage || !search || !rankings || !overview) return false;
    const before = (first, next) => Boolean(first.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING);
    return stage.contains(search) && stage.contains(rankings) && !rankings.contains(search)
      && before(search, rankings) && before(rankings, overview) && before(search, overview);
  });
  assert(order, "Search, rankings and overview must be in that DOM order, with both primary sections in the discovery stage");
  const [stageBox, searchBox, rankingsBox, overviewBox] = await Promise.all(
    [stage, searchCard, rankings, overview].map((locator) => locator.boundingBox()),
  );
  assert(stageBox && searchBox && rankingsBox && overviewBox, "The primary stage and auxiliary overview must have a visible layout");
  const rightOf = overviewBox.x >= stageBox.x + stageBox.width - 2;
  const below = overviewBox.y >= rankingsBox.y + rankingsBox.height - 2;
  if (viewport.width === 1440) {
    assert(rightOf && !below, "Desktop overview must sit in a right column next to the discovery stage");
  } else {
    assert(below, `${viewport.width}px: overview must follow the primary sections visually`);
  }
}

async function verify(viewport, theme, recovery = false) {
  const label = `market-focus-${theme}-${viewport.width}`;
  const context = await browser.newContext({ viewport, colorScheme: theme, locale: "ko-KR", reducedMotion: "reduce", serviceWorkers: "block" });
  const unexpectedWrites = [];
  const errors = [];
  const sameOriginSearchStatuses = [];
  const verifyIndex = viewport.width === 1440 && theme === "dark";
  let pendingSearchFault = recovery;
  let refreshIndex = false;
  let page;
  try {
    await context.addInitScript((mode) => {
      localStorage.setItem("stockpilot:display:v1", JSON.stringify({ dark: mode === "dark", compact: false, privateMode: false }));
      localStorage.setItem("stockpilot_onboarding_v2", "done");
    }, theme);
    await context.routeWebSocket("**/*", (socket) => socket.close());
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() !== "GET" && request.method() !== "HEAD") {
        unexpectedWrites.push(`${request.method()} ${url.pathname}`);
        return route.abort();
      }
      if (url.origin !== origin || /^\/api\/auth(?:\/|$)/.test(url.pathname)) return route.abort();
      if (verifyIndex && url.pathname === "/api/trading/bootstrap") {
        const response = await route.fetch({ maxRedirects: 0 });
        return route.fulfill({ response, json: { ...await response.json(), kospi: indexFixture(false) } });
      }
      if (verifyIndex && url.pathname === "/api/trading/kospi") {
        return route.fulfill({ json: indexFixture(refreshIndex) });
      }
      if (pendingSearchFault && url.pathname === "/api/trading/search" && url.searchParams.get("q") === "삼성") {
        pendingSearchFault = false;
        return route.fulfill({ status: 503, json: { detail: "격리 검증: 일시적인 검색 실패" } });
      }
      return route.continue();
    });
    page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.origin === origin && url.pathname === "/api/trading/search" && url.searchParams.get("q") === "삼성") {
        sameOriginSearchStatuses.push(response.status());
      }
    });
    const navigation = await page.goto(`${origin}/?release_case=normal`, { waitUntil: "domcontentloaded" });
    assert(navigation?.ok(), "Market navigation failed");
    await page.waitForFunction((mode) => document.documentElement.dataset.theme === mode, theme);
    await page.evaluate(() => document.fonts.ready);
    const stage = page.locator("main .market-discovery-stage");
    const searchCard = stage.locator("#search-card");
    const rankings = stage.locator(".market-rankings-panel");
    const overview = page.locator("#market-overview");
    const search = searchCard.getByRole("textbox", { name: searchName })
      .or(searchCard.getByRole("searchbox", { name: searchName }));
    const rankedStock = rankings.getByRole("button", { name: "삼성전자 상세 보기", exact: true }).first();
    await rankedStock.waitFor();
    await search.waitFor();
    await assertLayout(page, viewport, stage, searchCard, rankings, overview);
    await assertInitiallyReachable(page, search, "Search input");
    await assertInitiallyReachable(page, rankedStock, "First ranked fixture stock");
    await assertNoOverflow(page, "Market");
    if (viewport.width === 1440) {
      await overview.locator(".balance-detail > span").first().waitFor();
      await assertBalanceLabels(overview);
    }
    await shot(page, label);
    const index = overview.locator(".market-index-card");
    if (verifyIndex) {
      await index.getByText("5,555.55", { exact: true }).waitFor();
      const reload = index.getByRole("button", { name: "KOSPI 지수 다시 조회", exact: true });
      refreshIndex = true;
      await reload.click();
      await index.getByText("6,088.42", { exact: true }).waitFor();
    }

    await search.focus();
    assert(await search.evaluate((element) => document.activeElement === element), "Inline search should accept keyboard focus");
    await search.fill("삼성");
    const results = searchCard.locator("#search-results");
    if (recovery) {
      const failure = results.getByRole("alert");
      await failure.waitFor();
      assert.match(await failure.innerText(), /검색을 불러오지 못했어요/);
      assert.equal(await results.getByRole("button", { name: /삼성전자/ }).count(), 0, "A failed search must not offer a stale result");
      await failure.getByRole("button", { name: "다시 검색", exact: true }).press("Enter");
    }
    const result = results.getByRole("button", { name: /삼성전자/ }).first();
    await result.waitFor();
    assert.match(await result.innerText(), /005930/);
    assert.deepEqual(sameOriginSearchStatuses, recovery ? [503, 200] : [200], "Search must use the isolated route and recover by reissuing the read");
    await search.press("Enter");
    const detailHeading = page.locator(".view-detail .instrument-identity").getByRole("heading", { name: stockName, exact: true });
    await detailHeading.waitFor();
    assert.match(page.url(), /(?:[?&])symbol=005930(?:&|$)/, "Detail identity does not match the selected stock");
    const detailQuote = page.locator(".view-detail .instrument-quote strong");
    await detailQuote.filter({ hasText: "72,000" }).waitFor();
    await assertNoOverflow(page, "Stock detail");
    await shot(page, `${label}-detail`);

    const ticket = page.locator(".view-detail #order-ticket");
    const mobile = viewport.width <= 1023;
    const opener = page.locator(".view-detail .mobile-ticket-trigger");
    if (mobile) {
      await opener.waitFor();
      assert(await opener.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return box.height >= 44 && element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
      }), "Mobile order entry is too small or occluded");
      await opener.press("Enter");
    }
    await ticket.waitFor();
    if (mobile) assert.equal(await ticket.getAttribute("role"), "dialog");
    await ticket.getByRole("heading", { name: stockName, exact: true }).waitFor();
    const confirmEntry = ticket.getByRole("button", { name: "모의 매수 주문 확인", exact: true });
    await confirmEntry.waitFor();
    assert(await confirmEntry.isEnabled(), "The authenticated local fixture should reach the order entry");
    await assertNoOverflow(page, "Order entry");
    await shot(page, `${label}-order`);
    if (mobile) {
      await page.keyboard.press("Escape");
      await ticket.waitFor({ state: "hidden" });
      await page.waitForFunction(() => document.activeElement?.classList.contains("mobile-ticket-trigger"));
    }
    await page.goBack({ waitUntil: "domcontentloaded" });
    await page.locator(".view-market").waitFor();
    await assertNoOverflow(page, "Returned market");
    if (verifyIndex) await index.getByText("6,088.42", { exact: true }).waitFor();
    assert.deepEqual(errors, [], "Unexpected page errors");
    assert.deepEqual(unexpectedWrites, [], "A market/detail/order-entry check may not send writes");
    return { width: viewport.width, height: viewport.height, theme, recovered: recovery, writes: unexpectedWrites.length };
  } catch (error) {
    if (page) await shot(page, `${label}-failure`).catch(() => {});
    throw new Error(`${label}: ${error.message}`, { cause: error });
  } finally {
    await context.close();
  }
}

try {
  const cases = [];
  for (const viewport of viewports) cases.push(await verify(viewport, "dark", viewport.width === 390));
  for (const viewport of [viewports[1], viewports[3]]) cases.push(await verify(viewport, "light"));
  console.log(JSON.stringify({ mode: "isolated-loopback", cases }, null, 2));
} finally {
  await browser.close();
}
