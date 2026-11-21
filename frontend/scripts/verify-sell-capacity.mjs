// Opt-in local preview QA. Start preview-functional.mjs with UPGRADE_FIXTURE=1.
// STOCKPILOT_VERIFY_URL=http://127.0.0.1:<port> node scripts/verify-sell-capacity.mjs
// Optional: --screenshots=<directory>. There is deliberately no production mode.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const origin = process.env.STOCKPILOT_VERIFY_URL || "";
assert(/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(origin) && new URL(origin).origin === origin, "Use a literal loopback fixture origin");
const args = process.argv.slice(2);
assert(args.length <= 1 && args.every((arg) => /^--screenshots=.+/.test(arg)), "Invalid sell-capacity test argument");
const output = args[0] ? resolve(args[0].slice("--screenshots=".length)) : null;
if (output) await mkdir(output, { recursive: true });

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.STOCKPILOT_PLAYWRIGHT || "playwright");
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.STOCKPILOT_BROWSER_EXECUTABLE || undefined,
  args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"],
});
const portfolioRoute = "/api/trading/portfolio";
const detailRoute = "/?view=detail&market=KR&exchange=KRX&symbol=005930";
const currentCapacity = { pendingOrderQuantity: 7, protectionQuantity: 1, availableQuantity: 2 };
const cancelFixtureOrderId = "00000000-0000-0000-0000-000000000073";
const cancelFixturePath = `/api/trading/orders/${cancelFixtureOrderId}`;
const viewports = [ { width: 360, height: 800 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 } ];
const quantityFillButton = /가능 수량 채우기|전량|^100%$|^MAX$/i;
const recoveryVariants = ["legacy", "malformed", "wrong-market"];

function portfolioFor(base, variant, includeCancelableOrder) {
  assert(base.authenticated === true && Array.isArray(base.positions), "Use the authenticated portfolio fixture");
  const original = base.positions.find((position) => position.symbol === "005930" && position.exchange === "KRX");
  assert(original, "Start the fixture with UPGRADE_FIXTURE=1 (Samsung holding missing)");
  const quantity = 10;
  const position = {
    ...original,
    quantity,
    costBasis: original.averagePrice * quantity,
    marketValue: original.currentPrice * quantity,
    profit: (original.currentPrice - original.averagePrice) * quantity,
  };
  delete position.sellCapacity;
  if (variant === "confirmed" || variant === "wrong-market") position.sellCapacity = currentCapacity;
  if (variant === "malformed") position.sellCapacity = { ...currentCapacity, availableQuantity: 9 };
  if (variant === "after-cancel") position.sellCapacity = { pendingOrderQuantity: 4, protectionQuantity: 1, availableQuantity: 5 };
  // The same symbol and venue with a wrong market is not positive evidence of
  // either a validated holding or zero holdings, even with complete coverage.
  if (variant === "wrong-market") position.market = "US";
  const response = {
    ...base,
    positions: [position],
    estimatedPositions: position.valuationBasis === "COST" ? 1 : 0,
    positionCoverageComplete: true,
    // A readable recent-history window need not contain either reservation.
    // Reconstructing the maximum from this window would wrongly yield 10, not 2.
    orders: includeCancelableOrder && variant !== "after-cancel" ? [{
      id: cancelFixtureOrderId, symbol: position.symbol, exchange: position.exchange,
      quantity: 3, orderType: "LIMIT", side: "SELL", status: "OPEN", fillPrice: null,
      createdAt: "2026-11-20T03:00:00Z",
    }] : [],
    protections: [],
  };
  if (variant === "legacy") delete response.positionCoverageComplete;
  return response;
}

function signal() {
  let open;
  const ready = new Promise((resolveReady) => { open = resolveReady; });
  return { ready, open };
}

async function waitForSignal(promise, label) {
  let timer;
  try {
    await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), 5000); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function assertNoOverflow(page, step) {
  const widths = await page.evaluate(() => {
    const sheet = document.querySelector("#order-ticket");
    return {
      viewport: document.documentElement.clientWidth,
      page: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      sheet: sheet?.clientWidth || 0,
      sheetContents: sheet?.scrollWidth || 0,
    };
  });
  assert(widths.page <= widths.viewport + 1, `${step}: body horizontally overflows (${widths.page} > ${widths.viewport})`);
  assert(widths.sheet > 0 && widths.sheetContents <= widths.sheet + 1, `${step}: order pane horizontally overflows (${widths.sheetContents} > ${widths.sheet})`);
}

async function assertAvailabilityContrast(status, theme) {
  const ratios = await status.evaluate((container) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d");
    function rgb(color) {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data, (component) => component / 255);
    }
    const mix = (base, layer) => base.map((channel, index) => channel * (1 - layer[3]) + layer[index] * layer[3]);
    const luminance = (color) => color.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
      .reduce((total, component, index) => total + component * [0.2126, 0.7152, 0.0722][index], 0);
    return [...container.querySelectorAll("b, small")].map((element) => {
      const layers = [];
      for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
        layers.unshift(rgb(getComputedStyle(ancestor).backgroundColor));
      }
      const background = layers.reduce(mix, [1, 1, 1]);
      const bg = luminance(background);
      const fg = luminance(mix(background, rgb(getComputedStyle(element).color)));
      return (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05);
    });
  });
  assert(ratios.length >= 2 && ratios.every((ratio) => ratio >= 4.5), `${theme}: reported availability text contrast ${ratios.map((ratio) => ratio.toFixed(2)).join(", ")} against its flat background`);
  return Math.min(...ratios);
}

async function screenshot(page, label) {
  if (!output) return;
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(output, `${label}.png`), animations: "disabled" });
}

async function verify(viewport, originalVariant = "confirmed", theme = "dark") {
  const context = await browser.newContext({ viewport, colorScheme: theme, locale: "ko-KR", reducedMotion: "reduce", serviceWorkers: "block" });
  const testReordering = originalVariant === "out-of-order";
  const testRecovery = recoveryVariants.includes(originalVariant);
  let variant = testReordering ? "confirmed" : originalVariant;
  let holdNextPortfolio = false;
  let mockCancels = 0;
  const olderReadCaptured = signal();
  const releaseOlderRead = signal();
  const observed = [];
  const unexpectedWrites = [];
  const errors = [];
  let page;
  try {
    await context.addInitScript((mode) => {
      localStorage.setItem("stockpilot:display:v1", JSON.stringify({ dark: mode === "dark", compact: false, privateMode: false }));
    }, theme);
    // Leave WebSocket routes as browser-local mocks; do not connect to a server.
    await context.routeWebSocket("**/*", () => {});
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (testReordering && url.origin === origin && url.pathname === cancelFixturePath && request.method() === "DELETE") {
        // The only mutation in this scenario is fulfilled in the route handler;
        // the preview server does not receive it and there is no real account.
        mockCancels += 1;
        variant = "after-cancel";
        return route.fulfill({ status: 200, json: { id: cancelFixtureOrderId, status: "CANCELED" } });
      }
      if (!["GET", "HEAD"].includes(request.method())) {
        unexpectedWrites.push(`${request.method()} ${url.pathname}`);
        return route.abort();
      }
      if (url.origin !== origin || /^\/api\/auth(?:\/|$)/.test(url.pathname)) return route.abort();
      if (url.pathname !== portfolioRoute || request.method() !== "GET") return route.continue();
      const servedVariant = variant;
      const delayed = holdNextPortfolio && servedVariant === "confirmed";
      if (delayed) holdNextPortfolio = false;
      try {
        const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 5000 });
        assert(response.ok(), `Preview portfolio returned ${response.status()}`);
        const body = portfolioFor(await response.json(), servedVariant, testReordering);
        if (delayed) {
          olderReadCaptured.open();
          await releaseOlderRead.ready;
        }
        observed.push(servedVariant);
        return await route.fulfill({
          status: 200, json: body,
          headers: delayed ? { "x-stockpilot-qa-response": "pre-cancel" } : undefined,
        });
      } catch (error) {
        errors.push(`Fixture portfolio: ${error.message}`);
        return route.abort();
      }
    });
    page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) errors.push(message.text());
    });
    const navigation = await page.goto(`${origin}${detailRoute}`, { waitUntil: "domcontentloaded" });
    assert(navigation?.ok(), "Samsung detail navigation failed");
    await page.waitForFunction((mode) => document.documentElement.dataset.theme === mode, theme);
    await page.locator(".view-detail .instrument-identity").getByRole("heading", { name: "삼성전자", exact: true }).waitFor();
    const mobile = viewport.width <= 1023;
    const mobileOpener = page.locator(".mobile-ticket-trigger");
    if (mobile) await mobileOpener.press("Enter");
    const ticket = page.locator("#order-ticket");
    await ticket.waitFor();
    if (mobile) {
      assert.equal(await ticket.getAttribute("role"), "dialog", "Mobile order sheet should open as a dialog");
    }
    await ticket.getByRole("button", { name: "매도", exact: true }).press("Enter");
    const status = ticket.locator(":scope > form .sell-availability");
    await status.waitFor();
    const quantity = ticket.getByRole("spinbutton", { name: "주문 수량", exact: true });

    if (testRecovery) {
      await status.getByText("매도 가능 수량을 확인하지 못했어요.", { exact: true }).waitFor();
      assert(observed.includes(originalVariant), "Unexpected fallback was not exercised");
      assert.equal(await status.getByText(/^매도 가능\s+\d+주$/).count(), 0, "Unverified capacity cannot quote an exact amount");
      for (const shortcut of await ticket.getByRole("button", { name: quantityFillButton }).all()) {
        assert(!(await shortcut.isVisible()) || await shortcut.isDisabled(), "Unverified capacity cannot fill the exact maximum");
      }
      assert.notEqual(await quantity.getAttribute("max"), "10", "Do not use the held quantity as the unverified maximum");
      // The user may still type a draft. A successful refresh may validate it, not rewrite it.
      await quantity.fill("4");
      assert.equal(await quantity.inputValue(), "4");
      await assertNoOverflow(page, `${viewport.width}px ${originalVariant}`);
      await assertAvailabilityContrast(status, theme);
      await status.scrollIntoViewIfNeeded();
      await screenshot(page, `sell-capacity-${theme}-${originalVariant}-${viewport.width}`);
      variant = "confirmed";
      await status.getByRole("button", { name: "다시 조회", exact: true }).press("Enter");
    }

    await status.getByText("매도 가능 2주", { exact: true }).waitFor();
    const reservationSummary = (await status.innerText()).replace(/\s+/g, " ");
    assert.match(reservationSummary, /보유 10주/);
    assert.match(reservationSummary, /대기 매도 7주/);
    assert.match(reservationSummary, /보호 설정 1주/);
    assert(!reservationSummary.includes("매도 가능 10주"), "Do not infer capacity from the recent history window");
    assert(observed.includes("confirmed"), "Confirmed capacity was never returned");
    assert.equal(await quantity.getAttribute("max"), "2");
    if (testRecovery) {
      assert.equal(await quantity.inputValue(), "4", "Refreshing reservations must preserve the draft");
    } else {
      await quantity.fill("3");
    }
    assert(await quantity.evaluate((input) => input.validity.rangeOverflow), "Quantity above verified capacity must be invalid");
    assert(await ticket.getByRole("button", { name: "모의 매도 주문 확인", exact: true }).isDisabled(), "Prevent confirming quantities over verified capacity");
    const fill = status.getByRole("button", { name: "가능 수량 채우기", exact: true });
    assert(await fill.isEnabled(), "Confirmed capacity must enable the fill control");
    await fill.press("Enter");
    assert.equal(await quantity.inputValue(), "2", "Keyboard fill should use exactly the server's available quantity");
    await assertNoOverflow(page, `${viewport.width}px confirmed`);
    const contrast = await assertAvailabilityContrast(status, theme);
    await status.scrollIntoViewIfNeeded();
    if (testReordering) {
      await quantity.fill("1");
      holdNextPortfolio = true;
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await waitForSignal(olderReadCaptured.ready, "Could not capture the pre-cancellation read");
      await ticket.locator(".orders").getByRole("button", { name: /^주문\s*취소$/ }).click();
      await status.getByText("매도 가능 5주", { exact: true }).waitFor();
      assert.equal(mockCancels, 1, "The browser should simulate exactly one cancellation");
      assert(observed.includes("after-cancel"), "A cancellation must start its own fresh read, without joining the held read");
      const late = page.waitForResponse((response) => response.headers()["x-stockpilot-qa-response"] === "pre-cancel");
      releaseOlderRead.open();
      const staleResponse = await late;
      assert(staleResponse.ok(), "The held response must reach the browser");
      const oldSnapshot = await staleResponse.json();
      assert.equal(oldSnapshot.positions[0].sellCapacity.availableQuantity, 2);
      await page.evaluate(() => new Promise((resolveFrames) => requestAnimationFrame(() => requestAnimationFrame(resolveFrames))));
      assert(await status.getByText("매도 가능 5주", { exact: true }).isVisible(), "A late old response must not restore outdated reservations");
      assert.equal(await quantity.getAttribute("max"), "5");
      assert.equal(await quantity.inputValue(), "1", "A new reservation snapshot must not rewrite the draft");
      await status.scrollIntoViewIfNeeded();
    }
    const screenshotCase = testRecovery ? `recovered-${originalVariant}` : originalVariant;
    await screenshot(page, `sell-capacity-${theme}-${screenshotCase}-${viewport.width}`);
    assert.deepEqual(unexpectedWrites, [], "This verification should make no network writes");
    assert.deepEqual(errors, [], "Unexpected browser errors");
    return { width: viewport.width, height: viewport.height, theme, case: originalVariant, recovered: testRecovery, filled: 2, contrast: Number(contrast.toFixed(2)), mockCancels, writes: 0 };
  } catch (error) {
    if (page) await screenshot(page, `sell-capacity-failure-${theme}-${originalVariant}-${viewport.width}`).catch(() => {});
    throw error;
  } finally {
    releaseOlderRead.open();
    await context.close();
  }
}

try {
  const cases = [];
  for (const viewport of viewports) cases.push(await verify(viewport));
  for (const viewport of [viewports[1], viewports[3]]) cases.push(await verify(viewport, "confirmed", "light"));
  for (const variant of recoveryVariants) cases.push(await verify(viewports[1], variant));
  cases.push(await verify(viewports[3], "out-of-order"));
  console.log(JSON.stringify({ mode: "isolated-loopback", cases }, null, 2));
} finally {
  await browser.close();
}
