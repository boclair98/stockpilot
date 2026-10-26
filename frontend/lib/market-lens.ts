import type { RankedStock } from "./ranking-comparison";

export type MarketLensValue = {
  query: string;
  movement: "ALL" | "UP" | "DOWN" | "FLAT";
  savedOnly: boolean;
  minPrice: string;
  maxPrice: string;
};
export const EMPTY_MARKET_LENS: MarketLensValue = {
  query: "", movement: "ALL", savedOnly: false, minPrice: "", maxPrice: "",
};
export function priceRange(value: MarketLensValue, currency: "KRW" | "USD") {
  const pattern = currency === "KRW" ? /^\d{1,13}$/ : /^\d{1,13}(?:\.\d{1,2})?$/;
  const read = (raw: string) => raw === "" ? null : pattern.test(raw) && Number(raw) <= 1e13 ? Number(raw) : NaN;
  const min = read(value.minPrice), max = read(value.maxPrice);
  if ((min !== null && !Number.isFinite(min)) || (max !== null && !Number.isFinite(max))) {
    return { min: null, max: null, error: currency === "KRW" ? "원화 가격은 0 이상의 정수로 입력해 주세요." : "달러 가격은 0 이상, 소수 둘째 자리까지 입력해 주세요." };
  }
  if (min !== null && max !== null && min > max) return { min, max, error: "최고 가격을 최저 가격 이상으로 입력해 주세요." };
  return { min, max, error: "" };
}
export function marketDistribution(items: RankedStock[]) {
  const result = { up: 0, down: 0, flat: 0, unknown: 0, total: items.length };
  for (const item of items) {
    const change = item.changePercent;
    if (typeof change !== "number" || !Number.isFinite(change)) result.unknown++;
    else if (change > 0) result.up++;
    else if (change < 0) result.down++;
    else result.flat++;
  }
  return result;
}
export function marketLensActive(value: MarketLensValue) {
  return Boolean(value.query.trim() || value.movement !== "ALL" || value.savedOnly || value.minPrice || value.maxPrice);
}
export function filterRankedStocks(items: RankedStock[], value: MarketLensValue, savedIds: Set<string>, currency: "KRW" | "USD") {
  const range = priceRange(value, currency);
  if (range.error) return { items: [], error: range.error };
  const query = value.query.trim().toLocaleLowerCase("ko-KR").slice(0, 100);
  const matches = items.map((stock, index) => ({ stock, rank: index + 1 })).filter(({ stock }) => {
    if (stock.currency !== currency) return false;
    if (query && !`${stock.name} ${stock.symbol} ${stock.exchange}`.toLocaleLowerCase("ko-KR").includes(query)) return false;
    if (value.savedOnly && !savedIds.has(stock.id)) return false;
    if (value.movement !== "ALL") {
      const change = stock.changePercent;
      if (typeof change !== "number" || !Number.isFinite(change)) return false;
      if (value.movement === "UP" && change <= 0 || value.movement === "DOWN" && change >= 0 || value.movement === "FLAT" && change !== 0) return false;
    }
    if (range.min !== null || range.max !== null) {
      if (typeof stock.price !== "number" || !Number.isFinite(stock.price) || stock.price <= 0) return false;
      if (range.min !== null && stock.price < range.min || range.max !== null && stock.price > range.max) return false;
    }
    return true;
  });
  return { items: matches, error: "" };
}
