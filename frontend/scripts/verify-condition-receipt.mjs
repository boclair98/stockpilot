// Loopback browser regression. The write and receipt lookup are intercepted locally,
// and no request reaches an account, database, or the live site.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const origin = process.env.STOCKPILOT_VERIFY_URL || "http://127.0.0.1:5190";
assert(/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(origin), "Use a literal loopback fixture origin");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.STOCKPILOT_PLAYWRIGHT || "playwright");
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.STOCKPILOT_BROWSER_EXECUTABLE || undefined,
});

async function verify(lostResponse) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const receipts = [];
  const lookups = [];
  const unexpectedWrites = [];
  const receipt = { id: "00000000-0000-0000-0000-000000000031", currency: "KRW", status: "TRIGGERED", fillPrice: null };
  const respond = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  try {
    await context.routeWebSocket("**/*", socket => socket.close());
    await context.route("**/*", route => {
      const req = route.request();
      const url = new URL(req.url());
      if (url.origin !== origin) return route.abort();
      if (req.method() === "POST" && url.pathname === "/api/trading/orders") {
        receipts.push({ key: req.headers()["idempotency-key"], body: req.postDataJSON() });
        return lostResponse ? respond(route, 503, { detail: "격리 검증: 응답 유실" }) : respond(route, 201, receipt);
      }
      if (req.method() === "GET" && url.pathname.startsWith("/api/trading/orders/request/")) {
        const key = decodeURIComponent(url.pathname.split("/").at(-1));
        lookups.push(key);
        return respond(route, key === receipts[0]?.key ? 200 : 404, receipt);
      }
      if (["GET", "HEAD"].includes(req.method())) return route.continue();
      unexpectedWrites.push(req.method() + " " + url.pathname);
      return route.abort();
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(origin + "/?release_case=normal");
    await page.locator(".broker-rankings").getByRole("button", { name: "삼성전자 상세 보기" }).first().click();
    await page.locator(".view-detail .instrument-quote strong").filter({ hasText: "72,000" }).waitFor();
    await page.locator(".mobile-ticket-trigger").click();
    await page.getByLabel("가상주문 방식").selectOption("STOP_LIMIT");
    await page.getByRole("spinbutton", { name: /감시 가격/ }).fill("71000");
    await page.getByRole("spinbutton", { name: /희망 가격/ }).fill("71000");
    await page.getByRole("button", { name: "모의 매수 주문 확인" }).click();
    const confirm = page.getByRole("dialog", { name: "주문 내용을 확인해 주세요" });
    await confirm.waitFor();
    const boxes = await confirm.getByRole("checkbox").all();
    assert.equal(boxes.length, 4);
    for (const box of boxes) await box.check();
    await confirm.getByRole("button", { name: "가상매수 확정" }).click();
    const result = page.getByRole("region", { name: "최근 주문 처리 결과" });
    if (lostResponse) {
      await result.getByText("주문 결과를 확인해 주세요", { exact: true }).waitFor();
      assert.equal(receipts.length, 1, "the client did not retry submission in the background");
      await result.getByRole("button", { name: "처리 결과 조회" }).click();
    }
    await result.getByText("모의주문 체결 대기", { exact: true }).waitFor();
    assert.match(await result.innerText(), /조건 충족 · 체결 대기/);
    assert.doesNotMatch(await result.innerText(), /체결됐어요|주문이 취소/);
    assert(await result.getByRole("link", { name: "매매 기록" }).isVisible());
    assert.equal(await result.getByRole("link", { name: "내 자산" }).count(), 0);
    assert.equal(await result.getByRole("button", { name: "처리 결과 조회" }).count(), 0);
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].body.orderType, "STOP_LIMIT");
    assert.equal(receipts[0].body.limitPrice, 71000);
    assert.equal(receipts[0].body.triggerPrice, 71000);
    assert(receipts[0].key, "idempotency key is present");
    assert.deepEqual(lookups, lostResponse ? [receipts[0].key] : []);
    assert.deepEqual(unexpectedWrites, []);
    assert.deepEqual(errors, []);
    console.log(lostResponse ? "PASS: lost acknowledgement recovered by GET using the original key" : "PASS: accepted condition-limit order remains unfilled without retry");
  } finally {
    await context.close();
  }
}

try {
  await verify(false);
  await verify(true);
} finally {
  await browser.close();
}
