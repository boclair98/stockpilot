/** Optional company data, never an order price or a currency conversion. */
export const US_DETAIL_FIELDS = [
  "marketCapUsd", "listedShares", "open", "high", "low", "previousClose",
  "week52High", "week52Low", "per", "pbr",
] as const;

export type USDetailField = (typeof US_DETAIL_FIELDS)[number];
export type USDetailIdentity = { symbol: string; exchange: string; market: string; currency: string };
export type USMarketDetailData = Record<USDetailField, number | null> & {
  symbol: string;
  exchange: string;
  currency: "USD";
  asOf: string;
  availableCount: number;
  oldRetrieval: boolean;
};

export function supportsUSDetails(identity: USDetailIdentity): boolean {
  return identity.market === "US" && identity.currency === "USD"
    && /^[A-Z0-9][A-Z0-9.\-]{0,11}$/.test(identity.symbol)
    && ["NAS", "NYS", "AMS"].includes(identity.exchange);
}

function validTimestamp(value: unknown, now: number): value is string {
  if (typeof value !== "string") return false;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!parts) return false;
  const [year, month, day, hour, minute, second] = parts.slice(1, 7).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const offsetHour = Number(parts[9] ?? 0), offsetMinute = Number(parts[10] ?? 0);
  const parsed = Date.parse(value);
  return year >= 2000 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day && hour < 24 && minute < 60 && second < 60
    && offsetHour <= 14 && offsetMinute < 60 && (offsetHour !== 14 || offsetMinute === 0)
    && Number.isFinite(parsed) && parsed <= now + 5 * 60_000;
}

/** Reject a mismatched response; retain valid optional values without inventing zeroes. */
export function parseUSMarketDetails(value: unknown, identity: USDetailIdentity, now = Date.now()): USMarketDetailData | null {
  if (!supportsUSDetails(identity) || !value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.symbol !== identity.symbol || row.exchange !== identity.exchange || row.currency !== "USD"
    || !validTimestamp(row.asOf, now)) return null;
  const numbers = Object.fromEntries(US_DETAIL_FIELDS.map(field => {
    const number = row[field];
    return [field, typeof number === "number" && Number.isFinite(number) && number > 0 && number < 1e20
      && (field !== "listedShares" || Number.isSafeInteger(number)) ? number : null];
  })) as Record<USDetailField, number | null>;
  for (const [low, high] of [["low", "high"], ["week52Low", "week52High"]] as const) {
    if (numbers[low] !== null && numbers[high] !== null && numbers[low]! > numbers[high]!) {
      numbers[low] = null;
      numbers[high] = null;
    }
  }
  if (numbers.open !== null && ((numbers.low !== null && numbers.open < numbers.low)
    || (numbers.high !== null && numbers.open > numbers.high))) numbers.open = null;
  return { ...numbers, symbol: identity.symbol, exchange: identity.exchange, currency: "USD", asOf: row.asOf,
    availableCount: US_DETAIL_FIELDS.filter(field => numbers[field] !== null).length,
    oldRetrieval: now - Date.parse(row.asOf) >= 10 * 60_000 };
}

export function usDetailMoney(value: number | null, compact = false): string {
  if (value === null) return "—";
  return `US$${new Intl.NumberFormat("ko-KR", compact
    ? { notation: "compact", maximumFractionDigits: 2 }
    : { minimumFractionDigits: 2, maximumFractionDigits: 20 }).format(value)}`;
}

export function usDetailNumber(value: number | null, unit: "주" | "배"): string {
  if (value === null) return "—";
  return `${new Intl.NumberFormat("ko-KR", unit === "주"
    ? { notation: "compact", maximumFractionDigits: 2 }
    : { maximumFractionDigits: 2 }).format(value)}${unit}`;
}
