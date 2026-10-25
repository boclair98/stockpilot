export type ActivityCurrency = "KRW" | "USD";
export type ActivitySummary = {
  currency: ActivityCurrency; count: number; buyCount: number; sellCount: number;
  buyAmount: number | null; sellAmount: number | null; fees: number | null; taxes: number | null; realizedPnl: number | null;
};
export type ActivityDay = { date: string; currencies: ActivitySummary[]; unknownCurrencyCount: number; legacyDateCount: number };
export type TradeActivity = {
  month: string; timezone: "Asia/Seoul"; basis: "execution"; asOf: string;
  totals: ActivitySummary[]; days: ActivityDay[]; unknownCurrencyCount: number; legacyDateCount: number;
};
const metricKeys = ["buyAmount", "sellAmount", "fees", "taxes", "realizedPnl"] as const;
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function count(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
export function isCalendarMonth(value: string): boolean {
  return /^(19\d{2}|20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(value);
}
export function currentKstMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).formatToParts(now);
  return `${parts.find(item => item.type === "year")?.value}-${parts.find(item => item.type === "month")?.value}`;
}
export function shiftCalendarMonth(month: string, shift: number): string {
  if (!isCalendarMonth(month) || !Number.isInteger(shift)) return month;
  const [year, number] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, number - 1 + shift, 1));
  const next = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  return isCalendarMonth(next) ? next : month;
}
export function calendarCells(month: string): Array<string | null> {
  if (!isCalendarMonth(month)) return [];
  const [year, number] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, number - 1, 1)).getUTCDay();
  const length = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return [...Array.from({ length: start }, () => null), ...Array.from({ length }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`)];
}
function summary(value: unknown): value is ActivitySummary {
  if (!record(value) || !["KRW", "USD"].includes(String(value.currency)) || !count(value.count) || !count(value.buyCount) || !count(value.sellCount) || value.count !== value.buyCount + value.sellCount) return false;
  return metricKeys.every(key => value[key] === null || typeof value[key] === "number" && Number.isFinite(value[key]) && (key === "realizedPnl" || value[key] >= 0));
}
function summaries(value: unknown): value is ActivitySummary[] {
  return Array.isArray(value) && value.length <= 2 && value.every(summary) && new Set(value.map(item => item.currency)).size === value.length;
}
export function isTradeActivity(value: unknown, expectedMonth: string): value is TradeActivity {
  if (!record(value) || value.month !== expectedMonth || !isCalendarMonth(expectedMonth) || value.timezone !== "Asia/Seoul" || value.basis !== "execution" || typeof value.asOf !== "string" || !/(Z|[+-]\d{2}:\d{2})$/.test(value.asOf) || !Number.isFinite(Date.parse(value.asOf)) || !count(value.unknownCurrencyCount) || !count(value.legacyDateCount) || !summaries(value.totals) || value.totals.length !== 2 || !Array.isArray(value.days) || value.days.length > 31) return false;
  const validDays = new Set(calendarCells(expectedMonth));
  let previous = "", legacy = 0, unknown = 0;
  for (const day of value.days) {
    if (!record(day) || typeof day.date !== "string" || !validDays.has(day.date) || day.date <= previous || !summaries(day.currencies) || !count(day.unknownCurrencyCount) || !count(day.legacyDateCount)) return false;
    const executions = day.currencies.reduce((sum, item) => sum + item.count, 0) + day.unknownCurrencyCount;
    if (!executions || day.legacyDateCount > executions) return false;
    previous = day.date; legacy += day.legacyDateCount; unknown += day.unknownCurrencyCount;
  }
  if (legacy !== value.legacyDateCount || unknown !== value.unknownCurrencyCount) return false;
  // A contradictory response must not present plausible but incorrect monthly totals.
  for (const total of value.totals) {
    const items = (value.days as ActivityDay[]).flatMap(day => day.currencies.filter(item => item.currency === total.currency));
    if (["count", "buyCount", "sellCount"].some(key => total[key as "count"] !== items.reduce((sum, item) => sum + item[key as "count"], 0))) return false;
    for (const key of metricKeys) {
      if (items.some(item => item[key] === null)) { if (total[key] !== null) return false; }
      else {
        const sum = items.reduce((result, item) => result + (item[key] ?? 0), 0);
        if (total[key] === null || Math.abs(total[key] - sum) > Math.max(0.0001, Math.abs(sum) * 1e-10)) return false;
      }
    }
  }
  return true;
}
export function activityMoney(value: number | null, currency: ActivityCurrency, signed = false): string {
  if (value === null) return "확인 필요";
  const amount = Math.abs(value).toLocaleString("ko-KR", { maximumFractionDigits: 4 });
  return `${value < 0 ? "−" : signed && value > 0 ? "+" : ""}${currency === "USD" ? "US$" : "₩"}${amount}`;
}
