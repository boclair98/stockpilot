import { isInstrument } from "./instrument-identity";

export function isValidQuote(value: unknown): boolean {
  if (!isInstrument(value)) return false;
  const quote = value as unknown as Record<string, unknown>;
  return typeof quote.price === "number" && Number.isFinite(quote.price) && quote.price > 0
    && [quote.change, quote.changePercent].every(item => typeof item === "number" && Number.isFinite(item))
    && typeof quote.asOf === "string" && Number.isFinite(Date.parse(quote.asOf));
}

export function isValidPortfolio(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  const cash = item.cash as Record<string, unknown> | null;
  if (typeof item.authenticated !== "boolean" || !cash || ![cash.KRW, cash.USD].every(n => typeof n === "number" && Number.isFinite(n) && n >= 0)) return false;
  if (![item.positions, item.orders, item.protections].every(Array.isArray)) return false;
  if (item.positionCoverageComplete !== undefined && typeof item.positionCoverageComplete !== "boolean") return false;
  if (item.estimatedPositions !== undefined && (typeof item.estimatedPositions !== "number" || !Number.isSafeInteger(item.estimatedPositions) || item.estimatedPositions < 0 || item.estimatedPositions > (item.positions as unknown[]).length)) return false;
  return (item.positions as unknown[]).every(row => {
    if (!row || typeof row !== "object") return false;
    const position = row as Record<string, unknown>;
    return [position.symbol, position.exchange, position.name].every(s => typeof s === "string" && s.length > 0)
      && (position.currency === "KRW" || position.currency === "USD")
      && [position.quantity, position.averagePrice, position.currentPrice, position.marketValue, position.profit, position.returnRate].every(n => typeof n === "number" && Number.isFinite(n))
      && (position.valuationBasis === undefined || position.valuationBasis === "QUOTE" || position.valuationBasis === "COST")
      && (position.quoteAsOf === undefined || position.quoteAsOf === null || typeof position.quoteAsOf === "string" && Number.isFinite(Date.parse(position.quoteAsOf)))
      && (position.quantity as number) >= 0;
  }) && (item.orders as unknown[]).every(row => !!row && typeof row === "object" && typeof (row as Record<string, unknown>).id === "string")
    && (item.protections as unknown[]).every(row => !!row && typeof row === "object" && typeof (row as Record<string, unknown>).id === "string");
}

const receiptStatuses = ["FILLED", "OPEN", "TRIGGERED", "REJECTED", "CANCELLED", "CANCELED"] as const;
type ReceiptStatus = (typeof receiptStatuses)[number];
export type OrderReceipt = {
  id: string;
  currency: "KRW" | "USD";
  detail?: string;
} & (
  | { status: "FILLED"; fillPrice: number }
  | { status: Exclude<ReceiptStatus, "FILLED">; fillPrice: number | null }
);

export function isOrderReceipt(value: unknown): value is OrderReceipt {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  const validPrice = typeof item.fillPrice === "number" && Number.isFinite(item.fillPrice) && item.fillPrice > 0;
  return typeof item.id === "string" && item.id.trim().length > 0
    && receiptStatuses.some(status => status === item.status)
    && (item.currency === "KRW" || item.currency === "USD")
    && (item.detail === undefined || typeof item.detail === "string")
    && (item.status === "FILLED" ? validPrice : item.fillPrice === null || validPrice);
}
