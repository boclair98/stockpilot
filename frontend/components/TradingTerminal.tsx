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
  LogIn,
  LogOut,
  PieChart,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trophy,
  Wifi,
  X,
} from "lucide-react";

import CompanyInsight from "./CompanyInsight";
import InvestorTools from "./InvestorTools";
import MarketIndexChart from "./MarketIndexChart";
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
};
type Order = {
  id: string;
  symbol: string;
  exchange: string;
  side: string;
  orderType: string;
  quantity: number;
  fillPrice: number | null;
  status: string;
  createdAt: string;
};
type Portfolio = {
  authenticated: boolean;
  cash: Record<Currency, number>;
  positions: Position[];
  orders: Order[];
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
  });
  const [status, setStatus] = useState<MarketStatus | null>(null);
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
    const initialPortfolioTimer = window.setTimeout(refreshPortfolio, 0);
    const portfolioTimer = window.setInterval(refreshPortfolio, 5000);
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let stopped = false;
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
        }
      };
      socket.onclose = () => {
        setSocketConnected(false);
        if (!stopped) reconnectTimer = setTimeout(connect, 1800);
      };
      socket.onerror = () => socket?.close();
    };
    connect();
    return () => {
      stopped = true;
      window.clearTimeout(initialPortfolioTimer);
      window.clearInterval(portfolioTimer);
      clearTimeout(reconnectTimer);
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
  const availableSellQuantity = Math.max(
    0,
    (activePosition?.quantity ?? 0) - pendingSellQuantity,
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
  const session = useMemo(() => nxtSession(clock), [clock]);
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
    const notices: string[] = [];
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
      winners,
    };
  }, [portfolio.authenticated, portfolio.cash, portfolio.positions, positionValues]);

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
    });
  }

  async function chooseSearchResult(item: SearchItem) {
    setSearching(true);
    try {
      const response = await fetch(
        `/api/trading/quote?symbol=${encodeURIComponent(item.symbol)}&market=${item.market}&exchange=${item.exchange}`,
        { cache: "no-store" },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "시세를 불러오지 못했어요.");
      setQuotes((current) => [...current.filter((entry) => entry.id !== data.id), data]);
      setSelected(data.id);
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
      const response = await fetch("/api/trading/orders", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
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
          ? `${selectedName} 가상주문이 ${money(data.fillPrice, data.currency)}에 체결됐어요.`
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
      <header className="topbar">
        <a className="brand" href="#"><span><Sparkles size={18} /></span>StockPilot</a>
        <div className="top-actions">
          <a className="league-link" href="/league"><Trophy size={16} /> 수익률 리그</a>
          <a className="league-link practice-link" href="/practice"><BrainCircuit size={16} /> 시세 연습</a>
          <button aria-label="검색"><Search size={19} /></button>
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

      <section className="hero">
        <div>
          <p className="eyebrow">
            <span className={live ? "live-dot" : "live-dot off"} />
            {live
              ? "KIS KRX+NXT 통합 시세 연결됨"
              : status?.configured
                ? "KIS 통합 시세 연결 중"
                : "시세 설정 필요"}
          </p>
          <h1>실제 시세로 연습하는<br />나의 가상 투자</h1>
          <p>국내는 KRX·NXT 통합, 미국은 현지시장 KIS 시세로 거래해요. 실제 증권 주문은 전송되지 않습니다.</p>
        </div>
        <div className="hero-badge">
          <ShieldCheck size={26} />
          <span><b>서비스 자체 가상계좌</b><small>실제 계좌번호·비밀번호 불필요</small></span>
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

      <MarketIndexChart />

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
          </div>
          <div className="checkup-advice">
            <PieChart size={16} />
            <div>
              {portfolioCheck.notices.map((notice) => (
                <p key={notice}>{notice}</p>
              ))}
            </div>
          </div>
        </article>
      </section>

      <section className="content">
        <div className="market-column">
          <div className="section-head">
            <div><h2>실시간 주요 종목 TOP 10</h2><p>국내는 KRX+NXT 통합 시세를 1초마다 화면에 반영해요</p></div>
            <span className="source"><Wifi size={13} /> {quote?.source || "KIS 연결 중"}</span>
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
                    <StockLogo symbol={item.symbol} name={item.name} color={colorFor(item.symbol)} />
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

          <div className="search-card">
            <div className="section-head">
              <div><h2>모든 종목 검색</h2><p>종목명이나 종목코드·티커를 입력하세요</p></div>
            </div>
            <div className="search-controls">
              <div className="search-input"><Search size={18} /><input value={searchQuery} onChange={(event) => {
                const value = event.target.value;
                setSearchQuery(value);
                if (value.trim()) {
                  setSearching(true);
                } else {
                  setSearchResults([]);
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
                    <StockLogo symbol={item.symbol} name={item.name} color={colorFor(item.symbol)} />
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
                      />
                      <span><b>{item.name}</b><small>{item.symbol}</small></span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <StockTrendPanel
            symbol={activeSymbol}
            name={selectedName}
            market={quote?.market ?? "KR"}
            exchange={quote?.exchange ?? "KRX"}
            currency={quote?.currency ?? "KRW"}
          />

          <CompanyInsight
            symbol={activeSymbol}
            market={quote?.market ?? "KR"}
          />

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
                    <StockLogo symbol={position.symbol} name={position.name} color={colorFor(position.symbol)} />
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
            <StockLogo symbol={activeSymbol} name={selectedName} color={colorFor(activeSymbol)} large />
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
                    {["OPEN", "TRIGGERED"].includes(order.status) && <button type="button" disabled={busy} onClick={() => cancelOrder(order.id)}>주문취소</button>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </aside>
      </section>
      <footer><b>StockPilot</b><span>KIS 실제 시세 기반 자체 가상투자 서비스</span><a href="https://coders.kr">coders.kr에서 호스팅</a></footer>
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
