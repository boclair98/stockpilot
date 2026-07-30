"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  BrainCircuit,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  LogIn,
  LogOut,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trophy,
  Wifi,
} from "lucide-react";

import CompanyInsight from "./CompanyInsight";
import InvestorTools from "./InvestorTools";
import MarketIndexChart from "./MarketIndexChart";
import StockLogo from "./StockLogo";

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
const money = (value: number, currency: Currency) =>
  new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "KRW" ? 0 : 2,
  }).format(value);

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
                    onClick={() => {
                      setSelected(item.id);
                      setLimitPrice(String(item.price));
                      setTriggerPrice(String(item.price));
                    }}
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
          </div>

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
      {toast && <div className="toast" role="status" aria-live="polite">{toast}</div>}
    </main>
  );
}
