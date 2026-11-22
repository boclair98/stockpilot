// Chromium regression suite for the local static preview only. No writes.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const base = process.env.STOCKPILOT_VERIFY_URL ?? "";
assert.match(base, /^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/);
assert.equal(new URL(base).origin, base);
const output = process.env.STOCKPILOT_VERIFY_OUTPUT;
if (output) await mkdir(output, { recursive: true });
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.STOCKPILOT_PLAYWRIGHT || "playwright");
const browser = await chromium.launch({
  executablePath: process.env.STOCKPILOT_BROWSER_EXECUTABLE || undefined,
  args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"],
});
const fixtures = ["360,800,dark", "390,844,dark", "768,1024,dark", "1440,900,dark", "390,844,light", "1440,900,light"];
const cases = [];
const empty = "아직 보유한 주식이 없어요";

async function noOverflow(page) {
  const width = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }));
  assert(width.document <= width.viewport + 1, JSON.stringify(width));
}

async function run(width, height, theme) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, reducedMotion: "reduce", locale: "ko-KR", serviceWorkers: "block" });
  const page = await context.newPage();
  const errors = [];
  const writes = [];
  let scenario = "failure";
  let portfolioReads = 0;
  let historyFilter = null;
  page.on("pageerror", error => errors.push(error.message));
  await context.routeWebSocket("**/*", socket => socket.close());
  await context.addInitScript(dark => {
    localStorage.setItem("stockpilot:display:v1", JSON.stringify({ dark, compact: false, privateMode: false }));
    localStorage.setItem("stockpilot_onboarding_v2", "done");
  }, theme === "dark");
  await context.route("**/*", async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== base) return route.abort();
    if (req.method() !== "GET" && req.method() !== "HEAD") {
      writes.push(req.method() + " " + url.pathname);
      return route.abort();
    }
    if (url.pathname.startsWith("/api/auth/")) return route.abort();
    if (url.pathname === "/api/trading/orders/history") {
      if (url.searchParams.get("status") === "OPEN" && url.searchParams.get("market") === "US") historyFilter = Object.fromEntries(url.searchParams);
    }
    if (url.pathname !== "/api/trading/portfolio") return route.continue();
    portfolioReads++;
    if (scenario === "failure") return route.fulfill({status: 503, json: {}});
    if (scenario === "normal") return route.continue();
    const actual = await route.fetch();
    const body = await actual.json();
    const positions = scenario === "partial" ? body.positions.slice(0, 2) : [];
    return route.fulfill({ json: { ...body, positions, estimatedPositions: 0, authenticated: scenario !== "guest", positionCoverageComplete: scenario !== "partial" } });
  });
  try {
    const assets = page.locator(".view-assets");
    const balance = assets.locator(".balance-card");
    const holdings = assets.locator(".holdings-panel");
    await page.goto(base + "/#holdings");
    await holdings.getByText("보유 주식을 확인하지 못했어요").waitFor();
    assert(await holdings.getByText(empty).isHidden());
    assert(await balance.locator(":scope > strong").isHidden());
    assert(Math.abs((await balance.boundingBox()).width - (await holdings.boundingBox()).width) < 2, "The short holdings state must not shrink the column");
    await noOverflow(page);
    if (output) await page.screenshot({path:join(output,`assets-failure-${width}-${theme}.png`)});

    async function recover(next) {
      scenario = next;
      await balance.getByRole("button", {name: "다시 확인", exact: true}).press("Enter");
    }
    await recover("partial");
    await holdings.getByText("일부 보유 종목을 확인하지 못했어요").waitFor();
    assert(await holdings.getByText(empty).isHidden());
    assert.equal(await holdings.locator(".holdings-list li").count(), 2);
    assert.equal(await balance.getByText("보유 종목 확인 필요").count(), 2);
    assert.equal(await balance.getByText("원화 현금 · 달러 별도").count(), 1);
    assert.equal(await balance.locator(":scope > strong").innerText(), "₩100,000,000");
    const retry = holdings.getByRole("button", {name: "잔고 다시 확인",exact:true});
    assert((await retry.boundingBox()).height >= 44);
    await noOverflow(page);
    if (output) await page.screenshot({path:join(output,`assets-partial-${width}-${theme}.png`)});

    scenario = "failure";
    await retry.press("Enter");
    await balance.getByText("마지막으로 확인한 잔고").waitFor();
    assert.equal(await holdings.locator(".holdings-list li").count(), 2);
    assert.equal(await holdings.getByRole("button", {name: "잔고 다시 확인",exact:true}).count(), 0);
    assert(await holdings.getByText(empty).isHidden());

    await recover("empty");
    await holdings.getByText(empty).waitFor();
    assert(await holdings.getByRole("link", {name: "주식 둘러보기"}).isVisible());
    scenario = "guest";
    await page.reload();
    const login = holdings.getByRole("link", {name:"Google로 로그인"});
    await login.waitFor();
    assert.equal(await login.getAttribute("href"), "/api/auth/google/login?return_to=%2F%23holdings");
    assert(await holdings.getByText(empty).isHidden());
    assert.equal(await holdings.locator(".holdings-list li").count(), 0);

    if (theme === "dark") {
      scenario = "normal";
      await page.goto(base + "/?qa=journey");
      const nav = page.locator(width >= 1024 ? ".workspace-primary" : ".mobile-service-nav");
      await nav.getByRole("link", {name:/관심/}).click();
      const watch = page.locator(".view-watch");
      const saved = watch.locator(".favorite-board").getByRole("button", {name:/삼성전자 상세 보기/});
      await saved.first().click();
      await page.locator(".view-detail .instrument-heading").getByRole("heading", {name:"삼성전자",exact:true}).waitFor();
      await nav.getByRole("link", {name:"내 자산",exact:true}).click();
      const stock = name => holdings.getByRole("button", {name: `${name} 종목 상세 보기`, exact: true});
      await stock("삼성전자").waitFor();
      await holdings.getByRole("combobox", {name:/시장/}).selectOption("US");
      await stock("애플").waitFor();
      assert(await stock("삼성전자").isHidden());
      await noOverflow(page);

      await nav.getByRole("link", {name:/투자 기록|매매 기록/}).click();
      const records = page.locator(".view-records");
      const rows = records.locator(".history-list");
      await rows.getByText("체결", {exact:true}).first().waitFor();
      const filters = records.locator(".history-filters");
      await filters.getByRole("combobox", {name:/시장/}).selectOption("US");
      await filters.getByText("기간·상태 필터", {exact:true}).click();
      await filters.getByRole("combobox", {name:/상태/}).selectOption("OPEN");
      await filters.getByRole("button", {name:"조회하기", exact:true}).press("Enter");
      await rows.getByText("조건 대기", {exact:true}).first().waitFor();
      assert.equal(await rows.getByText("체결", {exact:true}).count(), 0);
      assert(historyFilter?.market === "US" && historyFilter?.status === "OPEN");
      await noOverflow(page);
      if (output) await page.screenshot({path:join(output,`records-${width}-${theme}.png`)});
    }
    assert(portfolioReads >= 5);
    assert.deepEqual(writes, []);
    assert.deepEqual(errors, []);
    cases.push({width,height,theme,writes:0,states:"first failure → partial → previous → confirmed empty → guest",workflow:theme==="dark"});
  } finally {
    await context.close();
  }
}
try {
  for (const entry of fixtures) {
    const [w,h,theme] = entry.split(",");
    await run(Number(w), Number(h), theme);
  }
  console.log(JSON.stringify({mode:"isolated-loopback",cases},null,2));
} finally {
  await browser.close();
}
