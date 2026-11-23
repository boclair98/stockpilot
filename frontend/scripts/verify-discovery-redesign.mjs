// Read-only browser verification against the isolated preview-functional.mjs server.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const origin = process.env.STOCKPILOT_VERIFY_URL ?? "";
assert(/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(origin) && new URL(origin).origin === origin, "Use a literal loopback fixture");
const screenshots = process.argv.find(arg => arg.startsWith("--screenshots="))?.slice(14);
if (screenshots) await mkdir(screenshots, { recursive: true });
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.STOCKPILOT_PLAYWRIGHT || "playwright");
const browser = await chromium.launch({
  executablePath: process.env.STOCKPILOT_BROWSER_EXECUTABLE,
  args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"],
});

async function verify(width, height, theme) {
  const context = await browser.newContext({
    viewport: { width, height }, colorScheme: theme, locale: "ko-KR",
    reducedMotion: "reduce", serviceWorkers: "block",
  });
  const writes = [], errors = [];
  let fail = false;
  try {
    await context.addInitScript(dark => {
      localStorage.setItem("stockpilot:display:v1", JSON.stringify({ dark, compact: false, privateMode: false }));
      localStorage.setItem("stockpilot_onboarding_v2", "done");
    }, theme === "dark");
    await context.routeWebSocket("**/*", socket => socket.close());
    await context.route("**/*", route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== origin || /^\/api\/auth(?:\/|$)/.test(url.pathname)) return route.abort();
      if (!["GET", "HEAD"].includes(req.method())) { writes.push(req.method()); return route.abort(); }
      if (fail && url.pathname === "/api/personal/saved" && url.searchParams.get("kind") === "FAVORITE") {
        return route.fulfill({ status: 503, json: { detail: "격리 관심종목 오류" } });
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.on("pageerror", error => errors.push(error.message));
    const screenshot = async view => {
      if (screenshots) {
        await page.screenshot({ path: join(screenshots, `${view}-${width}-${theme}.png`) });
      }
    };
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
    await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
    const ranks = page.locator(".view-market .ranked-list");
    const first = ranks.getByRole("button", { name: "삼성전자 상세 보기", exact: true });
    await first.waitFor();
    await page.evaluate(() => document.fonts.ready);
    await screenshot("market");
    assert(await fits());
    const firstTop = Math.round((await first.boundingBox()).y);
    assert(firstTop < (width < 480 ? 520 : 565), `Stock list starts too low at ${width}px: ${firstTop}`);
    assert(await page.locator(".ranking-comparison").isHidden());
    const nav = page.getByRole("navigation", { name: "주요 메뉴", exact: true });
    const desktopNav = width === 1440 ? await nav.boundingBox() : null;
    const compare = ranks.getByRole("button", { name: "삼성전자 비교 추가", exact: true });
    await compare.press("Enter");
    const activeComparison = page.locator(".ranking-comparison");
    await activeComparison.getByText("삼성전자", { exact: true }).waitFor();
    await activeComparison.getByRole("button", { name: "선택 초기화" }).press("Enter");
    await activeComparison.waitFor({ state: "hidden" });

    await page.goto(`${origin}/#favorite-board-title`, { waitUntil: "domcontentloaded" });
    const watch = page.locator(".view-watch .watchlist-board");
    const row = watch.getByRole("button", { name: "삼성전자 상세 보기", exact: true });
    await row.waitFor();
    await page.waitForFunction(() => scrollY === 0);
    assert(await fits());
    const watchTop = Math.round((await row.boundingBox()).y);
    assert(watchTop < (width < 768 ? 320 : 370), `Saved rows start too low at ${width}px: ${watchTop}`);
    assert(await watch.getByRole("searchbox", { name: "관심종목 찾기" }).isHidden(), "Keep the saved list visible before opening filters");
    await screenshot("watchlist");
    const disclosure = watch.locator(".watchlist-filter-disclosure > summary");
    await disclosure.press("Enter");
    const query = watch.getByRole("searchbox", { name: "관심종목 찾기" });
    await query.fill("없는종목");
    await watch.getByText(/조건에 맞는 관심종목이 없어요/).waitFor();
    await disclosure.press("Enter");
    await watch.getByText("적용 중", { exact: true }).waitFor();
    await watch.getByRole("button", { name: "조건 초기화", exact: true }).press("Enter");
    await row.waitFor();

    fail = true;
    await page.locator(".view-watch .personal-inline-actions").getByRole("button", { name: "다시 조회", exact: true }).press("Enter");
    await watch.getByRole("alert").waitFor();
    assert(await row.isVisible(), "Last known saved rows should survive a refresh failure");
    fail = false;
    await watch.getByRole("button", { name: "다시 조회", exact: true }).press("Enter");
    await watch.getByRole("alert").waitFor({ state: "hidden" });
    await row.press("Enter");
    const detail = page.locator(".view-detail");
    await detail.getByRole("heading", { name: "삼성전자", level: 1, exact: true }).waitFor();
    const fromWatch = detail.getByRole("button", { name: /관심종목으로 돌아가기/ });
    await fromWatch.press("Enter");
    await row.waitFor();
    assert.equal(new URL(page.url()).hash, "#favorite-board-title");
    if (desktopNav) {
      for (const [label, view] of [["내 자산", ".view-assets"], ["매매 기록", ".view-records"]]) {
        await nav.getByRole("link", { name: label, exact: true }).press("Enter");
        await page.locator(view).waitFor();
        await page.waitForFunction(() => scrollY === 0);
        const box = await nav.boundingBox();
        assert(box && Math.abs(box.x - desktopNav.x) < 2 && Math.abs(box.y - desktopNav.y) < 2, "Keep the primary menu in one location across workspace views");
        assert(await fits());
      }
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, []);
    return { width, height, theme, firstTop, watchTop };
  } finally {
    await context.close();
  }
}

try {
  const results = [];
  for (const [width, height] of [[320, 800], [360, 800], [390, 844], [430, 932], [768, 1024], [1024, 900], [1440, 900], [1920, 1080]]) {
    for (const theme of ["light", "dark"]) results.push(await verify(width, height, theme));
  }
  console.log(JSON.stringify({ results, writes: 0 }, null, 2));
} finally {
  await browser.close();
}
