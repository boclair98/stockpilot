export type AnalyticsPoint = { date: string; returnRate: number; change: number | null };
export type PortfolioAnalyticsData = {
  dataQuality: "STARTING" | "TRACKING";
  periodDays: number;
  openPositionCount: number;
  totalReturn: number | null;
  maxDrawdown: number | null;
  dailyVolatility: number | null;
  annualizedVolatility: number | null;
  sharpeRatio: number | null;
  winRate: number | null;
  profitFactor: number | null;
  fillRate: number | null;
  averageSlippageBps: number | null;
  averageSpreadBps: number | null;
  filledOrderCount: number;
  closedTradeCount: number;
  dailySeries: AnalyticsPoint[];
};
export type AnalyticsResponse = { authenticated: boolean; analytics: PortfolioAnalyticsData | null };

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const count = (value: unknown) => finite(value) && Number.isSafeInteger(value) && value >= 0;
const nullable = (value: unknown) => value === null || finite(value);
const nonnegative = (value: unknown) => value === null || finite(value) && value >= 0;
const percentage = (value: unknown) => value === null || finite(value) && value >= 0 && value <= 100;
function calendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const stamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value;
}

/** Validate, never repair or synthesize, the existing private analytics response. */
export function isAnalyticsResponse(value: unknown): value is AnalyticsResponse {
  if (!record(value) || typeof value.authenticated !== "boolean") return false;
  if (!value.authenticated) return value.analytics === null;
  if (value.analytics === null) return true;
  const data = value.analytics;
  if (!record(data) || (data.dataQuality !== "STARTING" && data.dataQuality !== "TRACKING")) return false;
  if (![data.periodDays, data.openPositionCount, data.filledOrderCount, data.closedTradeCount].every(count)) return false;
  if (![data.totalReturn, data.sharpeRatio, data.averageSlippageBps, data.averageSpreadBps].every(nullable)) return false;
  if (![data.maxDrawdown, data.dailyVolatility, data.annualizedVolatility, data.profitFactor].every(nonnegative)) return false;
  if (![data.winRate, data.fillRate].every(percentage)) return false;
  if (!Array.isArray(data.dailySeries) || data.dailySeries.length > 30 || data.dailySeries.length > (data.periodDays as number)) return false;
  let previous = "";
  for (const point of data.dailySeries) {
    if (!record(point) || !calendarDate(point.date) || point.date <= previous || !finite(point.returnRate) || !nullable(point.change)) return false;
    previous = point.date;
  }
  return true;
}
