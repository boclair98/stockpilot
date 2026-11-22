// Read-only check of the built Nginx web origin. No API calls that touch accounts.
import assert from "node:assert/strict";

const origin = new URL(process.argv[2] || "https://stockpilot.coders.kr");
assert.equal(origin.href, origin.origin + "/");
assert(origin.origin === "https://stockpilot.coders.kr" || /^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(origin.origin));
const headers = {"User-Agent": "StockPilot-Route-Check/1.0"};
const read = (path, method = "GET") => fetch(new URL(path, origin), {method,headers,redirect:"manual",signal:AbortSignal.timeout(12000)});
const pages = [["/guide","모의투자 시작 가이드"], ["/practice","주식 투자 연습"], ["/notifications","알림 모아보기"], ["/operations/workers",null]];
const query = "?check=share%2Flink&lang=ko";
for (const [path, title] of pages) {
  const redirected = await read(path + "/" + query);
  assert.equal(redirected.status, 301, `${path}/ must normalize to its exported page`);
  const expected = path + query;
  const destination = redirected.headers.get("location");
  assert(destination === expected || destination === origin.origin + expected, `Expected local redirect to ${expected}, got ${destination}`);
  const page = await read(expected);
  assert.equal(page.status, 200, `${path} HTTP ${page.status}`);
  const html = await page.text();
  assert(!html.includes("stitch-workspace"), `${path} received market fallback HTML`);
  if (title) assert(html.includes(title), `${path} is missing its own title`);
}
const home = await read("/");
assert.equal(home.status,200);
const html = await home.text();
assert(html.includes("stitch-workspace"));
const script = html.match(/src="(\/_next\/static\/[^"]+\.js)"/)?.[1];
assert(script, "Exported homepage must reference a Next script");
assert.equal((await read(script,"HEAD")).status,200);
console.log("Guide, practice, notifications and nested route aliases preserve query; root and static chunks remain available.");
