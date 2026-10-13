export type InstrumentIdentity = {
  id: string;
  symbol: string;
  name: string;
  market: "KR" | "US";
  currency: "KRW" | "USD";
  exchange: string;
};

export function isInstrument(value: unknown): value is InstrumentIdentity {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return [item.id, item.symbol, item.name, item.exchange].every(field => typeof field === "string" && field.trim().length > 0)
    && (item.market === "KR" || item.market === "US")
    && item.currency === (item.market === "KR" ? "KRW" : "USD");
}
