// Isolated browser QA. Run preview-functional.mjs with UPGRADE_FIXTURE=1.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const origin = process.env.STOCKPILOT_VERIFY_URL ?? "";
assert(/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(origin) && new URL(origin).origin === origin, "Use a literal loopback origin");
const args = process.argv.slice(2);
assert(args.length <= 1 && args.every((arg) => /^--screenshots=.+$/.test(arg)));
const output = args[0] ? resolve(args[0].slice("--screenshots=".length)) : null;
if (output) await mkdir(output, { recursive: true });
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.STOCKPILOT_PLAYWRIGHT || "playwright");
const browser = await chromium.launch({
  executablePath: process.env.STOCKPILOT_BROWSER_EXECUTABLE || undefined,
  args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"],
});

async function verify({ width, height, theme, failure }) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, locale: "ko-KR", reducedMotion: "reduce", serviceWorkers: "block" });
  const US = failure === "quote";
  const [symbol, market, exchange, name] = US ? ["AAPL", "US", "NAS", "애플"] : ["005930", "KR", "KRX", "삼성전자"];
  let failQuote = US;
  let failAccount = failure === "account";
  const pageErrors = [], writes = [];
  const label = `detail-${theme}-${width}${failure ? "-" + failure : ""}`;
  let page;
  async function shot(suffix = "") {
    if (output) await page.screenshot({ path: join(output, label + suffix + ".png"), animations: "disabled" });
  }
  try {
    await context.addInitScript((dark) => {
      localStorage.setItem("stockpilot:display:v1", JSON.stringify({ dark, compact: false, privateMode: false }));
      localStorage.setItem("stockpilot_onboarding_v2", "done");
    }, theme === "dark");
    await context.routeWebSocket("**/*", (socket) => socket.close());
    await context.route("**/*", async (route) => {
      const req = route.request(), url = new URL(req.url());
      if (!["GET", "HEAD"].includes(req.method())) { writes.push(req.method() + " " + url.pathname); return route.abort(); }
      if (url.origin !== origin || /^\/api\/auth(?:\/|$)/.test(url.pathname)) return route.abort();
      if (US && url.pathname === "/api/trading/bootstrap") {
        const res = await route.fetch({ maxRedirects: 0 });
        const data = await res.json();
        return route.fulfill({ response: res, json: { ...data, quotes: data.quotes.filter((quote) => quote.symbol !== symbol) } });
      }
      if (failQuote && url.pathname === "/api/trading/quote" && url.searchParams.get("symbol") === symbol) {
        return route.fulfill({ status: 503, json: { detail: "격리 시세 오류" } });
      }
      if (failAccount && url.pathname === "/api/trading/portfolio") return route.fulfill({ status: 503, json: { detail: "격리 잔고 오류" } });
      return route.continue();
    });
    page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const params = new URLSearchParams({ view: "detail", symbol, market, exchange, release_case: "normal" });
    assert((await page.goto(`${origin}/?${params}`, { waitUntil: "domcontentloaded" })).ok());
    const details = page.locator(".view-detail");
    const header = details.locator(".instrument-heading");
    const quote = header.locator(".instrument-quote");
    if (US) {
      const unknown = quote.getByText("시세 조회 실패", { exact: true });
      await unknown.waitFor();
      assert.doesNotMatch((await unknown.getAttribute("class")) ?? "", /\b(?:up|down)\b/);
      assert.equal(await quote.locator("strong").textContent(), "—");
      assert.equal(await header.locator(".instrument-meta time").count(), 0);
      await shot("-initial");
      failQuote = false;
      await details.getByRole("button", { name: "시세 다시 조회", exact: true }).press("Enter");
    }
    await header.getByRole("heading", { name, exact: true }).waitFor();
    assert.match(await quote.locator("strong").innerText(), US ? /220\.00/ : /72,000/);
    if (US) {
      await details.locator(".instrument-quote-recovery").waitFor({ state: "hidden" });
      assert.equal(await page.locator(".toast").filter({ hasText: "이 종목의 시세" }).count(), 0);
    }
    const timestamp = header.locator(".instrument-meta time");
    assert.match(await timestamp.innerText(), /조회.*한국시간/);
    assert(Number.isFinite(Date.parse(await timestamp.getAttribute("datetime"))));
    const chart = details.locator(".broker-chart");
    await chart.locator(".broker-chart-canvas svg").waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => window.scrollTo(0, 0));
    const [nameBox, priceBox, timestampBox, chartBox] = await Promise.all([
      header.locator(".instrument-identity").boundingBox(), quote.boundingBox(), timestamp.boundingBox(), chart.boundingBox(),
    ]);
    assert(nameBox && priceBox && timestampBox && chartBox);
    assert(priceBox.y >= nameBox.y + nameBox.height - 1 && Math.abs(priceBox.x - nameBox.x) < 3, "Keep symbol and price together");
    assert(chartBox.y > timestampBox.y && chartBox.y < height - 120, "Chart controls must remain reachable in the initial view");
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
    assert(fits, "Detail must fit the viewport");
    const ticket = details.locator("#order-ticket");
    const trigger = details.locator(".mobile-ticket-trigger");
    const notice = page.getByRole("region", { name: "잔고 조회 상태" });
    if (failure === "account") {
      const accountRetry = page.getByRole("button", { name: "계정 다시 확인", exact: true });
      await accountRetry.waitFor();
      assert(await accountRetry.locator("svg").isVisible(), "The mobile retry control must have a visible icon");
    }
    await shot();
    if (width < 1024) {
      assert(await ticket.isHidden(), "Mobile ticket must not show before opening");
      assert(await trigger.isVisible() && (await trigger.boundingBox()).height >= 44);
      if (width === 390) {
        const canvas = await chart.locator(".broker-chart-canvas").boundingBox();
        assert((await trigger.boundingBox()).y - canvas.y >= 55, "Keep part of the plot visible above the fixed order button");
      }
      assert(await notice.isHidden(), "Account warning must stay with the order sheet, not above public research");
      await trigger.press("Enter");
      assert.equal(await ticket.getAttribute("role"), "dialog");
    } else {
      assert(await ticket.isVisible() && await trigger.isHidden());
      assert((await ticket.boundingBox()).x > priceBox.x + priceBox.width, "Use an adjacent desktop ticket");
    }
    if (failure === "account") {
      const retry = ticket.getByRole("button", { name: "잔고 다시 확인", exact: true });
      await retry.waitFor();
      assert.equal(await notice.count(), 1);
      assert(await ticket.locator(".quick-quantity").isHidden(), "Unverified cash must not show a buy capacity");
      await shot("-account-sheet");
      failAccount = false;
      await retry.press("Enter");
      await notice.waitFor({ state: "hidden" });
      await ticket.getByText(/^주문 가능 금액 기준 · 최대 /).waitFor();
    }
    await ticket.getByRole("button", { name: "모의 매수 주문 확인", exact: true }).waitFor();
    if (width < 1024) {
      await page.keyboard.press("Escape");
      await ticket.waitFor({ state: "hidden" });
      await page.waitForFunction(() => document.activeElement?.classList.contains("mobile-ticket-trigger"));
    }
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(writes, []);
    return { width, height, theme, failure: failure ?? null, chartTop: Math.round(chartBox.y), writes: 0 };
  } catch (error) {
    if (page) await shot("-unexpected").catch(() => {});
    throw new Error(label + ": " + error.message, { cause: error });
  } finally { await context.close(); }
}

try {
  const cases = [];
  for (const config of [
    { width: 360, height: 800, theme: "dark" },
    { width: 390, height: 844, theme: "dark", failure: "account" },
    { width: 768, height: 1024, theme: "dark" },
    { width: 1440, height: 900, theme: "dark" },
    { width: 390, height: 844, theme: "light", failure: "quote" },
    { width: 1440, height: 900, theme: "light" },
  ]) cases.push(await verify(config));
  console.log(JSON.stringify({ mode: "isolated-loopback", cases }, null, 2));
} finally { await browser.close(); }
