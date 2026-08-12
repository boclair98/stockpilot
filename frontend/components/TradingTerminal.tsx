"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Target,
  Trophy,
  Wifi,
  X,
} from "lucide-react";

import CompanyInsight from "./CompanyInsight";
import DeferredMount from "./DeferredMount";
import InvestorTools from "./InvestorTools";
import InstallAppButton from "./InstallAppButton";
import MarketIndexChart, { type IndexData } from "./MarketIndexChart";
import MarketHeroCarousel from "./MarketHeroCarousel";
import OnboardingGuide from "./OnboardingGuide";
import StockLogo from "./StockLogo";
import StockTrendPanel from "./StockTrendPanel";

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
  const [confirmingOrder, setConfirmingOrder] = useState(false);
  const [stressMove, setStressMove] = useState(-5);
  const [protectionQuantity, setProtectionQuantity] = useState("1");
  const [takeProfitPrice, setTakeProfitPrice] = useState("");
  const [stopLossPrice, setStopLossPrice] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);
  const toastTimer = useRef<number | null>(null);

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
      if (data.authenticated) {
        const meResponse = await fetch("/api/me", { credentials: "include", cache: "no-store" });
        setMe(meResponse.ok ? await meResponse.json() : null);
      } else {
        setMe(null);
      }
    }
  }, []);

  useEffect(() => {
    const initialPortfolioTimer = window.setTimeout(refreshPortfolio, 150);
    const portfolioTimer = window.setInterval(() => {
      if (!document.hidden) void refreshPortfolio();
    }, 10_000);
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout>;
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
    const connect = () => {
      socket = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/trading/ws`,
      );
      socket.onopen = () => setSocketConnected(true);
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === "quotes") {
          setQuotes(message.data);
          setStatus(message.status);
          saveSnapshot(message.data);
        }
      };
      socket.onclose = () => {
        setSocketConnected(false);
        if (!stopped) reconnectTimer = setTimeout(connect, 1800);
      };
      socket.onerror = () => socket?.close();
    };
    const refreshWhenVisible = () => {
      if (!document.hidden) void refreshPortfolio();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    connect();
    return () => {
      stopped = true;
      bootstrapController.abort();
      window.clearTimeout(initialPortfolioTimer);
      window.clearInterval(portfolioTimer);
      clearTimeout(reconnectTimer);
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

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = JSON.parse(
          localStorage.getItem("stockpilot_recent_stocks") || "[]",
        );
        if (Array.isArray(saved)) setRecentStocks(saved.slice(0, 6));
      } catch {
        localStorage.removeItem("stockpilot_recent_stocks");
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
        setSearchResults(data.items);
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
  const quote = quotes.find((item) => item.id === selected) ?? quotes[0];
  const activeSymbol = quote?.symbol ?? "005930";
  const selectedName = quote?.name ?? activeSymbol;
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
        notices.push(`${largest.nam…4888 tokens truncated…ts([]);
                  setSearching(false);
                }
              }} placeholder="예: 삼성전자, 카카오, AAPL, PLTR" /></div>
              <div className="search-market">
                {(["ALL", "KR", "US"] as const).map((item) => <button key={item} className={searchMarket === item ? "active" : ""} onClick={() => {
                  setSearchMarket(item);
                  if (searchQuery.trim()) setSearching(true);
                }}>{item === "ALL" ? "전체" : item === "KR" ? "한국" : "미국"}</button>)}
              </div>
            </div>
            {searchQuery && (
              <div className="search-results">
                {searching ? <p className="search-state"><RefreshCw className="spin" size={16} /> 종목을 찾고 있어요</p> : searchResults.length ? searchResults.map((item) => (
                  <button key={item.id} onClick={() => chooseSearchResult(item)}>
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

          <DeferredMount minHeight={360}>
            <StockTrendPanel
              symbol={activeSymbol}
              name={selectedName}
              market={quote?.market ?? "KR"}
              exchange={quote?.exchange ?? "KRX"}
              currency={quote?.currency ?? "KRW"}
            />
          </DeferredMount>

          <DeferredMount minHeight={320}>
            <CompanyInsight
              symbol={activeSymbol}
              market={quote?.market ?? "KR"}
            />
          </DeferredMount>

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

          <div className="portfolio-panel">
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

        <aside className="order-card">
          <div className="order-stock">
            <StockLogo symbol={activeSymbol} name={selectedName} color={colorFor(activeSymbol)} logoUrl={quote?.logoUrl} large />
            <div><h2>{selectedName}</h2><p>{activeSymbol} · {quote?.market === "KR" ? "KRX+NXT 통합" : quote?.exchange ?? "KIS"}</p></div>
            <span className="current">
              <b>{quote ? money(quote.price, quote.currency) : "—"}</b>
              <small className={(quote?.changePercent ?? 0) >= 0 ? "up" : "down"}>
                {quote ? `${quote.changePercent >= 0 ? "+" : ""}${quote.changePercent.toFixed(2)}%` : ""}
              </small>
            </span>
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
      <OnboardingGuide open={guideOpen} onClose={closeGuide} />
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

