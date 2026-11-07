type Currency = "KRW" | "USD";
export type InvestorReport = {
  equity: Record<Currency, number>;
  returnRate: { KRW: number; USD: number; combined: number };
  tradeCount: number;
  realizedPnl: Record<Currency, number>;
  winRate: number;
  totalCosts: Record<Currency, number>;
  allocations: Array<{
    symbol: string; name: string; market: "KR" | "US"; currency: Currency; value: number;
    valuationBasis?: "QUOTE" | "COST";
  }>;
  history: Array<{ date: string; returnRate: number }>;
  valuationComplete?: boolean;
  estimatedPositions?: number;
  unavailablePositions?: number;
};

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const count = (value: unknown): value is number => finite(value) && Number.isSafeInteger(value) && value >= 0;
const amounts = (value: unknown) => object(value) && finite(value.KRW) && finite(value.USD);
const text = (value: unknown) => typeof value === "string" && value.length > 0;

/** Old reports omit valuation metadata; never infer missing quotes from zero returns. */
export function validInvestorReport(value: unknown): value is InvestorReport | null {
  return value === null || object(value) && amounts(value.equity) && amounts(value.realizedPnl) && amounts(value.totalCosts)
    && object(value.returnRate) && [value.returnRate.KRW, value.returnRate.USD, value.returnRate.combined].every(finite)
    && count(value.tradeCount) && finite(value.winRate) && value.winRate >= 0 && value.winRate <= 100
    && (value.valuationComplete === undefined || typeof value.valuationComplete === "boolean")
    && (value.estimatedPositions === undefined || count(value.estimatedPositions))
    && (value.unavailablePositions === undefined || count(value.unavailablePositions))
    && Array.isArray(value.allocations) && value.allocations.every(row => object(row) && text(row.symbol) && text(row.name)
      && (row.market === "KR" ? row.currency === "KRW" : row.market === "US" && row.currency === "USD")
      && finite(row.value) && row.value >= 0
      && (row.valuationBasis === undefined || row.valuationBasis === "QUOTE" || row.valuationBasis === "COST"))
    && Array.isArray(value.history) && value.history.every(row => object(row) && typeof row.date === "string" && Number.isFinite(Date.parse(row.date)) && finite(row.returnRate));
}

export function incompleteReportValuation(report: InvestorReport): boolean {
  return report.valuationComplete === false || (report.estimatedPositions ?? 0) > 0 || (report.unavailablePositions ?? 0) > 0
    || report.allocations.some(row => row.valuationBasis === "COST");
}
