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
  return (item.positions as unknown[]).every(row => {
    if (!row || typeof row !== "object") return false;
    const position = row as Record<string, unknown>;
    return [position.symbol, position.exchange, position.name].every(s => typeof s === "string" && s.length > 0)
      && (position.currency === "KRW" || position.currency === "USD")
      && [position.quantity, position.averagePrice, position.currentPrice, position.marketValue, position.profit, position.returnRate].every(n => typeof n === "number" && Number.isFinite(n))
      && (position.quantity as number) >= 0;
  }) && (item.orders as unknown[]).every(row => !!row && typeof row === "object" && typeof (row as Record<string, unknown>).id === "string")
    && (item.protections as unknown[]).every(row => !!row && typeof row === "object" && typeof (row as Record<string, unknown>).id === "string");
}

export type OrderReceipt = { id: string; status: "FILLED" | "OPEN" | "REJECTED" | "CANCELLED" | "CANCELED"; currency: "KRW" | "USD"; fillPrice: number | null; detail?: string };
export function isOrderReceipt(value: unknown): value is OrderReceipt {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && item.id.length > 0 && ["FILLED","OPEN","REJECTED","CANCELLED","CANCELED"].includes(String(item.status))
    && ["KRW","USD"].includes(String(item.currency))
    && (item.status !== "FILLED" || typeof item.fillPrice === "number" && Number.isFinite(item.fillPrice) && item.fillPrice > 0);
}
