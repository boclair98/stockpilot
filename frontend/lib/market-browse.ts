import type { MouseEvent } from "react";
import { DIRECTORY_EXCHANGES, embeddedDirectoryCriteria, embeddedDirectorySearch } from "./stock-directory";

export const MARKET_BROWSE_EVENT = "stockpilot:market-browse";
export const ALL_INSTRUMENTS_HREF = "/?browse=all#market-rankings";
export const BROWSE_METRICS = [["ALL", "전체 종목"], ["CAP", "시가총액"], ["VOLUME", "거래량"], ["UP", "상승률"], ["DOWN", "하락률"]] as const;
export type BrowseMetric = typeof BROWSE_METRICS[number][0];
export type BrowseSelection = { market: "KR" | "US"; metric: BrowseMetric; exchange: string };

export function parseMarketBrowse(location: string): BrowseSelection {
  const [search, hash = ""] = location.split("#");
  const params = new URLSearchParams(search);
  const market = hash === "us-top" ? "US" : hash === "kr-top" ? "KR" : params.get("browseMarket") === "US" ? "US" : "KR";
  const rawMetric = (params.get("browse") || "CAP").toUpperCase();
  const metric = BROWSE_METRICS.some(([value]) => value === rawMetric) ? rawMetric as BrowseMetric : "CAP";
  const rawExchange = params.get("rankExchange") || "ALL";
  const exchange = DIRECTORY_EXCHANGES[market].some(([value]) => value === rawExchange) ? rawExchange : "ALL";
  return {market, metric, exchange};
}

export function marketBrowseHref(location: string, patch: Partial<BrowseSelection> = {}): string {
  const current = parseMarketBrowse(location);
  const next = {...current, ...patch};
  const directory = embeddedDirectoryCriteria(location);
  if (next.market !== directory.market) {
    directory.market = next.market;
    directory.exchange = "ALL";
    directory.page = 1;
  }
  const params = new URLSearchParams(embeddedDirectorySearch(directory));
  params.set("browse", next.metric.toLowerCase());
  const exchange = next.market !== current.market ? "ALL" : next.exchange;
  if (DIRECTORY_EXCHANGES[next.market].some(([value]) => value === exchange) && exchange !== "ALL") params.set("rankExchange", exchange);
  return `/?${params}#market-rankings`;
}

export function marketReturnHref(search: string): string {
  return new URLSearchParams(search).has("browse") ? marketBrowseHref(search) : "/#market-rankings";
}

export function subscribeMarketBrowse(callback: () => void) {
  window.addEventListener("popstate", callback);
  window.addEventListener("hashchange", callback);
  window.addEventListener(MARKET_BROWSE_EVENT, callback);
  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener("hashchange", callback);
    window.removeEventListener(MARKET_BROWSE_EVENT, callback);
  };
}
export const readMarketBrowse = () => location.search + location.hash;
export const serverMarketBrowse = () => "";

export function navigateMarketBrowse(href: string) {
  if (href === location.pathname + location.search + location.hash) return;
  history.pushState({stockpilotView: "MARKET"}, "", href);
  window.dispatchEvent(new Event(MARKET_BROWSE_EVENT));
}

export function followMarketBrowseLink(event: MouseEvent<HTMLAnchorElement>) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || location.pathname !== "/") return;
  const href = event.currentTarget.getAttribute("href");
  if (!href?.startsWith("/?browse=all")) return;
  event.preventDefault();
  navigateMarketBrowse(href);
  requestAnimationFrame(() => document.getElementById("market-rankings")?.scrollIntoView({block: "start", behavior: "instant"}));
}

/** The static-export workspace owns query navigation; do not ask Next to fetch
 * an identical RSC page merely to change the selected instrument. */
export function followInstrumentDetailLink(event: MouseEvent<HTMLAnchorElement>) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || location.pathname !== "/") return;
  const href = event.currentTarget.getAttribute("href");
  if (!href?.startsWith("/?view=detail&")) return;
  event.preventDefault();
  history.pushState({stockpilotView: "DETAIL"}, "", href);
  window.dispatchEvent(new Event("popstate"));
  requestAnimationFrame(() => window.scrollTo({top:0, behavior:"auto"}));
}
