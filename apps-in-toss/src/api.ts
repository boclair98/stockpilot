import { User } from "@apps-in-toss/web-framework";
import type { Bootstrap, League, Market, Portfolio, Quote } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE || "https://stockpilot.coders.kr";
const TOKEN_KEY = "stockpilot:toss-access:v1";
const IS_LOCAL_PREVIEW = import.meta.env.DEV;

const PREVIEW_QUOTES: Quote[] = [
  { symbol: "005930", name: "삼성전자", market: "KR", currency: "KRW", exchange: "KRX", price: 84200, changePercent: 1.32 },
  { symbol: "000660", name: "SK하이닉스", market: "KR", currency: "KRW", exchange: "KRX", price: 192500, changePercent: -0.68 },
  { symbol: "035420", name: "NAVER", market: "KR", currency: "KRW", exchange: "NXT", price: 224000, changePercent: 2.18 },
  { symbol: "AAPL", name: "Apple", market: "US", currency: "USD", exchange: "NAS", price: 227.16, changePercent: 0.84 },
  { symbol: "NVDA", name: "NVIDIA", market: "US", currency: "USD", exchange: "NAS", price: 141.97, changePercent: 2.45 },
  { symbol: "TSLA", name: "Tesla", market: "US", currency: "USD", exchange: "NAS", price: 348.62, changePercent: -1.14 },
];

const PREVIEW_BOOTSTRAP: Bootstrap = {
  quotes: PREVIEW_QUOTES,
  kospi: {
    name: "KOSPI",
    value: 2874.42,
    change: 18.21,
    changePercent: 0.64,
    points: [2750, 2774, 2760, 2811, 2798, 2835, 2828, 2861, 2854, 2874].map((close, index) => ({ date: `2026-09-${String(index + 1).padStart(2, "0")}`, close })),
  },
  asOf: new Date().toISOString(),
};

const PREVIEW_PORTFOLIO: Portfolio = {
  authenticated: true,
  cash: { KRW: 82_360_000, USD: 98_420 },
  positions: [
    { ...PREVIEW_QUOTES[0], quantity: 120, averagePrice: 78100, currentPrice: 84200, marketValue: 10_104_000, profit: 732_000, returnRate: 7.81 },
    { ...PREVIEW_QUOTES[4], quantity: 15, averagePrice: 132.4, currentPrice: 141.97, marketValue: 2129.55, profit: 143.55, returnRate: 7.23 },
  ],
  orders: [],
};

const PREVIEW_LEAGUE: League = {
  title: "StockPilot 오픈 리그",
  participantCount: 1248,
  rankings: [
    { rank: 1, nickname: "가치사냥꾼", returnRate: 18.42, rankChange: 2 },
    { rank: 2, nickname: "초록캔들", returnRate: 15.88, rankChange: -1 },
    { rank: 3, nickname: "장기투자연습", returnRate: 13.74, rankChange: 1 },
    { rank: 4, nickname: "반도체꿈나무", returnRate: 11.23, rankChange: 0 },
  ],
  me: { joined: false },
};

let accessToken = localStorage.getItem(TOKEN_KEY) || "";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

function detailMessage(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "detail" in value) {
    const detail = (value as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
  }
  return "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.";
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(detailMessage(data), response.status);
  return data as T;
}

export async function initializeTossSession(): Promise<void> {
  if (IS_LOCAL_PREVIEW) return;
  if (accessToken) return;
  if (!User.getAnonymousKey.isSupported()) {
    throw new ApiError("토스 앱에서 최신 버전으로 실행해 주세요.");
  }
  const result = await User.getAnonymousKey();
  if (!result?.hash) throw new ApiError("사용자 식별 정보를 확인하지 못했어요.");
  const session = await request<{ access_token: string }>("/api/auth/toss/anonymous", {
    method: "POST",
    body: JSON.stringify({ anonymous_key: result.hash }),
  });
  accessToken = session.access_token;
  localStorage.setItem(TOKEN_KEY, accessToken);
}

export function clearSession(): void {
  accessToken = "";
  localStorage.removeItem(TOKEN_KEY);
}

export function loadDashboard(): Promise<[Bootstrap, Portfolio, League]> {
  if (IS_LOCAL_PREVIEW) {
    return Promise.resolve([PREVIEW_BOOTSTRAP, PREVIEW_PORTFOLIO, PREVIEW_LEAGUE]);
  }
  return Promise.all([
    request<Bootstrap>("/api/trading/bootstrap"),
    request<Portfolio>("/api/trading/portfolio"),
    request<League>("/api/league/rankings"),
  ]);
}

export async function searchStocks(query: string, market: "ALL" | Market, signal?: AbortSignal): Promise<Quote[]> {
  if (IS_LOCAL_PREVIEW) {
    const needle = query.trim().toLowerCase();
    return PREVIEW_QUOTES.filter((item) => (market === "ALL" || item.market === market) && `${item.name} ${item.symbol}`.toLowerCase().includes(needle));
  }
  const params = new URLSearchParams({ q: query, market, limit: "30" });
  const result = await request<{ items: Quote[] }>(`/api/trading/search?${params}`, { signal });
  return result.items;
}

export function loadQuote(stock: Pick<Quote, "symbol" | "market" | "exchange">): Promise<Quote> {
  if (IS_LOCAL_PREVIEW) {
    return Promise.resolve(PREVIEW_QUOTES.find((item) => item.symbol === stock.symbol && item.exchange === stock.exchange) || { ...stock, name: stock.symbol, currency: stock.market === "KR" ? "KRW" : "USD", price: 0 });
  }
  const params = new URLSearchParams({
    symbol: stock.symbol,
    market: stock.market,
    exchange: stock.exchange,
  });
  return request<Quote>(`/api/trading/quote?${params}`);
}

export function submitOrder(input: {
  stock: Quote;
  side: "BUY" | "SELL";
  quantity: number;
}): Promise<{ id: string; status: string; fillPrice?: number }> {
  if (IS_LOCAL_PREVIEW) return Promise.resolve({ id: crypto.randomUUID(), status: "FILLED", fillPrice: input.stock.price });
  return request("/api/trading/orders", {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({
      symbol: input.stock.symbol,
      market: input.stock.market,
      exchange: input.stock.exchange,
      side: input.side,
      orderType: "MARKET",
      quantity: input.quantity,
    }),
  });
}

export function joinLeague(nickname: string): Promise<League> {
  if (IS_LOCAL_PREVIEW) return Promise.resolve({ ...PREVIEW_LEAGUE, me: { joined: true, nickname: nickname || "새 파일럿", rank: 842, returnRate: 0 } });
  return request("/api/league/join", {
    method: "POST",
    body: JSON.stringify({ nickname: nickname || null }),
  });
}

export function deleteAccount(): Promise<{ status: string }> {
  if (IS_LOCAL_PREVIEW) return Promise.resolve({ status: "deleted" });
  return request("/api/users/me", { method: "DELETE" });
}
