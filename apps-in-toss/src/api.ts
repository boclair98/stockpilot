import { User } from "@apps-in-toss/web-framework";
import type { Bootstrap, GrowthOverview, League, Market, Portfolio, Quote, SimulationRules, TradeJournal, WatchItem } from "./types";

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

const previewWatchlist: WatchItem[] = [];
const previewJournals: TradeJournal[] = [];
const previewPortfolio: Portfolio = structuredClone(PREVIEW_PORTFOLIO);
const PREVIEW_RULES: SimulationRules = {
  fees: { commissionRate: 0.015, krSellTaxRate: 0.2, slippage: "체결 시 시장 상황을 반영" },
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
    return Promise.resolve([PREVIEW_BOOTSTRAP, structuredClone(previewPortfolio), PREVIEW_LEAGUE]);
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
    return Promise.resolve({ ...(PREVIEW_QUOTES.find((item) => item.symbol === stock.symbol && item.exchange === stock.exchange) || { ...stock, name: stock.symbol, currency: stock.market === "KR" ? "KRW" : "USD", price: 0 }), asOf: new Date().toISOString() });
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
  if (IS_LOCAL_PREVIEW) {
    const id = crypto.randomUUID();
    const { stock, side, quantity } = input;
    const fee = stock.price * quantity * PREVIEW_RULES.fees.commissionRate / 100;
    const current = previewPortfolio.positions.find((item) => item.symbol === stock.symbol && item.exchange === stock.exchange);
    if (side === "SELL" && (!current || current.quantity < quantity)) return Promise.reject(new ApiError("보유 수량이 부족해요.", 409));
    if (side === "BUY" && previewPortfolio.cash[stock.currency] < stock.price * quantity + fee) return Promise.reject(new ApiError("주문 가능 금액이 부족해요.", 409));
    previewPortfolio.cash[stock.currency] += side === "BUY" ? -(stock.price * quantity + fee) : stock.price * quantity - fee;
    if (side === "BUY") {
      if (current) {
        current.averagePrice = (current.averagePrice * current.quantity + stock.price * quantity) / (current.quantity + quantity);
        current.quantity += quantity;
      } else {
        previewPortfolio.positions.push({ ...stock, quantity, averagePrice: stock.price, currentPrice: stock.price, marketValue: 0, profit: 0, returnRate: 0 });
      }
    } else if (current) {
      current.quantity -= quantity;
      if (current.quantity === 0) previewPortfolio.positions.splice(previewPortfolio.positions.indexOf(current), 1);
    }
    const changed = previewPortfolio.positions.find((item) => item.symbol === stock.symbol && item.exchange === stock.exchange);
    if (changed) {
      changed.marketValue = changed.currentPrice * changed.quantity;
      changed.profit = (changed.currentPrice - changed.averagePrice) * changed.quantity;
      changed.returnRate = changed.averagePrice > 0 ? (changed.currentPrice / changed.averagePrice - 1) * 100 : 0;
    }
    previewPortfolio.orders.unshift({ id, symbol: stock.symbol, exchange: stock.exchange, side, orderType: "MARKET", quantity, fillPrice: stock.price, status: "FILLED", createdAt: new Date().toISOString() });
    return Promise.resolve({ id, status: "FILLED", fillPrice: stock.price });
  }
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

export function loadWatchlist(): Promise<WatchItem[]> {
  if (IS_LOCAL_PREVIEW) return Promise.resolve([...previewWatchlist]);
  return request<{ watchlist: WatchItem[] }>("/api/features/dashboard").then((data) => data.watchlist);
}

export function addWatchlist(stock: Quote): Promise<{ id: string; added: boolean }> {
  if (IS_LOCAL_PREVIEW) {
    const current = previewWatchlist.find((item) => item.symbol === stock.symbol && item.exchange === stock.exchange);
    if (current) return Promise.resolve({ id: current.id, added: false });
    const id = crypto.randomUUID();
    previewWatchlist.unshift({ id, symbol: stock.symbol, name: stock.name, market: stock.market, currency: stock.currency, exchange: stock.exchange, price: stock.price, changePercent: stock.changePercent ?? null });
    return Promise.resolve({ id, added: true });
  }
  return request("/api/features/watchlist", { method: "POST", body: JSON.stringify({ symbol: stock.symbol, market: stock.market, exchange: stock.exchange }) });
}

export function removeWatchlist(id: string): Promise<void> {
  if (IS_LOCAL_PREVIEW) {
    const index = previewWatchlist.findIndex((item) => item.id === id);
    if (index >= 0) previewWatchlist.splice(index, 1);
    return Promise.resolve();
  }
  return request(`/api/features/watchlist/${encodeURIComponent(id)}`, { method: "DELETE" }).then(() => undefined);
}

export function loadSimulationRules(): Promise<SimulationRules> {
  if (IS_LOCAL_PREVIEW) return Promise.resolve(PREVIEW_RULES);
  return request<SimulationRules>("/api/trading/rules");
}

export function loadGrowthOverview(): Promise<GrowthOverview> {
  if (IS_LOCAL_PREVIEW) return Promise.resolve({ journals: [...previewJournals] });
  return request<GrowthOverview>("/api/growth/overview");
}

export function createJournal(input: Pick<TradeJournal, "symbol" | "exchange" | "thesis" | "horizon" | "confidence">): Promise<GrowthOverview> {
  if (IS_LOCAL_PREVIEW) {
    previewJournals.unshift({ ...input, id: crypto.randomUUID(), name: PREVIEW_QUOTES.find((quote) => quote.symbol === input.symbol && quote.exchange === input.exchange)?.name || input.symbol, review: null, outcome: null, createdAt: new Date().toISOString() });
    return Promise.resolve({ journals: [...previewJournals] });
  }
  return request<GrowthOverview>("/api/growth/journals", { method: "POST", body: JSON.stringify(input) });
}

export function reviewJournal(id: string, review: string, outcome: "WIN" | "LOSS" | "EVEN" | "OPEN"): Promise<GrowthOverview> {
  if (IS_LOCAL_PREVIEW) {
    const item = previewJournals.find((journal) => journal.id === id);
    if (item) { item.review = review; item.outcome = outcome; }
    return Promise.resolve({ journals: [...previewJournals] });
  }
  return request<GrowthOverview>(`/api/growth/journals/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ review, outcome }) });
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
