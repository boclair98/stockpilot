/* eslint-disable @typescript-eslint/no-require-imports */
// Execute actual InvestorTools/report guards with isolated network, hooks and timers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const harnessSource = fs.readFileSync(path.join(__dirname, 'verify-workspace-audit.cjs'), 'utf8');
const boundary = harnessSource.indexOf('\nfunction workerStatus()');
assert(boundary > 0);
const { harness, KR } = new Function('require', '__dirname', harnessSource.slice(0, boundary) + '\nreturn {harness,KR};')(require, __dirname);
const props = { selected: KR, authenticated: true, onSelect() {}, onNotice() {}, onAlertSummary() {}, focusAlertsKey: 0 };
const report = () => ({
  equity: { KRW: 1000, USD: 120 }, returnRate: { KRW: 11.11, USD: 22.22, combined: 33.33 },
  tradeCount: 17, winRate: 75, realizedPnl: { KRW: 500, USD: -4.5 }, totalCosts: { KRW: 25, USD: 0.35 },
  allocations: [{ symbol: 'AAPL', name: '격리 검증 종목', market: 'US', currency: 'USD', value: 20 }],
  history: [{ date: '2026-11-06', returnRate: 33.33 }],
});
const dashboard = value => ({ authenticated: true, watchlist: [], alerts: [], unreadAlerts: 0, push: { configured: false, deviceCount: 0 }, missions: [], report: value });
async function ready(t, value) {
  const h = harness('components/InvestorTools.tsx', props); t.after(h.unmount);
  h.render(); h.tick(); await h.flush(); h.respond(0, dashboard(value)); await h.flush();
  h.click('투자 리포트'); await h.flush(); return h;
}
const hasChart = h => h.nodes().some(node => typeof node.type === 'function' && node.type.name === 'Sparkline');
const compactText = h => h.text().replace(/\s+/g, '');

test('complete quotes and legacy reports retain real supplied returns and chart without inference', async t => {
  for (const metadata of [{}, { valuationComplete: true, estimatedPositions: 0, unavailablePositions: 0 }]) {
    const value = { ...report(), ...metadata };
    const before = JSON.stringify(value);
    const h = await ready(t, value);
    assert(compactText(h).includes('+33.33%')); assert(compactText(h).includes('11.11%')); assert(compactText(h).includes('22.22%'));
    assert(hasChart(h)); assert(!h.text().includes('시세 확인 필요'));
    assert.equal(JSON.stringify(value), before);
    const lib = h.load('lib/investor-report.ts');
    assert(lib.validInvestorReport(value)); assert.equal(lib.incompleteReportValuation(value), false);
  }
});

test('cost fallback hides unsupported returns/chart but retains filled metrics and labeled reference allocation', async t => {
  const value = { ...report(), valuationComplete: false, estimatedPositions: 1, unavailablePositions: 0 };
  value.allocations[0].valuationBasis = 'COST';
  const before = JSON.stringify(value), h = await ready(t, value);
  assert(h.text().includes('시세 확인 필요')); assert(compactText(h).includes('시세미확인1종목'));
  for (const hidden of ['33.33%', '11.11%', '22.22%']) assert(!compactText(h).includes(hidden));
  assert(!hasChart(h)); assert(h.text().includes('체결 주문')); assert(compactText(h).includes('17건')); assert(compactText(h).includes('75%'));
  assert(h.text().includes('실현손익')); assert(h.text().includes('모의 비용')); assert(h.text().includes('매입금액 기준 참고액'));
  assert.equal(JSON.stringify(value), before, 'presentation must never rewrite financial values');
});

test('missing catalog reports an excluded position instead of claiming an empty portfolio', async t => {
  const value = { ...report(), allocations: [], valuationComplete: false, estimatedPositions: 0, unavailablePositions: 2 };
  const h = await ready(t, value);
  assert(h.text().includes('평가액에서 제외')); assert(h.text().includes('보유 평가액을 표시하지 못했어요'));
  assert(!h.text().includes('보유 종목이 생기면')); assert(!hasChart(h));
});

test('optional explicit incomplete metadata is conservative and never inferred from zero return', async t => {
  const h = await ready(t, report()), lib = h.load('lib/investor-report.ts');
  for (const patch of [{ valuationComplete: false }, { estimatedPositions: 1 }, { unavailablePositions: 1 }]) {
    assert(lib.validInvestorReport({ ...report(), ...patch })); assert(lib.incompleteReportValuation({ ...report(), ...patch }));
  }
  const cost = report(); cost.allocations[0].valuationBasis = 'COST'; assert(lib.incompleteReportValuation(cost));
  const zero = report(); zero.returnRate = { KRW: 0, USD: 0, combined: 0 }; assert(!lib.incompleteReportValuation(zero));
});

test('malformed report/metadata becomes a recoverable read error, preserving the last valid report', async t => {
  const h = await ready(t, report()), lib = h.load('lib/investor-report.ts');
  assert(lib.validInvestorReport(null));
  for (const invalid of [undefined, {}, { ...report(), returnRate: null }, { ...report(), allocations: [null] },
    { ...report(), history: [{ date: 'broken', returnRate: 1 }] }, { ...report(), winRate: NaN },
    { ...report(), valuationComplete: 'false' }, { ...report(), estimatedPositions: -1 }, { ...report(), unavailablePositions: 1.5 },
    { ...report(), allocations: [{ ...report().allocations[0], valuationBasis: 'UNKNOWN' }] }]) assert.equal(lib.validInvestorReport(invalid), false);
  h.tick(15000); await h.flush(); h.respond(1, dashboard({ ...report(), returnRate: null })); await h.flush();
  assert(h.text().includes('응답을 확인하지 못했어요')); assert(h.text().includes('이전에 불러온 기록'));
  assert(compactText(h).includes('+33.33%'));
  h.click('다시 조회'); await h.flush(); h.respond(2, dashboard({ ...report(), valuationComplete: false, estimatedPositions: 1 })); await h.flush();
  assert(!h.text().includes('응답을 확인하지 못했어요')); assert(h.text().includes('시세 확인 필요'));
  assert(h.requests.every(row => !row.init.method && !row.init.body));
});
