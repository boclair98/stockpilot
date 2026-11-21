// Opt-in journey test. No connection to a browser profile and no network writes.
// Preview: STOCKPILOT_VERIFY_URL=http://127.0.0.1:<port> node scripts/verify-first-practice.mjs
// Production: node scripts/verify-first-practice.mjs --production (read-only)
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const production = args.includes("--production");
const screenshots = args.find((arg) => arg.startsWith("--screenshots="))?.slice("--screenshots=".length);
assert(args.every((arg) => arg === "--production" || /^--screenshots=.+/.test(arg)), "Invalid journey-test argument");
const output = screenshots ? resolve(screenshots) : null;
if (output) await mkdir(output, { recursive: true });

const origin = production
  ? "https://stockpilot.coders.kr"
  : process.env.STOCKPILOT_VERIFY_URL || "http://127.0.0.1:5190";
assert(production || /^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(origin), "Use a literal loopback fixture origin");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.STOCKPILOT_PLAYWRIGHT || "playwright");
const executablePath = process.env.STOCKPILOT_BROWSER_EXECUTABLE || undefined;
const browser = await chromium.launch({ headless: true, executablePath });
const practiceLinkName = "로그인 없이 과거 시세로 연습";
const historyPath = "/api/features/history";
const calendarDayPattern = /\b(\d{4})[.\-년]\s*(\d{1,2})[.\-월]\s*(\d{1,2})\b/;

function dayFrom(text) {
  const match = calendarDayPattern.exec(text);
  assert(match, "Expected a visible historical trading date");
  const iso = [match[1], match[2].padStart(2, "0"), match[3].padStart(2, "0")].join("-");
  assert.equal(new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10), iso, "Invalid replay date");
  return iso;
}

function sourceDate(day) {
  const text = String(day);
  return /^\d{8}$/.test(text) ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6)}` : text;
}

async function readReplay(page) {
  const head = page.locator(".practice-app .replay-head");
  await head.waitFor();
  const clock = head.locator("time[datetime]");
  const date = dayFrom(await clock.innerText());
  assert.equal(await clock.getAttribute("datetime"), date, "The displayed and semantic dates must agree");
  const label = await head.locator("strong").innerText();
  assert.match(label, /₩|KRW|원/, "The sample's initial price should identify KRW");
  const amount = Number(label.replace(/[^\d.\-]/g, ""));
  assert(Number.isFinite(amount) && amount > 0, "Expected a positive historical close");
  return { date, amount };
}

async function assertFits(page, step) {
  const dimensions = await page.evaluate(() => ({
    available: document.documentElement.clientWidth,
    content: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
  }));
  assert(dimensions.content <= dimensions.available + 1, `${step}: horizontal overflow (${dimensions.content} > ${dimensions.available})`);
}

async function snapshot(page, name) {
  if (!output) return;
  await page.evaluate(() => document.fonts.ready);
  const mode = production ? "live-readonly" : "fixture";
  await page.screenshot({ path: join(output, `${mode}-${name}.png`), fullPage: true, animations: "disabled" });
}

async function run(width, failedFirstRead = false) {
  const height = { 360: 800, 390: 844, 768: 1024, 1440: 900 }[width];
  const context = await browser.newContext({
    viewport: { width, height },
    locale: "ko-KR",
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });
  const requests = { forbidden: [], history: [] };
  const errors = [];
  const historyResponses = [];
  try {
    // A mistake in the UI cannot transmit an order or authentication request.
    await context.routeWebSocket("**/*", (socket) => socket.close({ code: 1000, reason: "Read-only journey check" }));
    await context.route("**/*", (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method();
      if (!["GET", "HEAD"].includes(method) || /^\/api\/auth(?:\/|$)/.test(url.pathname) || url.hostname === "accounts.google.com") {
        requests.forbidden.push(`${method} ${url.pathname}`);
        return route.abort();
      }
      if (url.origin !== origin) return route.abort();
      // Do not let the preview's default synthetic account make a guest test pass.
      if (!production && url.pathname === "/api/me") {
        return route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
      }
      if (url.pathname === historyPath) {
        requests.history.push(url.searchParams.get("symbol"));
        if (failedFirstRead && requests.history.length === 1) {
          return route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ detail: "격리 시험: 과거 시세를 불러오지 못했어요." }),
          });
        }
      }
      return route.continue();
    });

    const page = await context.newPage();
    page.setDefaultTimeout(production ? 20_000 : 8_000);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      // The deliberate 503 and blocked third-party resources are network outcomes.
      if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) errors.push(message.text());
    });
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.origin === origin && url.pathname === historyPath && response.status() === 200) historyResponses.push(response);
    });
    const navigation = await page.goto(`${origin}/guide`, { waitUntil: "domcontentloaded" });
    assert(navigation?.ok(), "Guide navigation failed");
    const guideLink = page.getByRole("link", { name: practiceLinkName, exact: true }).first();
    const target = new URL(await guideLink.getAttribute("href"), origin);
    assert.equal(target.origin, origin, "Practice must stay on StockPilot");
    assert.equal(target.pathname.replace(/\/$/, ""), "/practice");
    await assertFits(page, `${width}px guide`);
    if (!failedFirstRead) await snapshot(page, `guide-${width}`);
    await guideLink.focus();
    await page.keyboard.press("Enter");
    await page.waitForURL((url) => url.origin === origin && url.pathname.replace(/\/$/, "") === "/practice");
    // A static export can advance the URL before its document navigation
    // settles; inspect the rendered data/error state, not that transition.
    await page.locator(failedFirstRead ? ".practice-recovery-actions" : ".practice-app .replay-head").waitFor();
    await assertFits(page, `${width}px practice entry`);
    const sessionNote = page.locator(".practice-session-note");
    await sessionNote.waitFor({ state: "visible" });
    const note = await sessionNote.innerText();
    assert.match(note, /로그인 없이/);
    assert.match(note, /저장되지 않아요/);
    const marketLink = page.locator(".practice-market-link");
    await marketLink.waitFor({ state: "visible" });
    const marketTarget = new URL(await marketLink.getAttribute("href"), origin);
    assert.equal(marketTarget.href, `${origin}/`, "The exit link must return to the StockPilot market");

    if (failedFirstRead) {
      const failure = page.locator(".practice-app .practice-loading");
      const retry = failure.getByRole("button", { name: /다시\s*(불러|시도|확인)/ });
      await retry.waitFor();
      assert(await failure.getByRole("alert").isVisible(), "A failed history read must be announced");
      assert(await marketLink.isVisible(), "Exit to market must remain visible during an error");
      assert.equal(await page.locator(".replay-head").count(), 0, "Failed data must not render date or close");
      assert.equal(await page.locator(".replay-actions").count(), 0, "Failed data must not offer practice orders");
      assert.deepEqual(requests.history, ["005930"], "Wait for explicit retry after a failed read");
      await snapshot(page, `practice-failure-${width}`);
      await retry.focus();
      await page.keyboard.press("Enter");
    }

    const initial = await readReplay(page);
    assert(await marketLink.isVisible(), "Exit to market must remain visible during practice");
    assert.deepEqual(requests.history, failedFirstRead ? ["005930", "005930"] : ["005930"], "Unexpected or missing historical reads");
    assert.equal(historyResponses.length, 1, "Expected one successful historical response");
    const source = await historyResponses[0].json();
    assert.equal(source.symbol, "005930", "Historical response must match the initial instrument");
    const history = source.items.map(({ date, close }) => ({ date: sourceDate(date), close }))
      .sort((left, right) => left.date.localeCompare(right.date));
    const index = history.findIndex(({ date }) => date === initial.date);
    assert(index >= 0 && index + 1 < history.length, "The first date and its successor must be in the observed history");
    assert.equal(initial.amount, Math.round(history[index].close), "The displayed close must match the date's historical record");
    const holdings = page.locator(".practice-app .replay-balance");
    const balanceBefore = await holdings.innerText();
    assert.match(balanceBefore, /\b0주/, "The guest exercise should open with no holdings");
    const line = page.locator(".practice-app .replay-chart polyline");
    const visiblePricesBefore = (await line.getAttribute("points")).trim().split(/\s+/).length;
    const next = page.getByRole("button", { name: /다음 거래일/ });
    await next.click();
    await page.waitForFunction((date) => {
      const current = document.querySelector(".practice-app .replay-head time")?.getAttribute("datetime");
      return Boolean(current && current !== date);
    }, initial.date);
    const advanced = await readReplay(page);
    assert.equal(advanced.date, history[index + 1].date, "Reveal the immediate next historical date");
    assert.equal(advanced.amount, Math.round(history[index + 1].close), "The next close must match the newly revealed date");
    assert.equal((await line.getAttribute("points")).trim().split(/\s+/).length, visiblePricesBefore + 1, "Reveal only one more historical close");
    assert.equal(await holdings.innerText(), balanceBefore, "Advancing the date without an order must preserve the practice balance");
    await assertFits(page, `${width}px practice replay`);
    await snapshot(page, `practice-${failedFirstRead ? "recovered-" : ""}${width}`);

    if (!production && width === 390 && !failedFirstRead) {
      const quantity = page.getByRole("spinbutton", { name: /수량/ });
      await quantity.fill("1");
      await page.locator(".practice-app .replay-actions").getByRole("button", { name: /매수/ }).click();
      const receipt = page.locator(".practice-app .replay-trades").getByText(/매수/);
      await receipt.waitFor();
      assert.match(await holdings.innerText(), /\b1주/, "A local exercise buy should produce one share");
      assert.equal(await receipt.count(), 1, "Expected only one local buy");
      await snapshot(page, `practice-local-buy-${width}`);
    }
    assert.deepEqual(errors, [], "Unexpected JavaScript errors");
    assert.deepEqual(requests.forbidden, [], "Guest historical replay must not attempt auth or network writes");
    return {
      width,
      height,
      fault: failedFirstRead ? "recovered HTTP 503" : "none",
      dateAdvanced: true,
      localBuy: !production && width === 390 && !failedFirstRead,
      historyReads: requests.history.length,
      jsErrors: errors.length,
      writes: requests.forbidden.length,
    };
  } finally {
    await context.close();
  }
}

try {
  const results = [];
  for (const width of [360, 390, 768, 1440]) results.push(await run(width));
  if (!production) results.push(await run(390, true));
  console.log(JSON.stringify({ mode: production ? "production-read-only" : "isolated", results }, null, 2));
} finally {
  await browser.close();
}
