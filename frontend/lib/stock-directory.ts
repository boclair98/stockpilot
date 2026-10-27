import { isInstrument, type InstrumentIdentity } from "./instrument-identity";

export const DIRECTORY_EXCHANGES = {
  KR: [["ALL", "전체"], ["KOSPI", "코스피"], ["KOSDAQ", "코스닥"]],
  US: [["ALL", "전체"], ["NAS", "나스닥"], ["NYS", "뉴욕"], ["AMS", "아멕스"]],
} as const;
export type DirectoryCriteria = { market: "KR" | "US"; exchange: string; q: string; page: number; limit: number };
export type DirectoryItem = InstrumentIdentity & { englishName?: string; listingMarket?: string; logoUrl?: string | null };
export type DirectoryPage = {
  items: DirectoryItem[]; total: number; universeTotal: number; offset: number; limit: number;
  market: "KR" | "US"; exchange: string; query: string; partial: boolean; snapshot: string;
  coverage: { exchange: string; available: boolean; loadedAt: string | null }[];
};
export function parseDirectoryCriteria(search: string): DirectoryCriteria {
  const params = new URLSearchParams(search);
  const market = params.get("market") === "US" ? "US" : "KR";
  const rawExchange = params.get("exchange") || "ALL";
  const exchange = DIRECTORY_EXCHANGES[market].some(([key]) => key === rawExchange) ? rawExchange : "ALL";
  const limit = [20, 50, 100].includes(Number(params.get("limit"))) ? Number(params.get("limit")) : 20;
  const rawPage = Number(params.get("page") || 1);
  const page = Number.isInteger(rawPage) && rawPage > 0 ? Math.min(rawPage, Math.floor(50000 / limit) + 1) : 1;
  return { market, exchange, limit, page, q: (params.get("q") || "").trim().slice(0, 80) };
}
export function directorySearch(criteria: DirectoryCriteria): string {
  const params = new URLSearchParams({market: criteria.market, exchange: criteria.exchange, limit: String(criteria.limit), page: String(criteria.page)});
  if (criteria.q) params.set("q", criteria.q);
  return params.toString();
}
export function directoryRequest(criteria: DirectoryCriteria, snapshot = ""): string {
  const params = new URLSearchParams({market: criteria.market, exchange: criteria.exchange, limit: String(criteria.limit), offset: String((criteria.page - 1) * criteria.limit)});
  if (criteria.q) params.set("q", criteria.q);
  if (snapshot) params.set("snapshot", snapshot);
  return `/api/market/instruments?${params}`;
}
export function validateDirectoryPage(value: unknown, criteria: DirectoryCriteria): DirectoryPage {
  if (!value || typeof value !== "object") throw new Error("종목 목록의 응답을 확인하지 못했어요.");
  const page = value as DirectoryPage;
  if (!Array.isArray(page.items) || page.items.length > criteria.limit ||
      !Number.isInteger(page.total) || page.total < 0 || !Number.isInteger(page.universeTotal) || page.universeTotal < page.total ||
      page.offset !== (criteria.page - 1) * criteria.limit || page.limit !== criteria.limit ||
      page.market !== criteria.market || page.exchange !== criteria.exchange || page.query !== criteria.q ||
      typeof page.partial !== "boolean" || typeof page.snapshot !== "string" || !page.snapshot ||
      !Array.isArray(page.coverage) || page.coverage.length === 0 || page.coverage.some(row => !row || typeof row.exchange !== "string" || typeof row.available !== "boolean" || (row.loadedAt !== null && (typeof row.loadedAt !== "string" || !Number.isFinite(Date.parse(row.loadedAt))))) ||
      (!page.partial && page.coverage.some(row => !row.available)) ||
      page.items.some(item => !isInstrument(item) || item.market !== criteria.market || item.id !== `${item.market}:${item.exchange}:${item.symbol}` ||
        !(criteria.market === "KR" ? item.exchange === "KRX" && /^[0-9A-Z]{6}$/.test(item.symbol) : ["NAS", "NYS", "AMS"].includes(item.exchange) && /^[A-Z0-9][A-Z0-9.\/\-]{0,11}$/.test(item.symbol)) ||
        (criteria.exchange !== "ALL" && (item.market === "KR" ? item.listingMarket : item.exchange) !== criteria.exchange)) ||
      new Set(page.items.map(item => item.id)).size !== page.items.length ||
      page.items.length !== Math.max(0, Math.min(criteria.limit, page.total - page.offset))) {
    throw new Error("종목 목록의 응답을 확인하지 못했어요. 다시 조회해 주세요.");
  }
  return page;
}
export function instrumentDetailHref(item: InstrumentIdentity): string {
  return `/?${new URLSearchParams({view: "detail", market: item.market, exchange: item.exchange, symbol: item.symbol})}`;
}
