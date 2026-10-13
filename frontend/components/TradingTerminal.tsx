"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import {
  FormEvent,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  BadgeCheck,
  Bell,
  BrainCircuit,
  ChevronRight,
  Gauge,
  GraduationCap,
  History,
  HelpCircle,
  LogIn,
  LogOut,
  PieChart,
  MessageCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  Star,
  Target,
  Trophy,
  X,
} from "lucide-react";

import DeferredMount from "./DeferredMount";
import MarketIndexChart, { type IndexData } from "./MarketIndexChart";
import WorkspaceControls from "./WorkspaceControls";
import CommandSearch from "./CommandSearch";
import DecisionNotebook from "./DecisionNotebook";
import OrderTimeline from "./OrderTimeline";
import RankedMarketBrowser from "./RankedMarketBrowser";
import FullMarketCatalog from "./FullMarketCatalog";
import { useDialogFocus } from "@/lib/dialog-focus";
import { isInstrument } from "@/lib/instrument-identity";
import StockLogo from "./StockLogo";
import KospiBenchmarkCard from "./KospiBenchmarkCard";
import MarketWatchlist, { type WatchlistItem } from "./MarketWatchlist";
import AdSlot from "./AdSlot";
import OrderResult, { type OrderResultState } from "./OrderResult";
import { ApiRequestError, requestJson } from "@/lib/reliable-request";
import { isOrderReceipt, isValidPortfolio, isValidQuote, type OrderReceipt } from "@/lib/trading-validation";

const CompanyInsight = dynamic(() => import("./CompanyInsight"), {
  loading: () => (
    <div
      className="chunk-placeholder"
      style={{ minHeight: 320 }}
      aria-hidden="true"
    />
  ),
});
const InvestorTools = dynamic(() => import("./InvestorTools"), {
  loading: () => (
    <div
      className="chunk-placeholder"
      style={{ minHeight: 420 }}
      aria-hidden="true"
    />
  ),
});
const OnboardingGuide = dynamic(() => import("./OnboardingGuide"), {
  loading: () => null,
});
const StockTrendPanel = dynamic(() => import("./StockTrendPanel"), {
  loading: () => (
    <div
      className="chunk-placeholder"
      style={{ minHeight: 360 }}
      aria-hidden="true"
    />
  ),
});
const SimulationControlCenter = dynamic(
  () => import("./SimulationControlCenter"),
  {
    loading: () => (
      <div
        className="chunk-placeholder compact"
        style={{ minHeight: 92 }}
        aria-hidden="true"
      />
    ),
  },
);
const MarketReplayStudio = dynamic(() => import("./MarketReplayStudio"), {
  loading: () => (
    <div
      className="chunk-placeholder compact"
      style={{ minHeight: 160 }}
      aria-hidden="true"
    />
  ),
});

type Currency = "KRW" | "USD";
type Market = "KR" | "US";
type Quote = {
  id: string;
  symbol: string;
  name: string;
  market: Market;
  currency: Currency;
  exchange: string;
  price: number;
  change: number;
  changePercent: number;
  marketState: string;
  asOf: string;
  source: string;
  venue: string;
  isTop: boolean;
  logoUrl?: string | null;
};
type Position = {
  symbol: string;
  name: string;
  market: Market;
  currency: Currency;
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  costBasis: number;
  marketValue: number;
  profit: number;
  returnRate: number;
  exchange: string;
  logoUrl?: string | null;
};
type Order = {
  id: string;
  symbol: string;
  exchange: string;
  side: string;
  orderType: string;
  quantity: number;
  fillPrice: number | null;
  referencePrice?: number | null;
  spreadBps?: number | null;
  slippageBps?: number | null;
  participationRate?: number | null;
  status: string;
  createdAt: string;
};
type Protection = {
  id: string;
  symbol: string;
  exchange: string;
  quantity: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  status: string;
  triggerReason: string | null;
  exitOrderId: string | null;
  triggeredAt: string | null;
  createdAt: string;
};
type Portfolio = {
  authenticated: boolean;
  cash: Record<Currency, number>;
  positions: Position[];
  orders: Order[];
  protections: Protection[];
};
type MarketStatus = {
  configured: boolean;
  connected: boolean;
  source: string;
  domesticVenue: string;
  domesticMarketCode: string;
  quoteCount: number;
};
type SearchItem = {
  id: string;
  symbol: string;
  name: string;
  englishName: string;
  market: Market;
  currency: Currency;
  exchange: string;
  logoUrl?: string | null;
};
type Me = {
  coders_id: string;
  display_name: string;
  email: string | null;
  picture: string | null;
};
type OrderSafetyChecks = {
  simulation: boolean;
  quote: boolean;
  amount: boolean;
  inventory: boolean;
};

const palette = [
  "#111827",
  "#2563eb",
  "#76b900",
  "#ef4444",
  "#f59e0b",
  "#0668e1",
  "#18a46b",
];
const colorFor = (symbol: string) =>
  palette[
    [...symbol].reduce((sum, char) => sum + char.charCodeAt(0), 0) %
      palette.length
  ];
const ORDER_LABELS = {
  MARKET: "시장가",
  LIMIT: "지정가",
  STOP: "손절·돌파 주문",
  STOP_LIMIT: "조건부 지정가",
} as const;
const money = (value: number, currency: Currency) =>
  new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "KRW" ? 0 : 2,
  }).format(value);
const percentText = (value: number) =>
  `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

export default function TradingTerminal() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [portfolio, setPortfolio] = useState<Portfolio>({
    authenticated: false,
    cash: { KRW: 100_000_000, USD: 100_000 },
    positions: [],
    orders: [],
    protections: [],
  });
  const [status, setStatus] = useState<MarketStatus | null>(null);
  const [bootstrapKospi, setBootstrapKospi] = useState<IndexData | null>(null);
  const [selected, setSelected] = useState("KR:KRX:005930");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [kind, setKind] = useState<"MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT">(
    "MARKET",
  );
  const [quantity, setQuantity] = useState("1");
  const [limitPrice, setLimitPrice] = useState("");
  const [triggerPrice, setTriggerPrice] = useState("");
  const [socketConnected, setSocketConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [accountState, setAccountState] = useState<"loading" | "ready" | "error">("loading");
  const [accountUpdatedAt, setAccountUpdatedAt] = useState<number | null>(null);
  const [accountRefreshing, setAccountRefreshing] = useState(false);
  const [orderResult, setOrderResult] = useState<OrderResultState | null>(null);
  const [checkingOrder, setCheckingOrder] = useState(false);
  const [pendingRetryAvailable, setPendingRetryAvailable] = useState(false);
  const accountRequest = useRef<Promise<void> | null>(null);
  const accountLastSuccess = useRef(0);
  const orderLock = useRef(false);
  const accountActionLock = useRef(false);
  const pendingOrder = useRef<{ key: string; body: string; name: string; owner: string | null } | null>(null);
  const [toast, setToast] = useState("");
  const [me, setMe] = useState<Me | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMarket, setSearchMarket] = useState<"ALL" | Market>("ALL");
  const [searchResults, setSearchResults] = useState<SearchItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [clock, setClock] = useState<Date | null>(null);
  const [unreadAlerts, setUnreadAlerts] = useState(0);
  const [alertFocusKey, setAlertFocusKey] = useState(0);
  const [recentStocks, setRecentStocks] = useState<SearchItem[]>([]);
  const [favoriteStocks, setFavoriteStocks] = useState<SearchItem[]>([]);
  const [confirmingOrder, setConfirmingOrder] = useState(false);
  const [orderSafetyChecks, setOrderSafetyChecks] = useState<OrderSafetyChecks>(
    {
      simulation: false,
      quote: false,
      amount: false,
      inventory: false,
    },
  );
  const [stressMove, setStressMove] = useState(-5);
  const [protectionQuantity, setProtectionQuantity] = useState("1");
  const [takeProfitPrice, setTakeProfitPrice] = useState("");
  const [stopLossPrice, setStopLossPrice] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);
  const [mobileOrderOpen, setMobileOrderOpen] = useState(false);
  const [workspaceView, setWorkspaceView] = useState<
    "MARKET" | "DETAIL" | "WATCH" | "ASSETS" | "RECORDS"
  >("MARKET");
  const showMarket = useCallback(() => {
    setWorkspaceView("MARKET");
    setMobileOrderOpen(false);
    history.pushState(
      { stockpilotView: "MARKET" },
      "",
      location.pathname + "#market-rankings",
    );
  }, []);
  const [detailTab, setDetailTab] = useState("RESEARCH");
  const [searchFailed, setSearchFailed] = useState(false);
  const selectionRequest = useRef(0);
  const closeMobileOrder = useCallback(() => setMobileOrderOpen(false), []);
  const closeConfirmation = useCallback(() => {
    if (!busy) setConfirmingOrder(false);
  }, [busy]);
  useDialogFocus(mobileOrderOpen, ".order-card", closeMobileOrder);
  useDialogFocus(confirmingOrder, ".order-confirm", closeConfirmation);
  useEffect(() => {
    const sync = () => {
      const params = new URLSearchParams(location.search);
      const hash = location.hash;
      setWorkspaceView(
        hash === "#holdings"
          ? "ASSETS"
          : hash === "#decision-review"
            ? "RECORDS"
            : hash === "#favorite-board-title"
              ? "WATCH"
              : ["#investor-tools", "#news-panel", "#order-ticket"].includes(
                    hash,
                  )
                ? "DETAIL"
                : ![
                      "#market-rankings",
                      "#search-card",
                      "#kr-top",
                      "#us-top",
                    ].includes(hash) && params.get("view") === "detail"
                  ? "DETAIL"
                  : "MARKET",
      );
      if (hash === "#decision-review") setDetailTab("REVIEW");
      if (hash === "#investor-tools") {
        setDetailTab("TOOLS");
        setAlertFocusKey((value) => value + 1);
      }
      if (hash === "#news-panel") setDetailTab("RESEARCH");
      if (
        hash === "#order-ticket" &&
        window.matchMedia("(max-width:1023px)").matches
      )
        setMobileOrderOpen(true);
      if (params.get("symbol")) {
        setSelected(
          `${params.get("market") || "KR"}:${params.get("exchange") || "KRX"}:${params.get("symbol")}`,
        );
      }
    };
    const timer = window.setTimeout(sync, 0);
    window.addEventListener("popstate", sync);
    window.addEventListener("hashchange", sync);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("popstate", sync);
      window.removeEventListener("hashchange", sync);
    };
  }, []);
  const toastTimer = useRef<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const quoteRequestCache = useRef(
    new Map<string, { expiresAt: number; request: Promise<Quote> }>(),
  );

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 3500);
  }, []);

  const refreshPortfolio = useCallback((): Promise<void> => {
    if (accountRequest.current) return accountRequest.current;
    setAccountRefreshing(true);
    const request = requestJson<Portfolio>("/api/trading/portfolio", {credentials:"include",cache:"no-store"})
      .then(data => {
        if (!isValidPortfolio(data)) throw new Error("계좌 응답 확인 실패");
        setPortfolio(data);
        accountLastSuccess.current = Date.now();
        setAccountUpdatedAt(accountLastSuccess.current);
        setAccountState("ready");
      }).catch(() => { setAccountState("error"); })
      .finally(() => { accountRequest.current = null; setAccountRefreshing(false); });
    accountRequest.current = request;
    return request;
  }, []);

  // Keep only the request key across a reload. No balances, credentials or
  // order draft are persisted. Restored requests are queried, never resent.
  useEffect(() => {
    if (!me?.coders_id || pendingOrder.current) return;
    try {
      const stored = JSON.parse(sessionStorage.getItem("stockpilot_pending_order_v1") || "null");
      if (stored?.owner === me.coders_id && typeof stored.key === "string" && /^[a-zA-Z0-9._:-]{8,128}$/.test(stored.key)) {
        pendingOrder.current = {key:stored.key,owner:me.coders_id,body:"",name:"이전 주문"};
        setOrderResult({kind:"uncertain",message:"이전에 보낸 주문의 응답을 확인하지 못했어요. 처리 결과를 조회해 주세요."});
      }
    } catch { /* Private browsing can block session storage. */ }
  }, [me?.coders_id]);

  useEffect(() => {
    if (!portfolio.authenticated) return;
    const controller = new AbortController();
    void fetch("/api/me", {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((profile) => setMe(profile))
      .catch(() => undefined);
    return () => controller.abort();
  }, [portfolio.authenticated]);

  useEffect(() => {
    const initialPortfolioTimer = window.setTimeout(refreshPortfolio, 150);
    const portfolioTimer = window.setInterval(() => {
      if (!document.hidden) void refreshPortfolio();
    }, 10_000);
    let socket: WebSocket | null = null;
    // Browser timers are numbers; avoid NodeJS.Timeout leaking into the client
    // bundle's type inference when both DOM and Node types are installed.
    let reconnectTimer = 0;
    let stopped = false;
    let lastSnapshotSaved = 0;
    const bootstrapController = new AbortController();
    const saveSnapshot = (rows: Quote[]) => {
      const now = Date.now();
      if (now - lastSnapshotSaved < 5000) return;
      lastSnapshotSaved = now;
      try { localStorage.setItem("stockpilot_quote_snapshot", JSON.stringify(rows)); } catch { /* Storage is optional. */ }
    };
    try {
      const saved = JSON.parse(
        localStorage.getItem("stockpilot_quote_snapshot") || "[]",
      );
      if (Array.isArray(saved) && saved.length) {
        window.setTimeout(() => {
          if (!stopped) setQuotes(saved.filter((item:Quote) => isValidQuote(item) && Date.now() - Date.parse(item.asOf) < 7 * 86400_000).map((item:Quote) => ({...item,marketState:"CACHED"})));
        }, 0);
      }
    } catch {
      try { localStorage.removeItem("stockpilot_quote_snapshot"); } catch { /* Storage is optional. */ }
    }
    void requestJson<{quotes:Quote[];status:MarketStatus;kospi?:IndexData}>("/api/trading/bootstrap", {
      cache: "default",
      signal: bootstrapController.signal,
    })
      .then((data) => {
        if (!data || stopped) return;
        if (Array.isArray(data.quotes) && data.quotes.length) {
          const valid = data.quotes.filter(isValidQuote);
          setQuotes(valid);
          saveSnapshot(valid);
        }
        if (data.status) setStatus(data.status);
        if (data.kospi?.points?.length) setBootstrapKospi(data.kospi);
      })
      .catch(() => undefined);
    let reconnectDelay = 1000;
    let connecting = false;
    const connect = () => {
      if (
        stopped ||
        document.hidden ||
        connecting ||
        socket?.readyState === WebSocket.OPEN
      ) {
        return;
      }
      connecting = true;
      const nextSocket = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/trading/ws`,
      );
      socket = nextSocket;
      nextSocket.onopen = () => {
        connecting = false;
        reconnectDelay = 1000;
        setSocketConnected(true);
      };
      nextSocket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === "quotes" && Array.isArray(message.data)) {
            const incoming: Quote[] = message.data.filter(isValidQuote);
            startTransition(() => {
              setQuotes((current) => [
                ...incoming,
                ...current.filter(
                  (item) =>
                    !incoming.some((next: Quote) => next.id === item.id),
                ),
              ]);
              setStatus(message.status);
            });
            saveSnapshot(incoming);
          }
        } catch {
          // Ignore a malformed frame; the next snapshot can still recover.
        }
      };
      nextSocket.onclose = () => {
        if (socket !== nextSocket) return;
        connecting = false;
        setSocketConnected(false);
        if (!stopped && !document.hidden) {
          const jitter = Math.floor(Math.random() * 400);
          reconnectTimer = window.setTimeout(connect, reconnectDelay + jitter);
          reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
        }
      };
      nextSocket.onerror = () => nextSocket.close();
    };
    const refreshWhenVisible = () => {
      if (!document.hidden) {
        void refreshPortfolio();
        connect();
        return;
      }
      window.clearTimeout(reconnectTimer);
      if (
        socket?.readyState === WebSocket.OPEN ||
        socket?.readyState === WebSocket.CONNECTING
      ) {
        socket.close(1000, "background");
      }
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    connect();
    return () => {
      stopped = true;
      bootstrapController.abort();
      window.clearTimeout(initialPortfolioTimer);
      window.clearInterval(portfolioTimer);
      window.clearTimeout(reconnectTimer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      socket?.close();
    };
  }, [refreshPortfolio]);

  useEffect(() => {
    const update = () => setClock(new Date());
    update();
    const timer = window.setInterval(update, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        if (localStorage.getItem("stockpilot_onboarding_v2") !== "done") {
          setGuideOpen(true);
        }
      } catch {
        // Private browsing can block storage; the guide still remains available in the header.
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, []);

  const closeGuide = useCallback(() => {
    try {
      localStorage.setItem("stockpilot_onboarding_v2", "done");
    } catch {
      // The in-memory close still works when storage is unavailable.
    }
    setGuideOpen(false);
  }, []);

  const focusSearch = useCallback(() => {
    setWorkspaceView("MARKET");
    window.setTimeout(() => {
      document
        .getElementById("search-card")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      searchInputRef.current?.focus({ preventScroll: true });
    }, 180);
  }, []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey)
        return;
      const activeElement = document.activeElement as HTMLElement | null;
      if (
        activeElement?.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(activeElement?.tagName ?? "")
      ) {
        return;
      }
      event.preventDefault();
      focusSearch();
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [focusSearch]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = JSON.parse(
          localStorage.getItem("stockpilot_recent_stocks") || "[]",
        );
        if (Array.isArray(saved)) setRecentStocks(saved.filter(isInstrument).slice(0, 6).map(item => ({...item,englishName:""})));
        const favorites = JSON.parse(
          localStorage.getItem("stockpilot_favorite_stocks_v1") || "[]",
        );
        if (Array.isArray(favorites)) setFavoriteStocks(favorites.filter(isInstrument).slice(0, 12).map(item => ({...item,englishName:""})));
      } catch {
        try { localStorage.removeItem("stockpilot_recent_stocks"); localStorage.removeItem("stockpilot_favorite_stocks_v1"); } catch { /* Storage is optional. */ }
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!confirmingOrder) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setConfirmingOrder(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busy, confirmingOrder]);

  useEffect(
    () => () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/trading/search?q=${encodeURIComponent(query)}&market=${searchMarket}&limit=20`,
          { signal: controller.signal, cache: "no-store" },
        );
        if (!response.ok) throw new Error("search unavailable");
        const data = await response.json();
        if (!controller.signal.aborted) {
          setSearchFailed(false);
          if (!Array.isArray(data.items)) throw new Error("search unavailable");
          startTransition(() => setSearchResults(data.items.filter(isInstrument)));
        }
      } catch {
        if (!controller.signal.aborted) {
          setSearchResults([]);
          setSearchFailed(true);
        }
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 280);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [searchQuery, searchMarket]);

  const krTop = useMemo(
    () =>
      quotes.filter((item) => item.isTop && item.market === "KR").slice(0, 10),
    [quotes],
  );
  const usTop = useMemo(
    () =>
      quotes.filter((item) => item.isTop && item.market === "US").slice(0, 10),
    [quotes],
  );
  const quoteById = useMemo(
    () => new Map(quotes.map((item) => [item.id, item])),
    [quotes],
  );
  const quote = quoteById.get(selected);
  const activeSymbol = quote?.symbol ?? selected.split(":").at(-1) ?? "005930";
  const selectedName = quote?.name ?? activeSymbol;
  const favoriteIds = useMemo(
    () => new Set(favoriteStocks.map((item) => item.id)),
    [favoriteStocks],
  );
  const favoriteItems = useMemo<WatchlistItem[]>(
    () =>
      favoriteStocks.map((item) => {
        const liveQuote = quoteById.get(item.id);
        return {
          ...item,
          price: liveQuote?.price,
          changePercent: liveQuote?.changePercent,
          logoUrl: liveQuote?.logoUrl ?? item.logoUrl,
        };
      }),
    [favoriteStocks, quoteById],
  );
  const clockMs = clock?.getTime();
  const quoteObservedAt = quote?.asOf;
  const quoteFreshness = (() => {
    if (!clockMs || !quoteObservedAt)
      return { label: "시세 연결 중", state: "waiting" };
    const ageSeconds = Math.max(
      0,
      Math.floor((clockMs - new Date(quoteObservedAt).getTime()) / 1000),
    );
    if (!Number.isFinite(ageSeconds))
      return { label: "시세 확인 중", state: "waiting" };
    if (ageSeconds < 10) return { label: "방금 갱신", state: "fresh" };
    if (ageSeconds < 60)
      return { label: `${ageSeconds}초 전 갱신`, state: "fresh" };
    return {
      label: `${Math.floor(ageSeconds / 60)}분 전 갱신`,
      state: "stale",
    };
  })();
  const activePosition = portfolio.positions.find(
    (position) =>
      position.symbol === activeSymbol && position.exchange === quote?.exchange,
  );
  const pendingSellQuantity = portfolio.orders
    .filter(
      (order) =>
        order.side === "SELL" &&
        ["OPEN", "TRIGGERED"].includes(order.status) &&
        order.symbol === activeSymbol &&
        order.exchange === quote?.exchange,
    )
    .reduce((sum, order) => sum + order.quantity, 0);
  const activeProtections = portfolio.protections.filter(
    (plan) =>
      plan.status === "ACTIVE" &&
      plan.symbol === activeSymbol &&
      plan.exchange === quote?.exchange,
  );
  const protectedSellQuantity = activeProtections.reduce(
    (sum, plan) => sum + plan.quantity,
    0,
  );
  const availableSellQuantity = Math.max(
    0,
    (activePosition?.quantity ?? 0) -
      pendingSellQuantity -
      protectedSellQuantity,
  );
  const requestedQuantity = Number(quantity);
  const sellIssue =
    side !== "SELL" || !portfolio.authenticated
      ? ""
      : !activePosition || activePosition.quantity <= 0
        ? `${selectedName}은 현재 보유하고 있지 않아 매도할 수 없어요.`
        : requestedQuantity > availableSellQuantity
          ? `매도 가능 수량은 ${availableSellQuantity.toLocaleString("ko-KR")}주예요.`
          : "";
  const estimatedPrice =
    ["LIMIT", "STOP_LIMIT"].includes(kind) && Number(limitPrice) > 0
      ? Number(limitPrice)
      : quote?.price || 0;
  const maxBuyQuantity =
    estimatedPrice > 0
      ? Math.max(
          0,
          Math.floor(
            ((portfolio.cash[quote?.currency ?? "KRW"] || 0) * 0.998) /
              estimatedPrice,
          ),
        )
      : 0;
  const orderSafetyCount =
    Object.values(orderSafetyChecks).filter(Boolean).length;
  const orderSafetyReady = orderSafetyCount === 4;
  const orderSafetyItems: Array<{
    key: keyof OrderSafetyChecks;
    label: string;
    detail: string;
    disabled?: boolean;
  }> = [
    {
      key: "simulation",
      label: "실제 증권계좌가 아닌 가상주문임을 확인했어요.",
      detail: "체결과 잔고는 StockPilot 내부 가상원장에만 기록됩니다.",
    },
    {
      key: "quote",
      label: "현재 시세와 주문 방식을 확인했어요.",
      detail: `${quoteFreshness.label} · ${ORDER_LABELS[kind]}`,
    },
    {
      key: "amount",
      label: "수량과 예상 주문금액을 확인했어요.",
      detail: `${requestedQuantity.toLocaleString("ko-KR")}주 · ${money(estimatedPrice * requestedQuantity, quote?.currency ?? "KRW")}`,
    },
    {
      key: "inventory",
      label:
        side === "SELL"
          ? "보유 수량과 매도 가능 수량을 확인했어요."
          : "매수 주문이라 보유 수량 확인이 필요 없어요.",
      detail:
        side === "SELL"
          ? `매도 가능 ${availableSellQuantity.toLocaleString("ko-KR")}주`
          : "매수 주문 자동 확인",
      disabled: side !== "SELL",
    },
  ];
  const positionValues = useMemo(
    () =>
      portfolio.positions.reduce(
        (sum, position) => {
          const price =
            position.currentPrice ??
            quotes.find(
              (item) =>
                item.symbol === position.symbol &&
                item.exchange === position.exchange,
            )?.price ??
            position.averagePrice;
          sum[position.currency] += position.quantity * price;
          return sum;
        },
        { KRW: 0, USD: 0 } as Record<Currency, number>,
      ),
    [portfolio.positions, quotes],
  );
  const performance = useMemo(
    () =>
      portfolio.positions.reduce(
        (sum, position) => {
          sum[position.currency] += position.profit ?? 0;
          return sum;
        },
        { KRW: 0, USD: 0 } as Record<Currency, number>,
      ),
    [portfolio.positions],
  );
  const marketPulse = useMemo(() => {
    const topQuotes = quotes.filter((item) => item.isTop);
    const sorted = [...topQuotes].sort(
      (a, b) => b.changePercent - a.changePercent,
    );
    const riser = sorted[0] ?? null;
    const faller = sorted.at(-1) ?? null;
    const average =
      topQuotes.length > 0
        ? topQuotes.reduce((sum, item) => sum + item.changePercent, 0) /
          topQuotes.length
        : 0;
    const risingCount = topQuotes.filter(
      (item) => item.changePercent > 0,
    ).length;
    return {
      average,
      faller,
      risingCount,
      total: topQuotes.length,
      riser,
    };
  }, [quotes]);
  const portfolioCheck = useMemo(() => {
    const invested = {
      KRW: positionValues.KRW,
      USD: positionValues.USD,
    } satisfies Record<Currency, number>;
    const total = {
      KRW: portfolio.cash.KRW + invested.KRW,
      USD: portfolio.cash.USD + invested.USD,
    } satisfies Record<Currency, number>;
    const cashRatio = {
      KRW: total.KRW > 0 ? (portfolio.cash.KRW / total.KRW) * 100 : 100,
      USD: total.USD > 0 ? (portfolio.cash.USD / total.USD) * 100 : 100,
    } satisfies Record<Currency, number>;
    const largest = portfolio.positions.reduce<Position | null>(
      (current, position) =>
        !current || position.marketValue > current.marketValue
          ? position
          : current,
      null,
    );
    const largestTotal = largest ? total[largest.currency] : 0;
    const concentration =
      largest && largestTotal > 0
        ? (largest.marketValue / largestTotal) * 100
        : 0;
    const winners = portfolio.positions.filter(
      (position) => position.profit > 0,
    ).length;
    const losers = portfolio.positions.filter(
      (position) => position.profit < 0,
    ).length;
    const protectedValue = portfolio.protections
      .filter((plan) => plan.status === "ACTIVE")
      .reduce((sum, plan) => {
        const position = portfolio.positions.find(
          (item) =>
            item.symbol === plan.symbol && item.exchange === plan.exchange,
        );
        if (!position) return sum;
        return (
          sum +
          Math.min(plan.quantity, position.quantity) * position.currentPrice
        );
      }, 0);
    const totalInvested = invested.KRW + invested.USD;
    const protectionCoverage =
      totalInvested > 0 ? (protectedValue / totalInvested) * 100 : 0;
    const notices: string[] = [];
    const stressLoss = {
      KRW: invested.KRW * (stressMove / 100),
      USD: invested.USD * (stressMove / 100),
    } satisfies Record<Currency, number>;
    if (!portfolio.authenticated) {
      notices.push("Google로 로그인하면 내 보유 종목 기준 체크업이 표시돼요.");
    } else if (portfolio.positions.length === 0) {
      notices.push("아직 보유 종목이 없어 현금 중심의 안정 상태예요.");
    } else {
      if (concentration >= 55 && largest) {
        notices.push(
          `${largest.name} 비중이 ${concentration.toFixed(0)}%로 높아요.`,
        );
      }
      if (cashRatio.KRW < 8 && cashRatio.USD < 8) {
        notices.push(
          "원화와 달러 현금 비중이 모두 낮아 추가 주문 여력이 작아요.",
        );
      } else if (cashRatio.KRW > 80 && cashRatio.USD > 80) {
        notices.push("현금 비중이 높아 아직 시장 노출이 작은 편이에요.");
      }
      if (losers > winners && losers > 0) {
        notices.push(
          "손실 중인 종목이 더 많아 손절·목표가 알림을 점검해 보세요.",
        );
      }
      if (protectionCoverage < 25) {
        notices.push(
          `익절·손절 보호 범위가 ${protectionCoverage.toFixed(0)}%로 낮아요.`,
        );
      }
      if (!notices.length) {
        notices.push("현금, 보유 비중, 손익 균형이 무난한 상태예요.");
      }
    }
    return {
      cashRatio,
      concentration,
      largest,
      losers,
      notices: notices.slice(0, 3),
      positionCount: portfolio.positions.length,
      protectionCoverage,
      stressLoss,
      winners,
    };
  }, [
    portfolio.authenticated,
    portfolio.cash,
    portfolio.positions,
    portfolio.protections,
    positionValues,
    stressMove,
  ]);

  const rememberStock = useCallback((item: SearchItem) => {
    setRecentStocks((current) => {
      const next = [
        item,
        ...current.filter(
          (entry) =>
            !(
              entry.symbol === item.symbol &&
              entry.exchange === item.exchange &&
              entry.market === item.market
            ),
        ),
      ].slice(0, 6);
      try { localStorage.setItem("stockpilot_recent_stocks", JSON.stringify(next)); } catch { /* Recent items still work in memory. */ }
      return next;
    });
  }, []);

  const loadQuote = useCallback((item: SearchItem) => {
    const key = `${item.market}:${item.exchange}:${item.symbol}`;
    const cached = quoteRequestCache.current.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.request;
    quoteRequestCache.current.delete(key);
    const request = requestJson<Quote>(
      `/api/trading/quote?symbol=${encodeURIComponent(item.symbol)}&market=${item.market}&exchange=${item.exchange}`,
      { cache: "no-store" },
    )
      .then((data) => {
        if (!isValidQuote(data) || data.symbol !== item.symbol || data.market !== item.market || data.exchange !== item.exchange)
          throw new Error("선택한 종목의 시세를 확인하지 못했어요.");
        return data as Quote;
      })
      .catch((error) => {
        quoteRequestCache.current.delete(key);
        throw error;
      });
    quoteRequestCache.current.set(key, {
      expiresAt: Date.now() + 5_000,
      request,
    });
    return request;
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const symbol = params.get("symbol");
    if (
      params.get("view") !== "detail" ||
      !symbol ||
      !/^[A-Z0-9.\-]{1,12}$/i.test(symbol)
    )
      return;
    const market: Market = params.get("market") === "US" ? "US" : "KR";
    const exchange =
      params.get("exchange") || (market === "US" ? "NAS" : "KRX");
    if (!/^[A-Z]{3,8}$/.test(exchange)) return;
    let active = true;
    const request = ++selectionRequest.current;
    void loadQuote({
      id: `${market}:${exchange}:${symbol}`,
      symbol,
      name: symbol,
      englishName: "",
      market,
      exchange,
      currency: market === "US" ? "USD" : "KRW",
    })
      .then((data) => {
        if (active && request === selectionRequest.current) {
          setQuotes((current) => [
            ...current.filter((q) => q.id !== data.id),
            data,
          ]);
          setSelected(data.id);
          setLimitPrice(String(data.price));
          setTriggerPrice(String(data.price));
        }
      })
      .catch(() => {
        if (active)
          notify(
            "이 종목의 시세를 불러오지 못했어요. 검색으로 다시 선택해 주세요.",
          );
      });
    return () => {
      active = false;
    };
  }, [loadQuote, notify]);

  const toggleFavorite = useCallback(
    (item: SearchItem) => {
      const exists = favoriteStocks.some((entry) => entry.id === item.id);
      if (!exists && favoriteStocks.length >= 12) {
        notify("관심종목은 최대 12개까지 저장할 수 있어요. 기존 종목을 해제한 뒤 추가해 주세요.");
        return;
      }
      const next = exists
        ? favoriteStocks.filter((entry) => entry.id !== item.id)
        : [item, ...favoriteStocks].slice(0, 12);
      setFavoriteStocks(next);
      try {
        localStorage.setItem(
          "stockpilot_favorite_stocks_v1",
          JSON.stringify(next),
        );
      } catch {
        // The watchlist still works for this session when storage is unavailable.
      }
      notify(
        exists
          ? `${item.name}을 관심종목에서 제거했어요.`
          : `${item.name}을 관심종목에 추가했어요.`,
      );
    },
    [favoriteStocks, notify],
  );

  function selectTopQuote(item: Quote) {
    selectionRequest.current++;
    setQuantity("1");
    setConfirmingOrder(false);
    setSelected(item.id);
    setLimitPrice(String(item.price));
    setTriggerPrice(String(item.price));
    rememberStock({
      id: item.id,
      symbol: item.symbol,
      name: item.name,
      englishName: "",
      market: item.market,
      currency: item.currency,
      exchange: item.exchange,
      logoUrl: item.logoUrl,
    });
  }

  async function chooseSearchResult(item: SearchItem) {
    const request = ++selectionRequest.current;
    setSearching(true);
    try {
      const data = await loadQuote(item);
      if (request !== selectionRequest.current) return;
      setWorkspaceView("DETAIL");
      const url = new URL(location.href);
      url.searchParams.set("view", "detail");
      url.searchParams.set("symbol", data.symbol);
      url.searchParams.set("market", data.market);
      url.searchParams.set("exchange", data.exchange);
      url.hash = "instrument-workspace";
      history.pushState({ stockpilotView: "DETAIL" }, "", url);
      setQuantity("1");
      setConfirmingOrder(false);
      startTransition(() => {
        setQuotes((current) => [
          ...current.filter((entry) => entry.id !== data.id),
          data,
        ]);
        setSelected(data.id);
      });
      setLimitPrice(String(data.price));
      setTriggerPrice(String(data.price));
      rememberStock({
        id: data.id,
        symbol: data.symbol,
        name: data.name,
        englishName: item.englishName || "",
        market: data.market,
        currency: data.currency,
        exchange: data.exchange,
        logoUrl: data.logoUrl,
      });
      // Open the quote from its beginning; a delayed smooth anchor scroll can
      // slide the heading beneath the sticky header, especially in WebKit.
      requestAnimationFrame(() => window.scrollTo(0, 0));
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
      );
    } finally {
      if (request === selectionRequest.current) setSearching(false);
    }
  }

  async function logout() {
    try {
      await requestJson("/api/auth/logout", { method: "POST", credentials: "include" });
      location.href = "/";
    } catch { notify("로그아웃을 확인하지 못했어요. 연결을 확인하고 다시 시도해 주세요."); }
  }

  async function cancelOrder(orderId: string) {
    if (accountActionLock.current || orderLock.current) return;
    accountActionLock.current = true;
    setBusy(true);
    try {
      await requestJson(`/api/trading/orders/${orderId}`, {
        method: "DELETE",
        credentials: "include",
      });
      notify("대기 중인 지정가 가상주문을 취소했어요.");
      await refreshPortfolio();
    } catch (error) {
      if (!pendingOrder.current) setOrderResult({kind:"error",message:error instanceof ApiRequestError && error.uncertain ? "취소 응답을 확인하지 못했어요. 매매 기록에서 실제 주문 상태를 확인해 주세요." : error instanceof Error ? error.message : "주문 상태를 확인해 주세요."});
      notify(
        error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
      );
    } finally {
      accountActionLock.current = false;
      setBusy(false);
    }
  }

  async function createProtection(event: FormEvent) {
    event.preventDefault();
    if (!portfolio.authenticated || !quote || !activePosition) return;
    if (accountActionLock.current || orderLock.current || pendingOrder.current) return;
    if (accountState !== "ready" || Date.now() - accountLastSuccess.current > 30_000) { notify("잔고를 다시 확인한 뒤 보호 주문을 설정해 주세요."); void refreshPortfolio(); return; }
    const takeProfit = Number(takeProfitPrice);
    const stopLoss = Number(stopLossPrice);
    const protectedQuantity = Number(protectionQuantity);
    if (![protectedQuantity,takeProfit,stopLoss].every(Number.isFinite) || protectedQuantity <= 0 || takeProfit <= 0 || stopLoss <= 0) {
      notify("보호할 수량을 입력해 주세요.");
      return;
    }
    if (
      takeProfit <= quote.price ||
      stopLoss >= quote.price ||
      stopLoss >= takeProfit
    ) {
      notify("익절은 현재가보다 높게, 손절은 현재가보다 낮게 입력해 주세요.");
      return;
    }
    accountActionLock.current = true;
    setBusy(true);
    try {
      await requestJson("/api/trading/protections", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: activeSymbol,
          market: quote.market,
          exchange: quote.exchange,
          quantity: protectedQuantity,
          takeProfitPrice: takeProfit,
          stopLossPrice: stopLoss,
        }),
      });
      notify(
        `${selectedName} ${protectedQuantity}주에 익절·손절 보호를 설정했어요.`,
      );
      setTakeProfitPrice("");
      setStopLossPrice("");
      await refreshPortfolio();
    } catch (error) {
      setOrderResult({kind:"error",message:error instanceof ApiRequestError && error.uncertain ? "보호 설정 응답을 확인하지 못했어요. 해당 종목의 익절·손절 목록을 먼저 확인해 주세요. 자동으로 다시 등록하지 않아요." : error instanceof Error ? error.message : "보호 설정을 확인해 주세요."});
      notify(
        error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
      );
    } finally {
      accountActionLock.current = false;
      setBusy(false);
    }
  }

  async function cancelProtection(planId: string) {
    if (accountActionLock.current || orderLock.current) return;
    accountActionLock.current = true;
    setBusy(true);
    try {
      await requestJson(`/api/trading/protections/${planId}`, {
        method: "DELETE",
        credentials: "include",
      });
      notify("익절·손절 보호 설정을 취소했어요.");
      await refreshPortfolio();
    } catch (error) {
      if (!pendingOrder.current) setOrderResult({kind:"error",message:error instanceof ApiRequestError && error.uncertain ? "보호 설정 취소 응답을 확인하지 못했어요. 해당 종목의 익절·손절 목록에서 상태를 확인해 주세요." : error instanceof Error ? error.message : "보호 설정을 확인해 주세요."});
      notify(
        error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
      );
    } finally {
      accountActionLock.current = false;
      setBusy(false);
    }
  }

  function setQuickQuantity(percent: number) {
    const maximum =
      side === "SELL" && portfolio.authenticated
        ? availableSellQuantity
        : maxBuyQuantity;
    const next =
      percent === 100 ? maximum : Math.floor(maximum * (percent / 100));
    setQuantity(String(Math.max(1, next)));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!portfolio.authenticated) {
      location.href = `/api/auth/google/login?return_to=${encodeURIComponent(location.pathname + location.search)}`;
      return;
    }
    if (pendingOrder.current) { notify("이전 주문의 처리 결과를 먼저 확인해 주세요."); return; }
    if (accountState !== "ready" || Date.now() - accountLastSuccess.current > 30_000) { notify("잔고를 다시 확인한 뒤 주문해 주세요."); void refreshPortfolio(); return; }
    if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) {
      notify("주문 수량을 1주 이상 입력해 주세요.");
      return;
    }
    if (sellIssue) {
      notify(sellIssue);
      return;
    }
    setOrderSafetyChecks({
      simulation: false,
      quote: false,
      amount: false,
      inventory: side === "SELL" ? false : true,
    });
    setConfirmingOrder(true);
  }

  function clearPendingOrder() {
    pendingOrder.current = null;
    setPendingRetryAvailable(false);
    try { sessionStorage.removeItem("stockpilot_pending_order_v1"); } catch { /* Storage is optional. */ }
  }

  function showReceipt(data: OrderReceipt, name: string) {
    const message = data.status === "FILLED"
      ? `${name} 모의주문이 ${money(data.fillPrice!,data.currency)}에 체결됐어요.`
      : data.status === "OPEN" ? `${name} 모의주문을 접수했어요. 아직 체결되지 않은 대기 주문이에요.`
      : data.status === "REJECTED" ? data.detail || "주문이 거절됐어요. 매매 기록에서 사유를 확인해 주세요."
      : "주문이 취소됐어요.";
    clearPendingOrder();
    setOrderResult({kind:data.status === "REJECTED" ? "error" : "success",message,id:data.id});
    notify(message);
    void refreshPortfolio();
  }

  async function checkPendingOrder() {
    const pending = pendingOrder.current;
    if (!pending || orderLock.current) return;
    orderLock.current = true;
    setCheckingOrder(true);
    try {
      const data = await requestJson<unknown>(`/api/trading/orders/request/${encodeURIComponent(pending.key)}`,{credentials:"include",cache:"no-store"});
      if (!isOrderReceipt(data)) throw new Error("처리 결과 형식 확인 실패");
      showReceipt(data,pending.name);
    } catch (error) {
      setOrderResult({kind:"uncertain",message:error instanceof ApiRequestError && error.status === 404
        ? "아직 저장된 결과가 없어요. 처리 중일 수 있으니 잠시 후 다시 조회해 주세요."
        : "주문 결과를 확인하지 못했어요. 연결을 확인하고 다시 조회해 주세요. 새 주문은 자동으로 보내지 않아요."});
    } finally { orderLock.current = false; setCheckingOrder(false); }
  }

  async function placeOrder(retry = false) {
    if (orderLock.current || accountActionLock.current) return;
    if (!portfolio.authenticated) { notify("로그인을 확인한 뒤 주문해 주세요."); return; }
    if (!retry && !orderSafetyReady) {
      notify("주문 전 확인 항목을 모두 체크해 주세요.");
      return;
    }
    if (accountState !== "ready" || Date.now() - accountLastSuccess.current > 30_000) { notify("잔고를 다시 확인한 뒤 주문해 주세요."); void refreshPortfolio(); return; }
    if (retry && (!pendingOrder.current?.body || pendingOrder.current.owner && pendingOrder.current.owner !== me?.coders_id)) return;
    if (!retry && (pendingOrder.current || !quote)) return;
    const attempt = retry ? pendingOrder.current! : {
      key:crypto.randomUUID(),name:selectedName,owner:me?.coders_id || null,
      body:JSON.stringify({symbol:activeSymbol,market:quote!.market,exchange:quote!.exchange,side,orderType:kind,quantity:Number(quantity),limitPrice:["LIMIT","STOP_LIMIT"].includes(kind)?Number(limitPrice):null,triggerPrice:["STOP","STOP_LIMIT"].includes(kind)?Number(triggerPrice):null}),
    };
    pendingOrder.current = attempt;
    setPendingRetryAvailable(true);
    try { if (attempt.owner) sessionStorage.setItem("stockpilot_pending_order_v1",JSON.stringify({key:attempt.key,owner:attempt.owner})); } catch { /* Query recovery remains available in this tab. */ }
    orderLock.current = true;
    setBusy(true);
    setCheckingOrder(true);
    try {
      // A manual retry uses the original frozen payload AND the original key.
      // Reconnection and background polling only read; they never resend.
      const data = await requestJson<unknown>("/api/trading/orders", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": attempt.key,
        },
        body: attempt.body,
      },20_000);
      if (!isOrderReceipt(data)) throw new ApiRequestError("주문 응답을 확인하지 못했어요.",200,true);
      showReceipt(data,attempt.name);
    } catch (error) {
      if (error instanceof ApiRequestError && isOrderReceipt(error.payload)) showReceipt(error.payload,attempt.name);
      else if (error instanceof ApiRequestError && !error.uncertain) {
        clearPendingOrder();
        setOrderResult({kind:"error",message:error.message});
      } else setOrderResult({kind:"uncertain",message:"주문 응답을 확인하지 못했어요. 접수됐을 수도 있으니 처리 결과를 먼저 조회해 주세요. 같은 주문을 자동으로 다시 보내지 않아요."});
    } finally {
      orderLock.current = false;
      setBusy(false);
      setCheckingOrder(false);
      setConfirmingOrder(false);
      setMobileOrderOpen(false);
      requestAnimationFrame(() => window.scrollTo({top:0,behavior:"auto"}));
    }
  }

  return (
    <main
      className={`app workspace-app consumer-app view-${workspaceView.toLowerCase()}${mobileOrderOpen ? " mobile-order-open" : ""}`}
    >
      <a className="skip-link" href="#market-content">
        본문으로 건너뛰기
      </a>
      <header className="topbar">
        <Link className="brand" href="/">
          <span>
            <BarChart3 size={18} />
          </span>
          StockPilot<small>투자 연습의 기록</small>
        </Link>
        <nav className="workspace-primary" aria-label="주요 메뉴">
          <a
            href="#market-rankings"
            aria-current={workspaceView === "MARKET" ? "page" : undefined}
          >
            시장
          </a>
          <a
            href="#favorite-board-title"
            aria-current={workspaceView === "WATCH" ? "page" : undefined}
          >
            관심종목
          </a>
          <a
            href="#holdings"
            aria-current={workspaceView === "ASSETS" ? "page" : undefined}
          >
            내 자산
          </a>
          <a
            href="#decision-review"
            aria-current={workspaceView === "RECORDS" ? "page" : undefined}
          >
            매매 기록
          </a>
          <a href="/practice">투자 연습</a>
        </nav>
        <div className="top-actions">
          <CommandSearch onChoose={chooseSearchResult} />
          <WorkspaceControls />
          <button
            type="button"
            className="help-button"
            aria-label="처음 이용 안내"
            title="처음 이용 안내"
            onClick={() => setGuideOpen(true)}
          >
            <HelpCircle size={19} />
          </button>
          <button
            type="button"
            className="top-search"
            aria-label="종목 검색"
            aria-keyshortcuts="/"
            title="종목 검색 (/)"
            onClick={focusSearch}
          >
            <Search size={19} />
          </button>
          <button
            className="alert-button"
            aria-label={
              unreadAlerts ? `읽지 않은 알림 ${unreadAlerts}개` : "알림"
            }
            onClick={() => {
              setWorkspaceView("DETAIL");
              setDetailTab("TOOLS");
              setAlertFocusKey((value) => value + 1);
            }}
          >
            <Bell size={19} />
            {unreadAlerts > 0 && (
              <span className="alert-count">
                {unreadAlerts > 99 ? "99+" : unreadAlerts}
              </span>
            )}
          </button>
          {portfolio.authenticated ? (
            <button className="user-chip" onClick={logout} title="로그아웃">
              {me?.picture ? (
                <span
                  className="avatar profile-photo"
                  style={{ backgroundImage: `url("${me.picture}")` }}
                />
              ) : (
                <span className="avatar">{me?.display_name?.[0] || "G"}</span>
              )}
              <span>{me?.display_name || "내 계정"}</span>
              <LogOut size={14} />
            </button>
          ) : (
            <a className="login" href="/api/auth/google/login?return_to=%2F">
              <LogIn size={16} /> Google로 로그인
            </a>
          )}
        </div>
      </header>

      <section className="workspace-intro" id="market-content" tabIndex={-1}>
        <div>
          <span className="workspace-eyebrow">
            STOCKPILOT · 투자 연습
          </span>
          <h1>
            {
              {
                MARKET: "시장 홈",
                DETAIL: "종목 상세",
                WATCH: "관심종목",
                ASSETS: "내 자산",
                RECORDS: "투자 기록",
              }[workspaceView]
            }
          </h1>
        </div>
        <div className="workspace-context">
          <span>실제 시세 · 모의투자</span>
          <small>
            {socketConnected && status?.connected
              ? "시세 수신 연결됨"
              : "시세 수신 확인 중"}
          </small>
        </div>
      </section>
      {accountState !== "ready" ? <section className={`release-account-status is-${accountState}`} aria-label="잔고 조회 상태">
        <div><b>{accountState === "loading" ? "계좌를 확인하고 있어요" : "잔고를 다시 확인해 주세요"}</b><p>{accountState === "loading" ? "최신 잔고를 받은 뒤 주문할 수 있어요." : accountUpdatedAt ? "마지막으로 받은 잔고를 유지하고 있어요. 다시 확인하기 전에는 새 주문을 보내지 않아요." : "아직 계좌 잔고를 확인하지 못했어요. 새 주문을 보내기 전에 다시 확인해 주세요."}</p>{accountUpdatedAt ? <small>마지막 확인 · {new Date(accountUpdatedAt).toLocaleTimeString("ko-KR")}</small> : null}</div>
        <button type="button" disabled={accountRefreshing} onClick={() => void refreshPortfolio()}><RefreshCw size={16} className={accountRefreshing ? "spin" : ""}/>{accountRefreshing ? "확인 중" : "잔고 다시 확인"}</button>
      </section> : null}
      {orderResult ? <OrderResult result={orderResult} checking={checkingOrder} onCheck={() => void checkPendingOrder()} onRetry={() => void placeOrder(true)} retryAvailable={pendingRetryAvailable} onDismiss={() => {
        if (window.confirm("결과가 확인되지 않은 주문은 취소되지 않아요. 매매 기록을 확인했으며 새 주문을 준비할까요?")) { clearPendingOrder(); setOrderResult(null); }
      }}/> : null}
      {workspaceView === "DETAIL" ? (
        <button type="button" className="back-to-market" onClick={showMarket}>
          ← 시장으로 돌아가기
        </button>
      ) : null}
      <section
        className="summary workspace-summary"
        id="market-overview"
        aria-label="시장과 내 투자 요약"
      >
        <article className="balance-card">
          <div className="card-title">
            <span>
              {portfolio.authenticated ? "내 모의투자 자산" : "시작 연습 자금"}
            </span>
            <small>원화 평가액 · 달러 별도</small>
          </div>
          <strong className="private-value">
            {money(portfolio.cash.KRW + positionValues.KRW, "KRW")}
          </strong>
          <div className="balance-detail">
            <span>
              원화 주문 가능{" "}
              <b className="private-value">
                {money(portfolio.cash.KRW, "KRW")}
              </b>
            </span>
            <span>
              달러 주문 가능{" "}
              <b className="private-value">
                {money(portfolio.cash.USD, "USD")}
              </b>
            </span>
            <span>
              국내 평가손익{" "}
              <b
                className={`private-value ${performance.KRW >= 0 ? "up" : "down"}`}
              >
                {money(performance.KRW, "KRW")}
              </b>
            </span>
            <span>
              미국 평가손익{" "}
              <b
                className={`private-value ${performance.USD >= 0 ? "up" : "down"}`}
              >
                {money(performance.USD, "USD")}
              </b>
            </span>
          </div>
        </article>
        <div id="market-indices" className="workspace-index">
          <MarketIndexChart initialData={bootstrapKospi} />
        </div>
      </section>

      <details className="advanced-checkup">
        <summary>
          <span>
            <Gauge size={17} />
            <b>고급 투자 체크업</b>
            <small>시장 강도·포트폴리오 집중도·급락 스트레스 테스트</small>
          </span>
          <ChevronRight size={18} />
        </summary>
        <section className="insight-grid" aria-label="시장과 내 투자 체크업">
          <article className="pulse-card">
            <div className="insight-title">
              <span>
                <BarChart3 size={16} /> 오늘의 시장 요약
              </span>
              <small>
                {marketPulse.total
                  ? `${marketPulse.total}개 주요 종목 기준`
                  : "시세 수신 대기"}
              </small>
            </div>
            <strong className={marketPulse.average >= 0 ? "up" : "down"}>
              {percentText(marketPulse.average)}
            </strong>
            <p>
              주요 종목 중 {marketPulse.risingCount}개가 상승 중이에요.
              {marketPulse.riser && marketPulse.faller
                ? ` 강한 종목은 ${marketPulse.riser.name}, 약한 종목은 ${marketPulse.faller.name}입니다.`
                : " 시세가 들어오면 상승·하락 종목을 자동으로 요약해요."}
            </p>
            <div className="pulse-movers">
              <span>
                <small>상승 선두</small>
                <b>{marketPulse.riser ? marketPulse.riser.name : "—"}</b>
                <em className="up">
                  {marketPulse.riser
                    ? percentText(marketPulse.riser.changePercent)
                    : "—"}
                </em>
              </span>
              <span>
                <small>하락 선두</small>
                <b>{marketPulse.faller ? marketPulse.faller.name : "—"}</b>
                <em className="down">
                  {marketPulse.faller
                    ? percentText(marketPulse.faller.changePercent)
                    : "—"}
                </em>
              </span>
            </div>
          </article>

          <article className="checkup-card">
            <div className="insight-title">
              <span>
                <Gauge size={16} /> 내 투자 체크업
              </span>
              <small>{portfolioCheck.positionCount}개 보유 종목</small>
            </div>
            <div className="checkup-metrics">
              <span>
                <small>원화 현금</small>
                <b>{portfolioCheck.cashRatio.KRW.toFixed(0)}%</b>
              </span>
              <span>
                <small>달러 현금</small>
                <b>{portfolioCheck.cashRatio.USD.toFixed(0)}%</b>
              </span>
              <span>
                <small>최대 비중</small>
                <b>{portfolioCheck.concentration.toFixed(0)}%</b>
              </span>
              <span>
                <small>손익 종목</small>
                <b>
                  {portfolioCheck.winners}/{portfolioCheck.losers}
                </b>
              </span>
              <span>
                <small>보호 범위</small>
                <b>{portfolioCheck.protectionCoverage.toFixed(0)}%</b>
              </span>
            </div>
            <div className="checkup-advice">
              <PieChart size={16} />
              <div>
                {portfolioCheck.notices.map((notice) => (
                  <p key={notice}>{notice}</p>
                ))}
              </div>
            </div>
            <div className="stress-test">
              <div className="stress-head">
                <span>
                  <BrainCircuit size={15} /> 급락 스트레스 테스트
                </span>
                <div>
                  {[-1, -3, -5, -10].map((move) => (
                    <button
                      className={stressMove === move ? "active" : ""}
                      key={move}
                      onClick={() => setStressMove(move)}
                      type="button"
                    >
                      {move}%
                    </button>
                  ))}
                </div>
              </div>
              <div className="stress-result">
                <span>
                  <small>국내 보유분 예상 변동</small>
                  <b>{money(portfolioCheck.stressLoss.KRW, "KRW")}</b>
                </span>
                <span>
                  <small>미국 보유분 예상 변동</small>
                  <b>{money(portfolioCheck.stressLoss.USD, "USD")}</b>
                </span>
              </div>
              <p>
                모든 보유 종목이 같은 폭으로 움직인 단순 가정이며, 실제 손실
                예측이나 투자 조언이 아닙니다.
              </p>
            </div>
          </article>
        </section>
      </details>

      <section className="content" id="market-rankings">
        <div className="market-column instrument-browser">
          <div className="section-head representative-heading">
            <div>
              <h2>주요 종목</h2>
              <p>대표 종목 · 거래소 전체 종목도 확인할 수 있어요</p>
            </div>
            <span className={`source market-freshness ${quoteFreshness.state}`}>
              <i aria-hidden="true" />
              <span>
                {quote?.source || "KIS 연결 중"}
                <small>{quoteFreshness.label}</small>
              </span>
            </span>
          </div>
          {(
            [
              ["한국", krTop],
              ["미국", usTop],
            ] as const
          ).map(([label, items]) => (
            <div
              className="market-block representative-list"
              id={label === "한국" ? "kr-top" : "us-top"}
              key={label}
            >
              <div className="market-label">
                <b>{label} 주식</b>
                <span>대표 {items.length}종목</span>
              </div>
              <div className="watchlist">
                {items.length === 0 ? (
                  <div className="quote-empty" role="status" aria-live="polite">
                    <RefreshCw
                      className="quote-empty-icon spin"
                      size={18}
                      aria-hidden="true"
                    />
                    <span>
                      <b>{label} 시세를 불러오는 중이에요</b>
                      <small>거래소 연결이 완료되면 TOP 10이 표시됩니다.</small>
                    </span>
                  </div>
                ) : (
                  items.map((item) => (
                    <button
                      className={`quote ${selected === item.id ? "active" : ""}`}
                      key={item.id}
                      onClick={() => selectTopQuote(item)}
                    >
                      <StockLogo
                        symbol={item.symbol}
                        name={item.name}
                        color={colorFor(item.symbol)}
                        logoUrl={item.logoUrl}
                      />
                      <span className="company">
                        <b>{item.name}</b>
                        <small>
                          {item.symbol} · {item.exchange}
                        </small>
                      </span>
                      <span className="quote-price">
                        <b>{money(item.price, item.currency)}</b>
                        <small
                          className={item.changePercent >= 0 ? "up" : "down"}
                        >
                          {item.changePercent >= 0 ? "+" : ""}
                          {item.changePercent.toFixed(2)}%
                        </small>
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          ))}

          <RankedMarketBrowser
            selectedId={selected}
            onSelect={chooseSearchResult}
            savedIds={favoriteIds}
            onSave={toggleFavorite}
          />
          <FullMarketCatalog
            selectedId={selected}
            savedIds={favoriteIds}
            onSelect={chooseSearchResult}
            onSave={toggleFavorite}
          />
          <div
            className="search-card"
            id="search-card"
            data-query={Boolean(searchQuery.trim())}
          >
            <div className="section-head">
              <div>
                <h2>주식 둘러보기</h2>
                <p>
                  회사명 · 코드 · 티커 <kbd>/</kbd>
                </p>
              </div>
            </div>
            <div className="search-controls">
              <div className="search-input">
                <Search size={18} />
                <input
                  ref={searchInputRef}
                  aria-label="종목명·종목코드·티커 검색"
                  aria-controls="search-results"
                  value={searchQuery}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      document
                        .querySelector<HTMLButtonElement>(
                          ".search-results button",
                        )
                        ?.focus();
                    }
                    if (event.key === "Enter" && searchResults[0]) {
                      event.preventDefault();
                      void chooseSearchResult(searchResults[0]);
                    }
                    if (event.key === "Escape") {
                      setSearchQuery("");
                      setSearchResults([]);
                      setSearching(false);
                    }
                  }}
                  onChange={(event) => {
                    const value = event.target.value;
                    setSearchQuery(value);
                    if (value.trim()) {
                      setSearching(true);
                    } else {
                      setSearchResults([]);
                      setSearching(false);
                    }
                  }}
                  placeholder="회사명 · 종목코드 · 티커 검색"
                />
              </div>
              <div className="search-market">
                {(["ALL", "KR", "US"] as const).map((item) => (
                  <button
                    type="button"
                    key={item}
                    className={searchMarket === item ? "active" : ""}
                    aria-pressed={searchMarket === item}
                    onClick={() => {
                      setSearchMarket(item);
                      if (searchQuery.trim()) setSearching(true);
                    }}
                  >
                    {item === "ALL" ? "전체" : item === "KR" ? "한국" : "미국"}
                  </button>
                ))}
              </div>
            </div>
            {searchQuery && (
              <div
                className="search-results"
                id="search-results"
                aria-busy={searching}
              >
                {searching ? (
                  <p className="search-state" role="status" aria-live="polite">
                    <RefreshCw className="spin" size={16} /> 종목을 찾고 있어요
                  </p>
                ) : searchResults.length ? (
                  searchResults.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      onPointerEnter={() =>
                        void loadQuote(item).catch(() => undefined)
                      }
                      onFocus={() =>
                        void loadQuote(item).catch(() => undefined)
                      }
                      onClick={() => chooseSearchResult(item)}
                    >
                      <StockLogo
                        symbol={item.symbol}
                        name={item.name}
                        color={colorFor(item.symbol)}
                        logoUrl={item.logoUrl}
                      />
                      <span>
                        <b>{item.name}</b>
                        <small>{item.englishName || item.symbol}</small>
                      </span>
                      <span>
                        <b>{item.symbol}</b>
                        <small>
                          {item.market === "KR" ? "한국" : "미국"} ·{" "}
                          {item.exchange}
                        </small>
                      </span>
                      <ChevronRight size={17} />
                    </button>
                  ))
                ) : (
                  <p
                    className="search-state"
                    role={searchFailed ? "alert" : "status"}
                  >
                    {searchFailed
                      ? "검색을 불러오지 못했어요. 검색어를 다시 입력해 주세요."
                      : "일치하는 종목이 없어요."}
                  </p>
                )}
              </div>
            )}
            {!searchQuery && recentStocks.length > 0 && (
              <div className="recent-stocks">
                <span>
                  <History size={14} /> 최근 본 종목
                </span>
                <div>
                  {recentStocks.map((item) => (
                    <button
                      type="button"
                      key={`${item.market}:${item.exchange}:${item.symbol}`}
                      onPointerEnter={() =>
                        void loadQuote(item).catch(() => undefined)
                      }
                      onFocus={() =>
                        void loadQuote(item).catch(() => undefined)
                      }
                      onClick={() => void chooseSearchResult(item)}
                    >
                      <StockLogo
                        symbol={item.symbol}
                        name={item.name}
                        color={colorFor(item.symbol)}
                        logoUrl={item.logoUrl}
                      />
                      <span>
                        <b>{item.name}</b>
                        <small>{item.symbol}</small>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        {workspaceView === "MARKET" || workspaceView === "WATCH" ? (
          <aside className="consumer-personal">
            <MarketWatchlist
              items={favoriteItems}
              selectedId={selected}
              colorFor={colorFor}
              onSelect={(item) => {
                void chooseSearchResult({ ...item, englishName: "" });
              }}
              onRemove={(item) => toggleFavorite({ ...item, englishName: "" })}
            />
            <section className="continue-section">
              <span className="workspace-eyebrow">투자 연습 이어하기</span>
              <h2>관찰에서 판단으로</h2>
              <p>가격을 확인하고, 나만의 이유를 남겨보세요.</p>
              {quote ? (
                <button
                  type="button"
                  className="continue-stock"
                  onClick={() =>
                    void chooseSearchResult({ ...quote, englishName: "" })
                  }
                >
                  <StockLogo
                    symbol={quote.symbol}
                    name={quote.name}
                    color="#18c899"
                    logoUrl={quote.logoUrl}
                  />
                  <span>
                    <b>{quote.name}</b>
                    <small>{money(quote.price, quote.currency)}</small>
                  </span>
                  <ArrowUpRight size={18} />
                </button>
              ) : (
                <p>종목을 선택하면 이어서 살펴볼 수 있어요.</p>
              )}
            </section>
            <section className="practice-discovery">
              <div>
                <GraduationCap size={22} />
                <span>처음이라면</span>
              </div>
              <h2>처음이라도 괜찮아요</h2>
              <p>기초를 배우고 연습으로 확인해요.</p>
              <a href="/learn">
                주식의 기초부터 <ArrowUpRight size={17} />
              </a>
            </section>
          </aside>
        ) : null}
        <div className="analysis-column" id="instrument-workspace">
          <header className="instrument-heading">
            <div className="instrument-identity">
              <StockLogo
                symbol={activeSymbol}
                name={selectedName}
                color={colorFor(activeSymbol)}
                logoUrl={quote?.logoUrl}
                large
              />
              <div>
                <span className="workspace-eyebrow">
                  {activeSymbol} · {quote?.exchange || "—"} ·{" "}
                  {quote?.currency || "—"}
                </span>
                <h2>{selectedName}</h2>
              </div>
            </div>
            <div className="instrument-quote">
              <strong>
                {quote ? money(quote.price, quote.currency) : "—"}
              </strong>
              <span
                className={(quote?.changePercent ?? 0) >= 0 ? "up" : "down"}
              >
                {quote
                  ? `${percentText(quote.changePercent)} · 전일 대비`
                  : "시세 확인 중"}
              </span>
            </div>
            <div className="instrument-meta">
              <span>{quoteFreshness.label}</span>
              <span>
                {quote?.asOf
                  ? new Date(quote.asOf).toLocaleString("ko-KR")
                  : "조회 시간 확인 중"}
              </span>
            </div>
            <div className="instrument-actions">
              <button
                type="button"
                disabled={!quote}
                aria-pressed={quote ? favoriteIds.has(quote.id) : false}
                onClick={() =>
                  quote && toggleFavorite({ ...quote, englishName: "" })
                }
              >
                <Star
                  size={17}
                  fill={
                    quote && favoriteIds.has(quote.id) ? "currentColor" : "none"
                  }
                />
                {quote && favoriteIds.has(quote.id)
                  ? "관심종목 저장됨"
                  : "관심종목 저장"}
              </button>
              <button
                type="button"
                disabled={!quote}
                onClick={() => {
                  setDetailTab("TOOLS");
                  setAlertFocusKey((value) => value + 1);
                }}
              >
                <Bell size={17} />
                가격 알림
              </button>
            </div>
          </header>
          <DeferredMount minHeight={390} rootMargin="420px 0px">
            <StockTrendPanel
              symbol={activeSymbol}
              name={selectedName}
              market={quote?.market ?? "KR"}
              exchange={quote?.exchange ?? "KRX"}
              currency={quote?.currency ?? "KRW"}
            />
          </DeferredMount>

          <nav className="workspace-detail-tabs" aria-label="종목 상세 보기">
            {[
              { id: "RESEARCH", name: "기업·공시" },
              { id: "TOOLS", name: "뉴스·알림" },
              { id: "REVIEW", name: "판단 기록" },
              { id: "REPLAY", name: "과거 연습" },
            ].map((tab) => (
              <button
                type="button"
                key={tab.id}
                className={detailTab === tab.id ? "active" : ""}
                aria-pressed={detailTab === tab.id}
                onClick={() => setDetailTab(tab.id)}
              >
                {tab.name}
              </button>
            ))}
          </nav>
          {detailTab === "REPLAY" ? (
            <DeferredMount minHeight={160} rootMargin="320px 0px">
              <MarketReplayStudio
                symbol={activeSymbol}
                name={selectedName}
                market={quote?.market ?? "KR"}
                exchange={quote?.exchange ?? "KRX"}
                currency={quote?.currency ?? "KRW"}
              />
            </DeferredMount>
          ) : null}

          {detailTab === "RESEARCH" ? (
            <div id="news-panel" className="market-anchor-section">
              <DeferredMount minHeight={320} rootMargin="320px 0px">
                <CompanyInsight
                  symbol={activeSymbol}
                  market={quote?.market ?? "KR"}
                />
              </DeferredMount>
            </div>
          ) : null}

          {detailTab === "RESEARCH" ? <AdSlot placement="market-news" /> : null}

          {detailTab === "TOOLS" ? (
            <DeferredMount minHeight={420} rootMargin="320px 0px">
              <InvestorTools
                authenticated={portfolio.authenticated}
                selected={
                  quote
                    ? {
                        symbol: quote.symbol,
                        name: quote.name,
                        market: quote.market,
                        currency: quote.currency,
                        exchange: quote.exchange,
                        price: quote.price,
                      }
                    : null
                }
                onSelect={(item) =>
                  chooseSearchResult({
                    id: `${item.market}:${item.exchange}:${item.symbol}`,
                    symbol: item.symbol,
                    name: item.name,
                    englishName: "",
                    market: item.market,
                    currency: item.currency,
                    exchange: item.exchange,
                  })
                }
                onNotice={notify}
                onAlertSummary={({ unread }) => setUnreadAlerts(unread)}
                focusAlertsKey={alertFocusKey}
              />
            </DeferredMount>
          ) : null}
          <div id="decision-review">
            {workspaceView === "RECORDS" ? (
              <OrderTimeline orders={portfolio.orders} />
            ) : null}
            {detailTab === "REVIEW" ? (
              <DecisionNotebook
                key={`${quote?.exchange}:${activeSymbol}`}
                symbol={activeSymbol}
                exchange={quote?.exchange || "KRX"}
                orders={portfolio.orders}
              />
            ) : (
              <button
                className="review-link"
                type="button"
                onClick={() => setDetailTab("REVIEW")}
              >
                <BookOpen size={17} /> 이 종목의 판단과 주문 기록 보기{" "}
                <ChevronRight size={17} />
              </button>
            )}
          </div>

          <div className="portfolio-panel" id="holdings">
            <div className="section-head">
              <div>
                <h2>보유 주식</h2>
                <p>
                  {portfolio.authenticated
                    ? "사용자별 가상계좌에 저장돼요"
                    : "로그인하면 투자 기록이 저장돼요"}
                </p>
              </div>
            </div>
            {portfolio.positions.length ? (
              portfolio.positions.map((position) => {
                const price =
                  position.currentPrice ??
                  quotes.find(
                    (item) =>
                      item.symbol === position.symbol &&
                      item.exchange === position.exchange,
                  )?.price ??
                  position.averagePrice;
                const profit =
                  position.profit ??
                  (price - position.averagePrice) * position.quantity;
                return (
                  <div
                    className="holding"
                    key={`${position.exchange}:${position.symbol}`}
                  >
                    <StockLogo
                      symbol={position.symbol}
                      name={position.name}
                      color={colorFor(position.symbol)}
                      logoUrl={position.logoUrl}
                    />
                    <span>
                      <b>{position.name}</b>
                      <small>
                        {position.quantity}주 · 평균{" "}
                        {money(position.averagePrice, position.currency)}
                      </small>
                    </span>
                    <span className="private-value">
                      <b>
                        {money(price * position.quantity, position.currency)}
                      </b>
                      <small className={profit >= 0 ? "up" : "down"}>
                        {profit >= 0 ? "+" : ""}
                        {money(profit, position.currency)} ·{" "}
                        {(position.returnRate ?? 0).toFixed(2)}%
                      </small>
                    </span>
                  </div>
                );
              })
            ) : (
              <div className="empty">
                <span>🌱</span>
                <b>아직 보유한 주식이 없어요</b>
                <p>실제 시세로 첫 가상주문을 시작해 보세요.</p>
              </div>
            )}
          </div>
        </div>

        {mobileOrderOpen ? (
          <button
            type="button"
            className="ticket-backdrop"
            aria-label="모의주문 닫기"
            onClick={closeMobileOrder}
          />
        ) : null}
        <aside
          className="order-card"
          id="order-ticket"
          role={mobileOrderOpen ? "dialog" : undefined}
          aria-modal={mobileOrderOpen || undefined}
          aria-label="모의 주문"
        >
          <div className="ticket-title">
            <span>모의 주문</span>
            <button
              type="button"
              onClick={closeMobileOrder}
              aria-label="모의주문 닫기"
            >
              <X size={20} />
            </button>
          </div>
          <div className="order-stock">
            <StockLogo
              symbol={activeSymbol}
              name={selectedName}
              color={colorFor(activeSymbol)}
              logoUrl={quote?.logoUrl}
              large
            />
            <div>
              <h2>{selectedName}</h2>
              <p>
                {activeSymbol} ·{" "}
                {quote?.market === "KR"
                  ? "KRX+NXT 통합"
                  : (quote?.exchange ?? "KIS")}
              </p>
            </div>
            <span className="current">
              <b>{quote ? money(quote.price, quote.currency) : "—"}</b>
              <small
                className={(quote?.changePercent ?? 0) >= 0 ? "up" : "down"}
              >
                {quote
                  ? `${quote.changePercent >= 0 ? "+" : ""}${quote.changePercent.toFixed(2)}%`
                  : ""}
              </small>
            </span>
            <button
              className={`favorite-selected${quote && favoriteIds.has(quote.id) ? " active" : ""}`}
              type="button"
              disabled={!quote}
              aria-pressed={quote ? favoriteIds.has(quote.id) : false}
              aria-label={
                quote && favoriteIds.has(quote.id)
                  ? `${selectedName} 관심종목 제거`
                  : `${selectedName} 관심종목 추가`
              }
              title={
                quote && favoriteIds.has(quote.id)
                  ? "관심종목에서 제거"
                  : "관심종목에 추가"
              }
              onClick={() =>
                quote &&
                toggleFavorite({
                  id: quote.id,
                  symbol: quote.symbol,
                  name: quote.name,
                  englishName: "",
                  market: quote.market,
                  currency: quote.currency,
                  exchange: quote.exchange,
                  logoUrl: quote.logoUrl,
                })
              }
            >
              <Star
                size={17}
                fill={
                  quote && favoriteIds.has(quote.id) ? "currentColor" : "none"
                }
              />
            </button>
          </div>
          <div className="side-tabs">
            <button
              className={side === "BUY" ? "buy active" : ""}
              onClick={() => setSide("BUY")}
            >
              <ArrowDownLeft size={16} /> 매수
            </button>
            <button
              className={side === "SELL" ? "sell active" : ""}
              onClick={() => {
                setSide("SELL");
                if (portfolio.authenticated && !activePosition) {
                  notify(
                    `${selectedName}은 현재 보유하고 있지 않아 매도할 수 없어요.`,
                  );
                }
              }}
            >
              <ArrowUpRight size={16} /> 매도
            </button>
          </div>
          <form onSubmit={submit}>
            {side === "SELL" && portfolio.authenticated && (
              <div
                className={`sell-availability ${sellIssue ? "warning" : ""}`}
                role="status"
              >
                <span>
                  <b>
                    매도 가능 {availableSellQuantity.toLocaleString("ko-KR")}주
                  </b>
                  <small>
                    보유{" "}
                    {(activePosition?.quantity ?? 0).toLocaleString("ko-KR")}주
                    {pendingSellQuantity > 0
                      ? ` · 대기 주문 ${pendingSellQuantity.toLocaleString("ko-KR")}주`
                      : ""}
                  </small>
                </span>
                {availableSellQuantity > 0 && (
                  <button
                    type="button"
                    onClick={() => setQuantity(String(availableSellQuantity))}
                  >
                    전량
                  </button>
                )}
              </div>
            )}
            <label>
              가상주문 방식
              <select
                value={kind}
                onChange={(event) =>
                  setKind(
                    event.target.value as
                      | "MARKET"
                      | "LIMIT"
                      | "STOP"
                      | "STOP_LIMIT",
                  )
                }
              >
                <option value="MARKET">시장가</option>
                <option value="LIMIT">지정가</option>
                <option value="STOP">손절·돌파 주문</option>
                <option value="STOP_LIMIT">조건부 지정가</option>
              </select>
            </label>
            {["STOP", "STOP_LIMIT"].includes(kind) && (
              <label>
                감시 가격
                <div className="input-money">
                  <span>{quote?.currency === "KRW" ? "₩" : "$"}</span>
                  <input
                    required
                    type="number"
                    min="0.01"
                    step={quote?.currency === "KRW" ? "1" : "0.01"}
                    value={triggerPrice}
                    onChange={(event) => setTriggerPrice(event.target.value)}
                  />
                </div>
                <small className="order-help">
                  {side === "SELL"
                    ? "현재가가 감시 가격 이하가 되면 주문해요."
                    : "현재가가 감시 가격 이상이 되면 주문해요."}
                </small>
              </label>
            )}
            {["LIMIT", "STOP_LIMIT"].includes(kind) && (
              <label>
                희망 가격
                <div className="input-money">
                  <span>{quote?.currency === "KRW" ? "₩" : "$"}</span>
                  <input
                    required
                    type="number"
                    min="0.01"
                    step={quote?.currency === "KRW" ? "1" : "0.01"}
                    value={limitPrice}
                    onChange={(event) => setLimitPrice(event.target.value)}
                  />
                </div>
              </label>
            )}
            <label>
              수량
              <div className="stepper">
                <button
                  type="button"
                  onClick={() =>
                    setQuantity(String(Math.max(1, Number(quantity) - 1)))
                  }
                >
                  −
                </button>
                <input
                  aria-label="주문 수량"
                  type="number"
                  min="1"
                  max={
                    side === "SELL" && portfolio.authenticated
                      ? Math.max(1, availableSellQuantity)
                      : 10000
                  }
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setQuantity(String(Number(quantity) + 1))}
                >
                  ＋
                </button>
              </div>
            </label>
            <div className="quick-quantity">
              <span>
                {side === "BUY"
                  ? `주문 가능 금액 기준 · 최대 ${maxBuyQuantity.toLocaleString("ko-KR")}주`
                  : `매도 가능 수량 기준 · 최대 ${availableSellQuantity.toLocaleString("ko-KR")}주`}
              </span>
              <div>
                {[25, 50, 75, 100].map((percent) => (
                  <button
                    type="button"
                    key={percent}
                    disabled={
                      side === "SELL"
                        ? availableSellQuantity <= 0
                        : maxBuyQuantity <= 0
                    }
                    onClick={() => setQuickQuantity(percent)}
                  >
                    {percent === 100 && side === "SELL"
                      ? "전량"
                      : `${percent}%`}
                  </button>
                ))}
              </div>
            </div>
            <div className="estimate">
              <span>예상 가상주문금액</span>
              <b>
                {money(
                  estimatedPrice * Number(quantity || 0),
                  quote?.currency ?? "KRW",
                )}
              </b>
            </div>
            {sellIssue && (
              <p className="order-error" role="alert">
                {sellIssue}
              </p>
            )}
            <small className="order-help">
              모의 수수료와 국내 매도비용은 체결 시 자동 반영돼요.
            </small>
            <button
              className={`submit ${side.toLowerCase()}`}
              disabled={busy || !quote || Boolean(sellIssue) || portfolio.authenticated && (accountState !== "ready" || orderResult?.kind === "uncertain")}
            >
              {busy ? (
                <>
                  <RefreshCw className="spin" size={17} /> 처리 중
                </>
              ) : portfolio.authenticated ? (
                `${side === "BUY" ? "모의 매수" : "모의 매도"} 주문 확인`
              ) : (
                "로그인하고 투자 연습"
              )}
            </button>
            <p className="disclaimer">
              실제 돈이 아닌 연습용 자금으로 주문합니다.
            </p>
          </form>
          {portfolio.authenticated && (
            <section
              className="position-protection"
              aria-labelledby="position-protection-title"
            >
              <div className="protection-title">
                <span>
                  <ShieldCheck size={16} />
                </span>
                <div>
                  <h3 id="position-protection-title">익절·손절 동시 보호</h3>
                  <p>
                    둘 중 먼저 도달한 가격으로 가상 청산하고 나머지는 자동
                    취소해요.
                  </p>
                </div>
              </div>
              {activePosition ? (
                <>
                  <form onSubmit={createProtection}>
                    <label>
                      보호 수량
                      <input
                        type="number"
                        min="1"
                        max={Math.max(1, availableSellQuantity)}
                        value={protectionQuantity}
                        onChange={(event) =>
                          setProtectionQuantity(event.target.value)
                        }
                      />
                    </label>
                    <label>
                      익절 가격
                      <input
                        type="number"
                        min="0.01"
                        step={quote?.currency === "KRW" ? "1" : "0.01"}
                        placeholder={
                          quote
                            ? String(
                                Math.round(
                                  quote.price *
                                    1.1 *
                                    (quote.currency === "KRW" ? 1 : 100),
                                ) / (quote.currency === "KRW" ? 1 : 100),
                              )
                            : ""
                        }
                        value={takeProfitPrice}
                        onChange={(event) =>
                          setTakeProfitPrice(event.target.value)
                        }
                      />
                    </label>
                    <label>
                      손절 가격
                      <input
                        type="number"
                        min="0.01"
                        step={quote?.currency === "KRW" ? "1" : "0.01"}
                        placeholder={
                          quote
                            ? String(
                                Math.round(
                                  quote.price *
                                    0.95 *
                                    (quote.currency === "KRW" ? 1 : 100),
                                ) / (quote.currency === "KRW" ? 1 : 100),
                              )
                            : ""
                        }
                        value={stopLossPrice}
                        onChange={(event) =>
                          setStopLossPrice(event.target.value)
                        }
                      />
                    </label>
                    <button disabled={busy || availableSellQuantity <= 0}>
                      <Target size={14} /> 보호 설정
                    </button>
                  </form>
                  {activeProtections.length > 0 && (
                    <div className="protection-list">
                      {activeProtections.map((plan) => (
                        <article key={plan.id}>
                          <span>
                            <b>{plan.quantity}주 보호 중</b>
                            <small>
                              익절{" "}
                              {money(
                                plan.takeProfitPrice,
                                quote?.currency ?? "KRW",
                              )}{" "}
                              · 손절{" "}
                              {money(
                                plan.stopLossPrice,
                                quote?.currency ?? "KRW",
                              )}
                            </small>
                          </span>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => cancelProtection(plan.id)}
                          >
                            취소
                          </button>
                        </article>
                      ))}
                    </div>
                  )}
                  <small className="protection-disclaimer">
                    5초 간격으로 실제 KIS 시세를 확인하며, 체결 시 모의 호가
                    차이와 슬리피지를 반영해요.
                  </small>
                </>
              ) : (
                <p className="protection-empty">
                  선택한 종목을 보유하면 익절·손절 가격을 함께 설정할 수 있어요.
                </p>
              )}
            </section>
          )}
          {portfolio.orders.length > 0 && (
            <div className="orders">
              <h3>최근 가상주문</h3>
              {portfolio.orders.slice(0, 4).map((order) => (
                <div key={order.id}>
                  <span>
                    <b>{order.symbol}</b>
                    <small>
                      {order.side === "BUY" ? "매수" : "매도"} {order.quantity}
                      주
                    </small>
                  </span>
                  <span className="order-status">
                    <em className={order.status}>
                      {order.status === "FILLED"
                        ? "체결"
                        : order.status === "OPEN"
                          ? "조건 대기"
                          : order.status === "TRIGGERED"
                            ? "조건 충족"
                            : order.status === "CANCELED"
                              ? "취소"
                              : "거절"}
                    </em>
                    {order.status === "FILLED" && order.slippageBps != null && (
                      <small className="execution-quality">
                        체결비용 {order.slippageBps.toFixed(1)}bp
                      </small>
                    )}
                    {["OPEN", "TRIGGERED"].includes(order.status) && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => cancelOrder(order.id)}
                      >
                        주문취소
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </aside>
      </section>
      <div className="workspace-secondary">
        <details>
          <summary>투자 환경·비교 지표</summary>
          <KospiBenchmarkCard />
          <SimulationControlCenter
            authenticated={portfolio.authenticated}
            onNotice={notify}
          />
        </details>
        <nav aria-label="더 많은 투자 기능">
          <a href="/compare"><BarChart3 size={17} />종목 비교</a>
          <a href="/league">
            <Trophy size={17} />
            수익률 리그
          </a>
          <a href="/learn">
            <GraduationCap size={17} />
            주식 학습
          </a>
          <a href="/growth">
            <Gauge size={17} />
            성장 허브
          </a>
          <a href="/lounge">
            <MessageCircle size={17} />
            투자 라운지
          </a>
          <a href="/pricing">
            <BadgeCheck size={17} />
            Pro 플랜
          </a>
        </nav>
      </div>
      <button
        type="button"
        className="mobile-ticket-trigger"
        onClick={() => setMobileOrderOpen(true)}
      >
        <span>
          {selectedName}
          <small>
            {quote ? money(quote.price, quote.currency) : "시세 확인 중"}
          </small>
        </span>
        <b>
          모의주문 <ArrowUpRight size={17} />
        </b>
      </button>
      <footer>
        <b>StockPilot</b>
        <span className="service-footer-note">
          KIS 실제 시세 기반 자체 가상투자 서비스 · 실제 주문이 체결되지 않아요
        </span>
        <span className="footer-links">
          <a href="/guide">이용 가이드</a>
          <a href="/privacy">개인정보처리방침</a>
          <a href="/terms">이용약관</a>
          <a href="https://www.logo.dev" target="_blank" rel="noreferrer">
            Logos provided by Logo.dev
          </a>
        </span>
      </footer>
      {guideOpen ? <OnboardingGuide open onClose={closeGuide} /> : null}
      {confirmingOrder && quote && (
        <div
          className="order-confirm-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) {
              setConfirmingOrder(false);
            }
          }}
        >
          <section
            className="order-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="order-confirm-title"
          >
            <button
              type="button"
              className="confirm-close"
              aria-label="주문 확인 닫기"
              disabled={busy}
              onClick={() => setConfirmingOrder(false)}
            >
              <X size={18} />
            </button>
            <span className={`confirm-side ${side.toLowerCase()}`}>
              {side === "BUY" ? "가상매수" : "가상매도"}
            </span>
            <h2 id="order-confirm-title">주문 내용을 확인해 주세요</h2>
            <p>
              {selectedName} · {activeSymbol}
            </p>
            <dl>
              <div>
                <dt>주문 방식</dt>
                <dd>{ORDER_LABELS[kind]}</dd>
              </div>
              <div>
                <dt>수량</dt>
                <dd>{requestedQuantity.toLocaleString("ko-KR")}주</dd>
              </div>
              <div>
                <dt>기준 가격</dt>
                <dd>{money(estimatedPrice, quote.currency)}</dd>
              </div>
              <div className="confirm-total">
                <dt>예상 주문금액</dt>
                <dd>
                  {money(estimatedPrice * requestedQuantity, quote.currency)}
                </dd>
              </div>
            </dl>
            <div className="confirm-simulation-note">
              실제 증권계좌 주문이 아닌 StockPilot 내부 가상주문입니다.
            </div>
            <div className="confirm-checklist" aria-label="거래 전 안전 확인">
              <div className="confirm-checklist-head">
                <span>
                  <ShieldCheck size={15} /> 거래 전 안전 확인
                </span>
                <b>{orderSafetyCount}/4</b>
              </div>
              <p className="confirm-checklist-help">
                네 항목을 확인하면 가상주문을 접수할 수 있어요.
              </p>
              <div className="confirm-checklist-items">
                {orderSafetyItems.map((item) => (
                  <label
                    className={`confirm-check${item.disabled ? " disabled" : ""}`}
                    key={item.key}
                  >
                    <input
                      type="checkbox"
                      checked={orderSafetyChecks[item.key]}
                      disabled={item.disabled || busy}
                      onChange={() =>
                        setOrderSafetyChecks((current) => ({
                          ...current,
                          [item.key]: !current[item.key],
                        }))
                      }
                    />
                    <span className="confirm-check-copy">
                      <b>{item.label}</b>
                      <small>{item.detail}</small>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div className="confirm-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmingOrder(false)}
              >
                다시 확인
              </button>
              <button
                type="button"
                className={side.toLowerCase()}
                disabled={busy || !orderSafetyReady}
                onClick={() => void placeOrder()}
              >
                {busy
                  ? "처리 중"
                  : `${side === "BUY" ? "가상매수" : "가상매도"} 확정`}
              </button>
            </div>
          </section>
        </div>
      )}
      {toast && (
        <div className="toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </main>
  );
}
