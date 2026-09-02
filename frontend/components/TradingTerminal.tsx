"use client";

import dynamic from "next/dynamic";
import { FormEvent, startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  Bell,
  BrainCircuit,
  ChevronRight,
  CircleDollarSign,
  Clock3,
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
  Sparkles,
  Star,
  Target,
  Trophy,
  X,
} from "lucide-react";

import DeferredMount from "./DeferredMount";
import InstallAppButton from "./InstallAppButton";
import MarketIndexChart, { type IndexData } from "./MarketIndexChart";
import MarketHeroCarousel from "./MarketHeroCarousel";
import StockLogo from "./StockLogo";
import KospiBenchmarkCard from "./KospiBenchmarkCard";
import MarketBriefing from "./MarketBriefing";
import MarketWatchlist, { type WatchlistItem } from "./MarketWatchlist";

const CompanyInsight = dynamic(() => import("./CompanyInsight"), {
  loading: () => <div className="chunk-placeholder" style={{ minHeight: 320 }} aria-hidden="true" />,
});
const InvestorTools = dynamic(() => import("./InvestorTools"), {
  loading: () => <div className="chunk-placeholder" style={{ minHeight: 420 }} aria-hidden="true" />,
});
const OnboardingGuide = dynamic(() => import("./OnboardingGuide"), {
  loading: () => null,
});
const StockTrendPanel = dynamic(() => import("./StockTrendPanel"), {
  loading: () => <div className="chunk-placeholder" style={{ minHeight: 360 }} aria-hidden="true" />,
});
const SimulationControlCenter = dynamic(() => import("./SimulationControlCenter"), {
  loading: () => <div className="chunk-placeholder compact" style={{ minHeight: 92 }} aria-hidden="true" />,
});
const MarketReplayStudio = dynamic(() => import("./MarketReplayStudio"), {
  loading: () => <div className="chunk-placeholder compact" style={{ minHeight: 160 }} aria-hidden="true" />,
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
  display_name: string;
  email: string | null;
  picture: string | null;
};

const palette = ["#111827", "#2563eb", "#76b900", "#ef4444", "#f59e0b", "#0668e1", "#18a46b"];
const colorFor = (symbol: string) =>
  palette[[...symbol].reduce((sum, char) => sum + char.charCodeAt(0), 0) % palette.length];
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
const percentText = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

function nxtSession(now: Date | null) {
  if (!now) return { label: "시간 확인 중", detail: "NXT 운영시간을 불러오고 있어요" };
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "0";
  const weekday = value("weekday");
  const seconds =
    Number(value("hour")) * 3600 +
    Number(value("minute")) * 60 +
    Number(value("second"));
  if (weekday === "Sat" || weekday === "Sun") {
    return { label: "NXT 휴장", detail: "평일 오전 8시에 프리마켓이 열려요" };
  }
  if (seconds >= 8 * 3600 && seconds < 8 * 3600 + 50 * 60) {
    return { label: "NXT 프리마켓", detail: "08:00–08:50 거래 중" };
  }
  if (seconds >= 9 * 3600 + 30 && seconds < 15 * 3600 + 20 * 60) {
    return { label: "NXT 메인마켓", detail: "09:00:30–15:20 거래 중" };
  }
  if (seconds >= 15 * 3600 + 40 * 60 && seconds < 20 * 3600) {
    return { label: "NXT 애프터마켓", detail: "15:40–20:00 거래 중" };
  }
  if (seconds < 8 * 3600) {
    return { label: "NXT 개장 전", detail: "08:00 프리마켓 시작" };
  }
  if (seconds < 9 * 3600 + 30) {
    return { label: "NXT 시가 준비", detail: "09:00:30 메인마켓 시작" };
  }
  if (seconds < 15 * 3600 + 40 * 60) {
    return { label: "NXT 애프터 준비", detail: "15:40 애프터마켓 시작" };
  }
  return { label: "NXT 장 종료", detail: "다음 평일 08:00 개장" };
}

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
  const [kind, setKind] = useState<"MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT">("MARKET");
  const [quantity, setQuantity] = useState("1");
  const [limitPrice, setLimitPrice] = useState("");
  const [triggerPrice, setTriggerPrice] = useState("");
  const [socketConnected, setSocketConnected] = useState(false);
  const [busy, setBusy] = useState(false);
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
  const [stressMove, setStressMove] = useState(-5);
  const [protectionQuantity, setProtectionQuantity] = useState("1");
  const [takeProfitPrice, setTakeProfitPrice] = useState("");
  const [stopLossPrice, setStopLossPrice] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);
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

  const refreshPortfolio = useCallback(async () => {
    const response = await fetch("/api/trading/portfolio", {
      credentials: "include",
      cache: "no-store",
    });
    if (response.ok) {
      const data = await response.json();
      setPortfolio(data);
    }
  }, []);

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
      localStorage.setItem("stockpilot_quote_snapshot", JSON.stringify(rows));
    };
    try {
      const saved = JSON.parse(localStorage.getItem("stockpilot_quote_snapshot") || "[]");
      if (Array.isArray(saved) && saved.length) {
        window.setTimeout(() => {
          if (!stopped) setQuotes(saved);
        }, 0);
      }
    } catch {
      localStorage.removeItem("stockpilot_quote_snapshot");
    }
    void fetch("/api/trading/bootstrap", {
      cache: "default",
      signal: bootstrapController.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!data || stopped) return;
        if (Array.isArray(data.quotes) && data.quotes.length) {
          setQuotes(data.quotes);
          saveSnapshot(data.quotes);
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
          if (message.type === "quotes") {
            startTransition(() => {
              setQuotes(message.data);
              setStatus(message.status);
            });
            saveSnapshot(message.data);
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
    const target = document.getElementById("search-card");
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => searchInputRef.current?.focus({ preventScroll: true }), 180);
  }, []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
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
        if (Array.isArray(saved)) setRecentStocks(saved.slice(0, 6));
        const favorites = JSON.parse(
          localStorage.getItem("stockpilot_favorite_stocks_v1") || "[]",
        );
        if (Array.isArray(favorites)) setFavoriteStocks(favorites.slice(0, 12));
      } catch {
        localStorage.removeItem("stockpilot_recent_stocks");
        localStorage.removeItem("stockpilot_favorite_stocks_v1");
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
        const data = response.ok ? await response.json() : { items: [] };
        startTransition(() => setSearchResults(data.items));
      } catch {
        if (!controller.signal.aborted) setSearchResults([]);
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 280);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [searchQuery, searchMarket]);

  const krTop = useMemo(() => quotes.filter((item) => item.isTop && item.market === "KR").slice(0, 10), [quotes]);
  const usTop = useMemo(() => quotes.filter((item) => item.isTop && item.market === "US").slice(0, 10), [quotes]);
  const quoteById = useMemo(() => new Map(quotes.map((item) => [item.id, item])), [quotes]);
  const quote = quoteById.get(selected) ?? quotes[0];
  const activeSymbol = quote?.symbol ?? "005930";
  const selectedName = quote?.name ?? activeSymbol;
  const favoriteIds = useMemo(
    () => new Set(favoriteStocks.map((item) => item.id)),
    [favoriteStocks],
  );
  const favoriteItems = useMemo<WatchlistItem[]>(
    () => favoriteStocks.map((item) => {
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
  const quoteFreshness = useMemo(() => {
    if (!clock || !quote?.asOf) return { label: "시세 연결 중", state: "waiting" };
    const ageSeconds = Math.max(0, Math.floor((clock.getTime() - new Date(quote.asOf).getTime()) / 1000));
    if (!Number.isFinite(ageSeconds)) return { label: "시세 확인 중", state: "waiting" };
    if (ageSeconds < 10) return { label: "방금 갱신", state: "fresh" };
    if (ageSeconds < 60) return { label: `${ageSeconds}초 전 갱신`, state: "fresh" };
    return { label: `${Math.floor(ageSeconds / 60)}분 전 갱신`, state: "stale" };
  }, [clock, quote]);
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
    (activePosition?.quantity ?? 0) - pendingSellQuantity - protectedSellQuantity,
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
  const live = socketConnected && Boolean(status?.connected);
  const marketConnectionText = live
    ? "KIS KRX+NXT 통합 시세 연결됨"
    : status?.configured
      ? "KIS 통합 시세 연결 중"
      : status
        ? "KIS 시세 설정 필요"
        : "시세를 빠르게 준비하고 있어요";
  const session = useMemo(() => nxtSession(clock), [clock]);
  const marketSessions = useMemo(
    () => [
      { label: "프리마켓", time: "08:00 – 08:50", active: session.label.includes("프리마켓") },
      { label: "메인마켓", time: "09:00:30 – 15:20", active: session.label.includes("메인마켓") },
      { label: "애프터마켓", time: "15:40 – 20:00", active: session.label.includes("애프터마켓") },
    ],
    [session.label],
  );
  const positionValues = useMemo(
    () =>
      portfolio.positions.reduce(
        (sum, position) => {
          const price =
            position.currentPrice ??
            quotes.find((item) => item.symbol === position.symbol && item.exchange === position.exchange)?.price ??
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
    const sorted = [...topQuotes].sort((a, b) => b.changePercent - a.changePercent);
    const riser = sorted[0] ?? null;
    const faller = sorted.at(-1) ?? null;
    const average =
      topQuotes.length > 0
        ? topQuotes.reduce((sum, item) => sum + item.changePercent, 0) / topQuotes.length
        : 0;
    const risingCount = topQuotes.filter((item) => item.changePercent > 0).length;
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
        !current || position.marketValue > current.marketValue ? position : current,
      null,
    );
    const largestTotal = largest ? total[largest.currency] : 0;
    const concentration =
      largest && largestTotal > 0 ? (largest.marketValue / largestTotal) * 100 : 0;
    const winners = portfolio.positions.filter((position) => position.profit > 0).length;
    const losers = portfolio.positions.filter((position) => position.profit < 0).length;
    const protectedValue = portfolio.protections
      .filter((plan) => plan.status === "ACTIVE")
      .reduce((sum, plan) => {
        const position = portfolio.positions.find(
          (item) => item.symbol === plan.symbol && item.exchange === plan.exchange,
        );
        if (!position) return sum;
        return sum + Math.min(plan.quantity, position.quantity) * position.currentPrice;
      }, 0);
    const totalInvested = invested.KRW + invested.USD;
    const protectionCoverage = totalInvested > 0 ? (protectedValue / totalInvested) * 100 : 0;
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
        notices.push(`${largest.name} 비중이 ${concentration.toFixed(0)}%로 높아요.`);
      }
      if (cashRatio.KRW < 8 && cashRatio.USD < 8) {
        notices.push("원화와 달러 현금 비중이 모두 낮아 추가 주문 여력이 작아요.");
      } else if (cashRatio.KRW > 80 && cashRatio.USD > 80) {
        notices.push("현금 비중이 높아 아직 시장 노출이 작은 편이에요.");
      }
      if (losers > winners && losers > 0) {
        notices.push("손실 중인 종목이 더 많아 손절·목표가 알림을 점검해 보세요.");
      }
      if (protectionCoverage < 25) {
        notices.push(`익절·손절 보호 범위가 ${protectionCoverage.toFixed(0)}%로 낮아요.`);
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
  }, [portfolio.authenticated, portfolio.cash, portfolio.positions, portfolio.protections, positionValues, stressMove]);

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
      localStorage.setItem("stockpilot_recent_stocks", JSON.stringify(next));
      return next;
    });
  }, []);

  const loadQuote = useCallback((item: SearchItem) => {
    const key = `${item.market}:${item.exchange}:${item.symbol}`;
    const cached = quoteRequestCache.current.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.request;
    quoteRequestCache.current.delete(key);
    const request = fetch(
      `/api/trading/quote?symbol=${encodeURIComponent(item.symbol)}&market=${item.market}&exchange=${item.exchange}`,
      { cache: "no-store" },
    )
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || "시세를 불러오지 못했어요.");
        return data as Quote;
      })
      .catch((error) => {
        quoteRequestCache.current.delete(key);
        throw error;
      });
    quoteRequestCache.current.set(key, { expiresAt: Date.now() + 5_000, request });
    return request;
  }, []);

  const toggleFavorite = useCallback((item: SearchItem) => {
    const exists = favoriteStocks.some((entry) => entry.id === item.id);
    const next = exists
      ? favoriteStocks.filter((entry) => entry.id !== item.id)
      : [item, ...favoriteStocks].slice(0, 12);
    setFavoriteStocks(next);
    try {
      localStorage.setItem("stockpilot_favorite_stocks_v1", JSON.stringify(next));
    } catch {
      // The watchlist still works for this session when storage is unavailable.
    }
    notify(exists ? `${item.name}을 관심종목에서 제거했어요.` : `${item.name}을 관심종목에 추가했어요.`);
  }, [favoriteStocks, notify]);

  function selectTopQuote(item: Quote) {
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
    setSearching(true);
    try {
      const data = await loadQuote(item);
      startTransition(() => {
        setQuotes((current) => [...current.filter((entry) => entry.id !== data.id), data]);
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
      setSearchResults([]);
      setSearchQuery("");
      document.querySelector(".order-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      notify(error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.");
    } finally {
      setSearching(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    location.href = "/";
  }

  async function cancelOrder(orderId: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/trading/orders/${orderId}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "주문을 취소하지 못했어요.");
      notify("대기 중인 지정가 가상주문을 취소했어요.");
      await refreshPortfolio();
    } catch (error) {
      notify(error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  async function createProtection(event: FormEvent) {
    event.preventDefault();
    if (!portfolio.authenticated || !quote || !activePosition) return;
    const takeProfit = Number(takeProfitPrice);
    const stopLoss = Number(stopLossPrice);
    const protectedQuantity = Number(protectionQuantity);
    if (!Number.isFinite(protectedQuantity) || protectedQuantity <= 0) {
      notify("보호할 수량을 입력해 주세요.");
      return;
    }
    if (takeProfit <= quote.price || stopLoss >= quote.price || stopLoss >= takeProfit) {
      notify("익절은 현재가보다 높게, 손절은 현재가보다 낮게 입력해 주세요.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/trading/protections", {
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
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "보호 주문을 등록하지 못했어요.");
      notify(`${selectedName} ${protectedQuantity}주에 익절·손절 보호를 설정했어요.`);
      setTakeProfitPrice("");
      setStopLossPrice("");
      await refreshPortfolio();
    } catch (error) {
      notify(error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelProtection(planId: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/trading/protections/${planId}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "보호 설정을 취소하지 못했어요.");
      notify("익절·손절 보호 설정을 취소했어요.");
      await refreshPortfolio();
    } catch (error) {
      notify(error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  function setQuickQuantity(percent: number) {
    const maximum =
      side === "SELL" && portfolio.authenticated
        ? availableSellQuantity
        : maxBuyQuantity;
    const next =
      percent === 100
        ? maximum
        : Math.floor(maximum * (percent / 100));
    setQuantity(String(Math.max(1, next)));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!portfolio.authenticated) {
      location.href = `/api/auth/google/login?return_to=${encodeURIComponent(location.pathname + location.search)}`;
      return;
    }
    if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) {
      notify("주문 수량을 1주 이상 입력해 주세요.");
      return;
    }
    if (sellIssue) {
      notify(sellIssue);
      return;
    }
    setConfirmingOrder(true);
  }

  async function placeOrder() {
    setBusy(true);
    try {
      // Keep one key for this confirmed submission. Browser/network retries
      // can no longer create a second simulated fill for the same click.
      const idempotencyKey = crypto.randomUUID();
      const response = await fetch("/api/trading/orders", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          symbol: activeSymbol,
          market: quote?.market,
          exchange: quote?.exchange,
          side,
          orderType: kind,
          quantity: Number(quantity),
          limitPrice: ["LIMIT", "STOP_LIMIT"].includes(kind) ? Number(limitPrice) : null,
          triggerPrice: ["STOP", "STOP_LIMIT"].includes(kind) ? Number(triggerPrice) : null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "주문을 접수하지 못했어요.");
      notify(
        data.status === "FILLED"
          ? `${selectedName} 가상주문이 ${money(data.fillPrice, data.currency)}에 체결됐어요${data.executionQuality?.slippageBps != null ? ` · 체결비용 ${Number(data.executionQuality.slippageBps).toFixed(1)}bp` : ""}.`
          : `${selectedName} 지정가 가상주문을 접수했어요.`,
      );
      await refreshPortfolio();
    } catch (error) {
      notify(error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
      setConfirmingOrder(false);
    }
  }

  return (
    <main className="app">
      <a className="skip-link" href="#market-content">본문으로 건너뛰기</a>
      <header className="topbar">
        <a className="brand" href="#"><span><Sparkles size={18} /></span>StockPilot</a>
        <div className="top-actions">
          <a className="league-link learn-link" href="/learn"><GraduationCap size={16} /> 주식 학습</a>
          <a className="league-link growth-link" href="/growth"><Gauge size={16} /> 성장 허브</a>
          <a className="league-link" href="/league"><Trophy size={16} /> 수익률 리그</a>
          <a className="league-link practice-link" href="/practice"><BrainCircuit size={16} /> 시세 연습</a>
          <a className="league-link lounge-link" href="/lounge"><MessageCircle size={16} /> 투자 라운지</a>
          <InstallAppButton />
          <button type="button" className="help-button" aria-label="처음 이용 안내" title="처음 이용 안내" onClick={() => setGuideOpen(true)}><HelpCircle size={19} /></button>
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
            aria-label={unreadAlerts ? `읽지 않은 알림 ${unreadAlerts}개` : "알림"}
            onClick={() => setAlertFocusKey((value) => value + 1)}
          >
            <Bell size={19} />
            {unreadAlerts > 0 && (
              <span className="alert-count">{unreadAlerts > 99 ? "99+" : unreadAlerts}</span>
            )}
          </button>
          {portfolio.authenticated ? (
            <button className="user-chip" onClick={logout} title="로그아웃">
              {me?.picture ? <span className="avatar profile-photo" style={{ backgroundImage: `url("${me.picture}")` }} /> : <span className="avatar">{me?.display_name?.[0] || "G"}</span>}
              <span>{me?.display_name || "내 계정"}</span><LogOut size={14} />
            </button>
          ) : (
            <a
              className="login"
              href="/api/auth/google/login?return_to=%2F"
            >
              <LogIn size={16} /> Google로 로그인
            </a>
          )}
        </div>
      </header>

      <section className="hero nxt-hero" id="market-content" tabIndex={-1}>
        <MarketHeroCarousel live={live} statusText={marketConnectionText} />
        <div className="hero-sessions" aria-label="NXT 거래 세션">
          {marketSessions.map((item) => (
            <div className={`hero-session${item.active ? " active" : ""}`} key={item.label}>
              <small>{item.active ? "NOW TRADING" : "SESSION"}</small>
              <b>{item.label}</b>
              <span>{item.time}</span>
            </div>
          ))}
          <div className="hero-session hero-session-status">
            <small>MARKET STATUS</small>
            <b>{session.label}</b>
            <span>{session.detail}</span>
          </div>
        </div>
      </section>

      <section className="summary">
        <article className="balance-card">
          <div className="card-title"><span>내 가상자산</span><small>KRW · USD</small></div>
          <strong>{money(portfolio.cash.KRW + positionValues.KRW, "KRW")}</strong>
          <div className="balance-detail">
            <span>원화 주문 가능 <b>{money(portfolio.cash.KRW, "KRW")}</b></span>
            <span>달러 주문 가능 <b>{money(portfolio.cash.USD, "USD")}</b></span>
            <span>국내 평가손익 <b className={performance.KRW >= 0 ? "up" : "down"}>{money(performance.KRW, "KRW")}</b></span>
            <span>미국 평가손익 <b className={performance.USD >= 0 ? "up" : "down"}>{money(performance.USD, "USD")}</b></span>
          </div>
        </article>
        <article className="guide-card">
          <CircleDollarSign size={23} />
          <div><b>시작 가상자금</b><p>1억원과 $100,000가 사용자별로 별도 관리돼요.</p></div>
          <ChevronRight size={18} />
        </article>
        <article className="market-clock-card">
          <Clock3 size={23} />
          <div><b>{session.label}</b><p>{session.detail}</p></div>
          <span>KRX+NXT</span>
        </article>
      </section>

      <MarketBriefing
        live={live}
        average={marketPulse.average}
        risingCount={marketPulse.risingCount}
        total={marketPulse.total}
        riser={marketPulse.riser}
        faller={marketPulse.faller}
        authenticated={portfolio.authenticated}
        positionCount={portfolioCheck.positionCount}
        concentration={portfolioCheck.concentration}
        protectionCoverage={portfolioCheck.protectionCoverage}
        winners={portfolioCheck.winners}
        losers={portfolioCheck.losers}
        selectedName={selectedName}
        quoteReady={Boolean(quote?.price)}
      />

      <MarketIndexChart initialData={bootstrapKospi} />

      <KospiBenchmarkCard />

      <DeferredMount minHeight={92} rootMargin="600px 0px">
        <SimulationControlCenter authenticated={portfolio.authenticated} onNotice={notify} />
      </DeferredMount>

      <details className="advanced-checkup">
        <summary>
          <span><Gauge size={17} /><b>고급 투자 체크업</b><small>시장 강도·포트폴리오 집중도·급락 스트레스 테스트</small></span>
          <ChevronRight size={18} />
        </summary>
        <section className="insight-grid" aria-label="시장과 내 투자 체크업">
        <article className="pulse-card">
          <div className="insight-title">
            <span><BarChart3 size={16} /> 오늘의 시장 요약</span>
            <small>{marketPulse.total ? `${marketPulse.total}개 주요 종목 기준` : "시세 수신 대기"}</small>
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
              <em className="up">{marketPulse.riser ? percentText(marketPulse.riser.changePercent) : "—"}</em>
            </span>
            <span>
              <small>하락 선두</small>
              <b>{marketPulse.faller ? marketPulse.faller.name : "—"}</b>
              <em className="down">{marketPulse.faller ? percentText(marketPulse.faller.changePercent) : "—"}</em>
            </span>
          </div>
        </article>

        <article className="checkup-card">
          <div className="insight-title">
            <span><Gauge size={16} /> 내 투자 체크업</span>
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
              <b>{portfolioCheck.winners}/{portfolioCheck.losers}</b>
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
              <span><BrainCircuit size={15} /> 급락 스트레스 테스트</span>
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
              <span><small>국내 보유분 예상 변동</small><b>{money(portfolioCheck.stressLoss.KRW, "KRW")}</b></span>
              <span><small>미국 보유분 예상 변동</small><b>{money(portfolioCheck.stressLoss.USD, "USD")}</b></span>
            </div>
            <p>모든 보유 종목이 같은 폭으로 움직인 단순 가정이며, 실제 손실 예측이나 투자 조언이 아닙니다.</p>
          </div>
        </article>
        </section>
      </details>

      <section className="content">
        <div className="market-column">
          <MarketWatchlist
            items={favoriteItems}
            selectedId={selected}
            colorFor={colorFor}
            onSelect={(item) => {
              const liveQuote = quoteById.get(item.id);
              if (liveQuote) {
                selectTopQuote(liveQuote);
                return;
              }
              void chooseSearchResult({ ...item, englishName: "" });
            }}
            onRemove={(item) => toggleFavorite({ ...item, englishName: "" })}
          />

          <div className="section-head">
            <div><h2>실시간 주요 종목 TOP 10</h2><p>국내는 KRX+NXT 통합 시세를 1초마다 화면에 반영해요</p></div>
            <span className={`source market-freshness ${quoteFreshness.state}`}>
              <i aria-hidden="true" />
              <span>{quote?.source || "KIS 연결 중"}<small>{quoteFreshness.label}</small></span>
            </span>
          </div>
          {([["한국", krTop], ["미국", usTop]] as const).map(([label, items]) => (
            <div className="market-block" key={label}>
              <div className="market-label"><b>{label} 주식</b><span>{label === "한국" ? "KRX+NXT · TOP 10" : "TOP 10"}</span></div>
              <div className="watchlist">
                {items.length === 0
                  ? [...Array(10)].map((_, index) => <div className="quote skeleton" key={index} />)
                  : items.map((item) => (
                  <button
                    className={`quote ${selected === item.id ? "active" : ""}`}
                    key={item.id}
                    onClick={() => selectTopQuote(item)}
                  >
                    <StockLogo symbol={item.symbol} name={item.name} color={colorFor(item.symbol)} logoUrl={item.logoUrl} />
                    <span className="company"><b>{item.name}</b><small>{item.symbol} · {item.exchange}</small></span>
                    <span className="quote-price">
                      <b>{money(item.price, item.currency)}</b>
                      <small className={item.changePercent >= 0 ? "up" : "down"}>
                        {item.changePercent >= 0 ? "+" : ""}{item.changePercent.toFixed(2)}%
                      </small>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}

          <div className="search-card" id="search-card">
            <div className="section-head">
              <div><h2>모든 종목 검색</h2><p>종목명이나 종목코드·티커를 입력하세요 · <kbd>/</kbd> 단축키</p></div>
            </div>
            <div className="search-controls">
              <div className="search-input"><Search size={18} /><input
                ref={searchInputRef}
                aria-label="종목명·종목코드·티커 검색"
                aria-controls="search-results"
                value={searchQuery}
                onKeyDown={(event) => {
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
                placeholder="예: 삼성전자, 카카오, AAPL, PLTR"
              /></div>
              <div className="search-market">
                {(["ALL", "KR", "US"] as const).map((item) => <button type="button" key={item} className={searchMarket === item ? "active" : ""} aria-pressed={searchMarket === item} onClick={() => {
                  setSearchMarket(item);
                  if (searchQuery.trim()) setSearching(true);
                }}>{item === "ALL" ? "전체" : item === "KR" ? "한국" : "미국"}</button>)}
              </div>
            </div>
            {searchQuery && (
              <div className="search-results" id="search-results" aria-busy={searching}>
                {searching ? <p className="search-state" role="status" aria-live="polite"><RefreshCw className="spin" size={16} /> 종목을 찾고 있어요</p> : searchResults.length ? searchResults.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    onPointerEnter={() => void loadQuote(item).catch(() => undefined)}
                    onFocus={() => void loadQuote(item).catch(() => undefined)}
                    onClick={() => chooseSearchResult(item)}
                  >
                    <StockLogo symbol={item.symbol} name={item.name} color={colorFor(item.symbol)} logoUrl={item.logoUrl} />
                    <span><b>{item.name}</b><small>{item.englishName || item.symbol}</small></span>
                    <span><b>{item.symbol}</b><small>{item.market === "KR" ? "한국" : "미국"} · {item.exchange}</small></span>
                    <ChevronRight size={17} />
                  </button>
                )) : <p className="search-state">일치하는 종목이 없어요.</p>}
              </div>
            )}
            {!searchQuery && recentStocks.length > 0 && (
              <div className="recent-stocks">
                <span><History size={14} /> 최근 본 종목</span>
                <div>
                  {recentStocks.map((item) => (
                    <button
                      type="button"
                      key={`${item.market}:${item.exchange}:${item.symbol}`}
                      onPointerEnter={() => void loadQuote(item).catch(() => undefined)}
                      onFocus={() => void loadQuote(item).catch(() => undefined)}
                      onClick={() => void chooseSearchResult(item)}
                    >
                      <StockLogo
                        symbol={item.symbol}
                        name={item.name}
                        color={colorFor(item.symbol)}
                        logoUrl={item.logoUrl}
                      />
                      <span><b>{item.name}</b><small>{item.symbol}</small></span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DeferredMount minHeight={360} rootMargin="420px 0px">
            <StockTrendPanel
              symbol={activeSymbol}
              name={selectedName}
              market={quote?.market ?? "KR"}
              exchange={quote?.exchange ?? "KRX"}
              currency={quote?.currency ?? "KRW"}
            />
          </DeferredMount>

          <DeferredMount minHeight={160} rootMargin="320px 0px">
            <MarketReplayStudio
              symbol={activeSymbol}
              name={selectedName}
              market={quote?.market ?? "KR"}
              exchange={quote?.exchange ?? "KRX"}
              currency={quote?.currency ?? "KRW"}
            />
          </DeferredMount>

          <DeferredMount minHeight={320} rootMargin="320px 0px">
            <CompanyInsight
              symbol={activeSymbol}
              market={quote?.market ?? "KR"}
            />
          </DeferredMount>

          <DeferredMount minHeight={420} rootMargin="320px 0px">
            <InvestorTools
              authenticated={portfolio.authenticated}
              selected={quote ? {
                symbol: quote.symbol,
                name: quote.name,
                market: quote.market,
                currency: quote.currency,
                exchange: quote.exchange,
                price: quote.price,
              } : null}
              onSelect={(item) => chooseSearchResult({
                id: `${item.market}:${item.exchange}:${item.symbol}`,
                symbol: item.symbol,
                name: item.name,
                englishName: "",
                market: item.market,
                currency: item.currency,
                exchange: item.exchange,
              })}
              onNotice={notify}
              onAlertSummary={({ unread }) => setUnreadAlerts(unread)}
              focusAlertsKey={alertFocusKey}
            />
          </DeferredMount>

          <div className="portfolio-panel" id="holdings">
            <div className="section-head">
              <div><h2>보유 주식</h2><p>{portfolio.authenticated ? "사용자별 가상계좌에 저장돼요" : "로그인하면 투자 기록이 저장돼요"}</p></div>
            </div>
            {portfolio.positions.length ? (
              portfolio.positions.map((position) => {
                const price = position.currentPrice ?? quotes.find((item) => item.symbol === position.symbol && item.exchange === position.exchange)?.price ?? position.averagePrice;
                const profit = position.profit ?? (price - position.averagePrice) * position.quantity;
                return (
                  <div className="holding" key={`${position.exchange}:${position.symbol}`}>
                    <StockLogo symbol={position.symbol} name={position.name} color={colorFor(position.symbol)} logoUrl={position.logoUrl} />
                    <span><b>{position.name}</b><small>{position.quantity}주 · 평균 {money(position.averagePrice, position.currency)}</small></span>
                    <span><b>{money(price * position.quantity, position.currency)}</b><small className={profit >= 0 ? "up" : "down"}>{profit >= 0 ? "+" : ""}{money(profit, position.currency)} · {(position.returnRate ?? 0).toFixed(2)}%</small></span>
                  </div>
                );
              })
            ) : (
              <div className="empty"><span>🌱</span><b>아직 보유한 주식이 없어요</b><p>실제 시세로 첫 가상주문을 시작해 보세요.</p></div>
            )}
          </div>
        </div>

        <aside className="order-card" id="order-ticket">
          <div className="order-stock">
            <StockLogo symbol={activeSymbol} name={selectedName} color={colorFor(activeSymbol)} logoUrl={quote?.logoUrl} large />
            <div><h2>{selectedName}</h2><p>{activeSymbol} · {quote?.market === "KR" ? "KRX+NXT 통합" : quote?.exchange ?? "KIS"}</p></div>
            <span className="current">
              <b>{quote ? money(quote.price, quote.currency) : "—"}</b>
              <small className={(quote?.changePercent ?? 0) >= 0 ? "up" : "down"}>
                {quote ? `${quote.changePercent >= 0 ? "+" : ""}${quote.changePercent.toFixed(2)}%` : ""}
              </small>
            </span>
            <button
              className={`favorite-selected${quote && favoriteIds.has(quote.id) ? " active" : ""}`}
              type="button"
              disabled={!quote}
              aria-pressed={quote ? favoriteIds.has(quote.id) : false}
              aria-label={quote && favoriteIds.has(quote.id) ? `${selectedName} 관심종목 제거` : `${selectedName} 관심종목 추가`}
              title={quote && favoriteIds.has(quote.id) ? "관심종목에서 제거" : "관심종목에 추가"}
              onClick={() => quote && toggleFavorite({
                id: quote.id,
                symbol: quote.symbol,
                name: quote.name,
                englishName: "",
                market: quote.market,
                currency: quote.currency,
                exchange: quote.exchange,
                logoUrl: quote.logoUrl,
              })}
            >
              <Star size={17} fill={quote && favoriteIds.has(quote.id) ? "currentColor" : "none"} />
            </button>
          </div>
          <div className="side-tabs">
            <button className={side === "BUY" ? "buy active" : ""} onClick={() => setSide("BUY")}><ArrowDownLeft size={16} /> 매수</button>
            <button
              className={side === "SELL" ? "sell active" : ""}
              onClick={() => {
                setSide("SELL");
                if (portfolio.authenticated && !activePosition) {
                  notify(`${selectedName}은 현재 보유하고 있지 않아 매도할 수 없어요.`);
                }
              }}
            ><ArrowUpRight size={16} /> 매도</button>
          </div>
          <form onSubmit={submit}>
            {side === "SELL" && portfolio.authenticated && (
              <div className={`sell-availability ${sellIssue ? "warning" : ""}`} role="status">
                <span>
                  <b>매도 가능 {availableSellQuantity.toLocaleString("ko-KR")}주</b>
                  <small>
                    보유 {(activePosition?.quantity ?? 0).toLocaleString("ko-KR")}주
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
            <label>가상주문 방식
              <select value={kind} onChange={(event) => setKind(event.target.value as "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT")}>
                <option value="MARKET">시장가</option>
                <option value="LIMIT">지정가</option>
                <option value="STOP">손절·돌파 주문</option>
                <option value="STOP_LIMIT">조건부 지정가</option>
              </select>
            </label>
            {["STOP", "STOP_LIMIT"].includes(kind) && (
              <label>감시 가격
                <div className="input-money">
                  <span>{quote?.currency === "KRW" ? "₩" : "$"}</span>
                  <input required type="number" min="0.01" step={quote?.currency === "KRW" ? "1" : "0.01"} value={triggerPrice} onChange={(event) => setTriggerPrice(event.target.value)} />
                </div>
                <small className="order-help">{side === "SELL" ? "현재가가 감시 가격 이하가 되면 주문해요." : "현재가가 감시 가격 이상이 되면 주문해요."}</small>
              </label>
            )}
            {["LIMIT", "STOP_LIMIT"].includes(kind) && (
              <label>희망 가격
                <div className="input-money">
                  <span>{quote?.currency === "KRW" ? "₩" : "$"}</span>
                  <input required type="number" min="0.01" step={quote?.currency === "KRW" ? "1" : "0.01"} value={limitPrice} onChange={(event) => setLimitPrice(event.target.value)} />
                </div>
              </label>
            )}
            <label>수량
              <div className="stepper">
                <button type="button" onClick={() => setQuantity(String(Math.max(1, Number(quantity) - 1)))}>−</button>
                <input
                  aria-label="주문 수량"
                  type="number"
                  min="1"
                  max={side === "SELL" && portfolio.authenticated ? Math.max(1, availableSellQuantity) : 10000}
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                />
                <button type="button" onClick={() => setQuantity(String(Number(quantity) + 1))}>＋</button>
              </div>
            </label>
            <div className="quick-quantity">
              <span>
                {side === "BUY"
                  ? `주문 가능 금액 기준 · 최대 ${maxBuyQuantity.toLocaleString("ko-KR")}주`
                  : `매도 가능 수량 기준 · 최대 ${availableSellQuantity.toLocaleString("ko-KR")}주`}
              </span>
              <div>
                {[10, 25, 50, 100].map((percent) => (
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
                    {percent === 100 && side === "SELL" ? "전량" : `${percent}%`}
                  </button>
                ))}
              </div>
            </div>
            <div className="estimate">
              <span>예상 가상주문금액</span>
              <b>{money(estimatedPrice * Number(quantity || 0), quote?.currency ?? "KRW")}</b>
            </div>
            {sellIssue && <p className="order-error" role="alert">{sellIssue}</p>}
            <small className="order-help">모의 수수료와 국내 매도비용은 체결 시 자동 반영돼요.</small>
            <button className={`submit ${side.toLowerCase()}`} disabled={busy || !quote || Boolean(sellIssue)}>
              {busy ? <><RefreshCw className="spin" size={17} /> 처리 중</> : portfolio.authenticated ? `${selectedName} ${side === "BUY" ? "가상매수" : "가상매도"}` : "로그인하고 가상투자하기"}
            </button>
            <p className="disclaimer">국내 시세는 KIS KRX+NXT 통합(UN), 체결과 자산은 StockPilot 내부 가상 데이터입니다.</p>
          </form>
          {portfolio.authenticated && (
            <section className="position-protection" aria-labelledby="position-protection-title">
              <div className="protection-title">
                <span><ShieldCheck size={16} /></span>
                <div>
                  <h3 id="position-protection-title">익절·손절 동시 보호</h3>
                  <p>둘 중 먼저 도달한 가격으로 가상 청산하고 나머지는 자동 취소해요.</p>
                </div>
              </div>
              {activePosition ? (
                <>
                  <form onSubmit={createProtection}>
                    <label>보호 수량
                      <input
                        type="number"
                        min="1"
                        max={Math.max(1, availableSellQuantity)}
                        value={protectionQuantity}
                        onChange={(event) => setProtectionQuantity(event.target.value)}
                      />
                    </label>
                    <label>익절 가격
                      <input
                        type="number"
                        min="0.01"
                        step={quote?.currency === "KRW" ? "1" : "0.01"}
                        placeholder={quote ? String(Math.round(quote.price * 1.1 * (quote.currency === "KRW" ? 1 : 100)) / (quote.currency === "KRW" ? 1 : 100)) : ""}
                        value={takeProfitPrice}
                        onChange={(event) => setTakeProfitPrice(event.target.value)}
                      />
                    </label>
                    <label>손절 가격
                      <input
                        type="number"
                        min="0.01"
                        step={quote?.currency === "KRW" ? "1" : "0.01"}
                        placeholder={quote ? String(Math.round(quote.price * 0.95 * (quote.currency === "KRW" ? 1 : 100)) / (quote.currency === "KRW" ? 1 : 100)) : ""}
                        value={stopLossPrice}
                        onChange={(event) => setStopLossPrice(event.target.value)}
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
                          <span><b>{plan.quantity}주 보호 중</b><small>익절 {money(plan.takeProfitPrice, quote?.currency ?? "KRW")} · 손절 {money(plan.stopLossPrice, quote?.currency ?? "KRW")}</small></span>
                          <button type="button" disabled={busy} onClick={() => cancelProtection(plan.id)}>취소</button>
                        </article>
                      ))}
                    </div>
                  )}
                  <small className="protection-disclaimer">5초 간격으로 실제 KIS 시세를 확인하며, 체결 시 모의 호가 차이와 슬리피지를 반영해요.</small>
                </>
              ) : (
                <p className="protection-empty">선택한 종목을 보유하면 익절·손절 가격을 함께 설정할 수 있어요.</p>
              )}
            </section>
          )}
          {portfolio.orders.length > 0 && (
            <div className="orders">
              <h3>최근 가상주문</h3>
              {portfolio.orders.slice(0, 4).map((order) => (
                <div key={order.id}>
                  <span><b>{order.symbol}</b><small>{order.side === "BUY" ? "매수" : "매도"} {order.quantity}주</small></span>
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
                      <small className="execution-quality">체결비용 {order.slippageBps.toFixed(1)}bp</small>
                    )}
                    {["OPEN", "TRIGGERED"].includes(order.status) && <button type="button" disabled={busy} onClick={() => cancelOrder(order.id)}>주문취소</button>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </aside>
      </section>
      <footer>
        <b>StockPilot</b><span className="service-footer-note">KIS 실제 시세 기반 자체 가상투자 서비스 · 실제 주문이 체결되지 않아요</span>
        <span className="footer-links">
          <a href="/guide">이용 가이드</a>
          <a href="/privacy">개인정보처리방침</a>
          <a href="/terms">이용약관</a>
          <a href="https://www.logo.dev" target="_blank" rel="noreferrer">Logos provided by Logo.dev</a>
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
            <p>{selectedName} · {activeSymbol}</p>
            <dl>
              <div><dt>주문 방식</dt><dd>{ORDER_LABELS[kind]}</dd></div>
              <div><dt>수량</dt><dd>{requestedQuantity.toLocaleString("ko-KR")}주</dd></div>
              <div><dt>기준 가격</dt><dd>{money(estimatedPrice, quote.currency)}</dd></div>
              <div className="confirm-total">
                <dt>예상 주문금액</dt>
                <dd>{money(estimatedPrice * requestedQuantity, quote.currency)}</dd>
              </div>
            </dl>
            <div className="confirm-simulation-note">
              실제 증권계좌 주문이 아닌 StockPilot 내부 가상주문입니다.
            </div>
            <div className="confirm-actions">
              <button type="button" disabled={busy} onClick={() => setConfirmingOrder(false)}>
                다시 확인
              </button>
              <button
                type="button"
                className={side.toLowerCase()}
                disabled={busy}
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
      {toast && <div className="toast" role="status" aria-live="polite">{toast}</div>}
    </main>
  );
}

