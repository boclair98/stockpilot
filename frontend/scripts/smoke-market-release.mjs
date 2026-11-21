import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

// Read-only release smoke. Never sends credentials, invokes a trade, or mutates a visitor account.
const origin = new URL(process.argv[2] || "https://stockpilot.coders.kr");
if (
  origin.username ||
  origin.password ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash ||
  !(origin.origin === "https://stockpilot.coders.kr" || (origin.protocol === "http:" && origin.hostname === "127.0.0.1"))
) {
  throw new Error("Supply the StockPilot production origin or a local fixture origin.");
}

const headers = { "User-Agent": "StockPilot-Market-Smoke/1.0" };

async function read(path, format) {
  const start = performance.now();
  const res = await fetch(new URL(path, origin), {
    headers,
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  }).catch((error) => {
    throw new Error(`${path} failed: ${error.name}`);
  });
  assert.equal(res.status, 200, `${path}: HTTP ${res.status}`);
  const data = await res[format]();
  console.log(`${path}: 200 (${Math.round(performance.now() - start)} ms)`);
  return data;
}

try {
  const html = await read("/", "text");
  assert(html.includes("stitch-workspace"), "Expected the StockPilot web shell.");
  const ready = await read("/api/health/ready", "json");
  assert.equal(ready.status, "ready");

  const bootstrap = await read("/api/trading/bootstrap", "json");
  assert(Array.isArray(bootstrap.quotes), "Bootstrap quotes must remain a list.");
  const createdAt = Date.parse(bootstrap.asOf);
  assert(Number.isFinite(createdAt), "Expected a bootstrap creation time.");
  for (const market of ["KR", "US"]) {
    const summary = bootstrap.quoteSummary?.[market];
    assert(summary && Number.isSafeInteger(summary.count) && summary.count >= 0, `${market}: missing/invalid quote summary`);
    assert(
      summary.latestAt === null ||
        (summary.count > 0 && Number.isFinite(Date.parse(summary.latestAt)) && Date.parse(summary.latestAt) <= createdAt),
      `${market}: invalid quote observation time`,
    );
    console.log(`${market} sample: ${summary.count} quotes; time ${summary.latestAt ? "available" : "unavailable"}`);
  }

  for (const [market, symbol] of [["KR", "005930"], ["US", "AAPL"]]) {
    const result = await read(`/api/market/instruments?market=${market}&q=${symbol}`, "json");
    assert(Array.isArray(result.items), `${market}: catalog returned an invalid list`);
    assert(result.items.some((row) => row.symbol === symbol && row.market === market), `${market}: known stock missing`);
    assert.equal(typeof result.partial, "boolean", `${market}: missing coverage flag`);
    console.log(`${market} catalog: known stock found, coverage ${result.partial ? "partial" : "complete"}`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
