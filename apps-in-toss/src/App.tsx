import { Analytics, Device, NavigationBar, SafeArea } from "@apps-in-toss/web-framework";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  clearSession,
  deleteAccount,
  initializeTossSession,
  joinLeague,
  loadDashboard,
  loadQuote,
  searchStocks,
  submitOrder,
} from "./api";
import type { AppTab, Bootstrap, League, Portfolio, Position, Quote } from "./types";

const EMPTY_PORTFOLIO: Portfolio = {
  authenticated: false,
  cash: { KRW: 100_000_000, USD: 100_000 },
  positions: [],
  orders: [],
};

const EMPTY_LEAGUE: League = {
  title: "StockPilot 오픈 리그",
  participantCount: 0,
  rankings: [],
  me: { joined: false },
};

const TAB_LABELS: Record<AppTab, string> = {
  home: "홈",
  market: "시장",
  portfolio: "투자",
  league: "리그",
  more: "전체",
};

const formatters = new Map<string, Intl.NumberFormat>();

function numberFormatter(currency?: string): Intl.NumberFormat {
  const key = currency || "number";
  const cached = formatters.get(key);
  if (cached) return cached;
  const formatter = new Intl.NumberFormat("ko-KR", currency ? {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "KRW" ? 0 : 2,
  } : { maximumFractionDigits: 2 });
  formatters.set(key, formatter);
  return formatter;
}

function money(value: number, currency: "KRW" | "USD" = "KRW"): string {
  return numberFormatter(currency).format(Number.isFinite(value) ? value : 0);
}

function percent(value = 0): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function tone(value = 0): "up" | "down" | "flat" {
  return value > 0 ? "up" : value < 0 ? "down" : "flat";
}

function safeHaptic(type: "tap" | "success" | "error" = "tap"): void {
  try {
    void Device.triggerHaptic({ type }).catch(() => undefined);
  } catch {
    // Native bridge is intentionally absent in a regular browser preview.
  }
}

async function safeLog(name: string, params: Record<string, string> = {}): Promise<void> {
  try {
    await Analytics.log({ log_name: name, log_type: "event", params });
  } catch {
    // Analytics must never block a core investment flow.
  }
}

function appPath(tab: AppTab): string {
  return tab === "home" ? "/" : `/${tab}`;
}

function tabFromPath(): AppTab {
  const path = window.location.pathname.split("/").filter(Boolean)[0];
  return path && path in TAB_LABELS ? path as AppTab : "home";
}

function BrandMark({ symbol, logoUrl, name }: { symbol: string; logoUrl?: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  const initials = name.replace(/[^0-9A-Za-z가-힣]/g, "").slice(0, 1) || symbol.slice(0, 1);
  if (logoUrl && !failed) {
    return <img className="brand-mark" src={logoUrl} alt="" loading="lazy" onError={() => setFailed(true)} />;
  }
  return <span className="brand-mark brand-fallback" aria-hidden="true">{initials}</span>;
}

function Sparkline({ values, positive = true }: { values: number[]; positive?: boolean }) {
  if (values.length < 2) return <div className="spark-empty" />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || 1;
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * 100;
    const y = 44 - ((value - min) / spread) * 38;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg className={`sparkline ${positive ? "positive" : "negative"}`} viewBox="0 0 100 48" role="img" aria-label="최근 지수 흐름">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StockRow({ stock, onOpen, owned }: { stock: Quote; onOpen: (stock: Quote) => void; owned?: number }) {
  const change = stock.changePercent ?? 0;
  return (
    <button className="stock-row" type="button" onClick={() => onOpen(stock)}>
      <BrandMark symbol={stock.symbol} logoUrl={stock.logoUrl} name={stock.name} />
      <span className="stock-copy">
        <strong>{stock.name}</strong>
        <small>{stock.symbol} · {stock.exchange}{owned ? ` · ${owned}주 보유` : ""}</small>
      </span>
      <span className="stock-price">
        <strong>{money(stock.price, stock.currency)}</strong>
        <small className={tone(change)}>{percent(change)}</small>
      </span>
    </button>
  );
}

function LoadingView() {
  return (
    <main className="app-main skeleton-page" aria-busy="true" aria-label="데이터 불러오는 중">
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-hero" />
      <div className="skeleton skeleton-line" />
      <div className="skeleton skeleton-row" />
      <div className="skeleton skeleton-row" />
      <div className="skeleton skeleton-row" />
    </main>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="empty-state">
      <span className="empty-icon">◎</span>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

function OrderSheet({
  stock,
  portfolio,
  onClose,
  onComplete,
}: {
  stock: Quote;
  portfolio: Portfolio;
  onClose: () => void;
  onComplete: () => Promise<void>;
}) {
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [quantity, setQuantity] = useState("1");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const numericQuantity = Math.max(0, Number(quantity) || 0);
  const held = portfolio.positions.find((item) => item.symbol === stock.symbol && item.exchange === stock.exchange)?.quantity || 0;
  const estimated = stock.price * numericQuantity;

  async function placeOrder() {
    if (!Number.isInteger(numericQuantity) || numericQuantity < 1) {
      setError("1주 이상 정수로 입력해 주세요.");
      return;
    }
    if (side === "SELL" && numericQuantity > held) {
      setError(`보유 수량 ${held}주까지만 매도할 수 있어요.`);
      safeHaptic("error");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await submitOrder({ stock, side, quantity: numericQuantity });
      safeHaptic("success");
      await safeLog("paper_order_completed", { side, symbol: stock.symbol });
      await onComplete();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "주문을 처리하지 못했어요.");
      safeHaptic("error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="order-sheet" role="dialog" aria-modal="true" aria-labelledby="order-title">
        <div className="sheet-handle" />
        <div className="sheet-heading">
          <div><small>실시간 가상주문</small><h2 id="order-title">{stock.name}</h2></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="주문창 닫기">×</button>
        </div>
        <div className="order-quote">
          <span>현재 기준가</span><strong>{money(stock.price, stock.currency)}</strong>
        </div>
        <div className="segment" aria-label="주문 방향">
          <button type="button" className={side === "BUY" ? "active buy" : ""} onClick={() => { setSide("BUY"); setError(""); }}>매수</button>
          <button type="button" className={side === "SELL" ? "active sell" : ""} onClick={() => { setSide("SELL"); setError(""); }}>매도</button>
        </div>
        <label className="field-label" htmlFor="quantity">수량</label>
        <div className="quantity-field">
          <input id="quantity" type="number" inputMode="numeric" min="1" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
          <span>주</span>
        </div>
        <div className="quick-quantity">
          {[1, 5, 10].map((value) => <button type="button" key={value} onClick={() => setQuantity(String(value))}>+{value}주</button>)}
          {side === "SELL" ? <button type="button" onClick={() => setQuantity(String(Math.floor(held)))}>전량</button> : null}
        </div>
        <dl className="order-summary">
          <div><dt>예상 주문금액</dt><dd>{money(estimated, stock.currency)}</dd></div>
          <div><dt>보유 수량</dt><dd>{held.toLocaleString("ko-KR")}주</dd></div>
        </dl>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className={`primary-button ${side === "SELL" ? "sell-button" : ""}`} type="button" disabled={submitting} onClick={placeOrder}>
          {submitting ? "주문 확인 중…" : `${side === "BUY" ? "매수" : "매도"} 주문하기`}
        </button>
        <p className="sheet-note">실제 돈이 오가지 않는 교육용 모의투자예요. 체결가에는 가상 수수료와 슬리피지가 반영될 수 있어요.</p>
      </section>
    </div>
  );
}

function App() {
  const [tab, setTab] = useState<AppTab>(tabFromPath);
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [portfolio, setPortfolio] = useState<Portfolio>(EMPTY_PORTFOLIO);
  const [league, setLeague] = useState<League>(EMPTY_LEAGUE);
  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState("");
  const [toast, setToast] = useState("");
  const [selected, setSelected] = useState<Quote | null>(null);
  const [query, setQuery] = useState("");
  const [market, setMarket] = useState<"ALL" | "KR" | "US">("ALL");
  const [results, setResults] = useState<Quote[]>([]);
  const [searching, setSearching] = useState(false);
  const [nickname, setNickname] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const refresh = useCallback(async () => {
    const [nextBootstrap, nextPortfolio, nextLeague] = await loadDashboard();
    setBootstrap(nextBootstrap);
    setPortfolio(nextPortfolio);
    setLeague(nextLeague);
  }, []);

  useEffect(() => {
    let insets = { top: 0, right: 0, bottom: 0, left: 0 };
    try {
      insets = SafeArea.get();
    } catch {
      // Browser preview has no Toss native constants.
    }
    document.documentElement.style.setProperty("--safe-top", `${insets.top}px`);
    document.documentElement.style.setProperty("--safe-bottom", `${insets.bottom}px`);
    try {
      void NavigationBar.setOptions({
        withBackButton: true,
        withHomeButton: true,
        withTitle: true,
        backgroundColor: "#ffffff",
        theme: "light",
      }).catch(() => undefined);
    } catch {
      // Browser preview has no native navigation bar.
    }
    const handlePopState = () => setTab(tabFromPath());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    let active = true;
    async function start() {
      try {
        await initializeTossSession();
        if (!active) return;
        await refresh();
      } catch (reason) {
        if (!active) return;
        if (reason instanceof ApiError && reason.status === 401) clearSession();
        setFatal(reason instanceof Error ? reason.message : "서비스를 불러오지 못했어요.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void start();
    return () => { active = false; };
  }, [refresh]);

  useEffect(() => {
    try {
      void Analytics.screen({ log_name: `screen_${tab}` });
    } catch {
      // Browser preview has no analytics bridge.
    }
  }, [tab]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    const timer = window.setTimeout(() => {
      searchStocks(trimmed, market)
        .then((items) => { if (!controller.signal.aborted) setResults(items); })
        .catch(() => { if (!controller.signal.aborted) setResults([]); })
        .finally(() => { if (!controller.signal.aborted) setSearching(false); });
    }, 280);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [query, market]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const totalKrw = useMemo(() => {
    const koreanValue = portfolio.positions.filter((item) => item.currency === "KRW").reduce((sum, item) => sum + item.marketValue, 0);
    return portfolio.cash.KRW + koreanValue;
  }, [portfolio]);

  const totalProfit = useMemo(() => portfolio.positions.reduce((sum, item) => sum + (item.currency === "KRW" ? item.profit : 0), 0), [portfolio]);

  function navigate(next: AppTab) {
    if (next === tab) return;
    window.history.pushState({}, "", appPath(next));
    setTab(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
    safeHaptic();
  }

  async function openStock(stock: Quote | Position) {
    const base: Quote = "price" in stock ? stock : {
      symbol: stock.symbol,
      name: stock.name,
      market: stock.market,
      currency: stock.currency,
      exchange: stock.exchange,
      price: stock.currentPrice,
      logoUrl: stock.logoUrl,
    };
    setSelected(base);
    try {
      const fresh = await loadQuote(base);
      setSelected(fresh);
    } catch {
      // The latest known quote remains usable while a refresh is retried later.
    }
  }

  async function submitLeagueJoin() {
    try {
      const next = await joinLeague(nickname.trim());
      setLeague(next);
      setNickname("");
      setToast("오픈 리그에 참여했어요.");
      safeHaptic("success");
    } catch (reason) {
      setToast(reason instanceof Error ? reason.message : "리그에 참여하지 못했어요.");
      safeHaptic("error");
    }
  }

  async function confirmAccountDeletion() {
    try {
      await deleteAccount();
      clearSession();
      setConfirmDelete(false);
      setFatal("계정 데이터가 삭제됐어요. 앱을 다시 열면 새 가상계좌로 시작할 수 있어요.");
    } catch (reason) {
      setToast(reason instanceof Error ? reason.message : "계정 데이터를 삭제하지 못했어요.");
    }
  }

  if (loading) return <LoadingView />;
  if (fatal || !bootstrap) {
    return (
      <main className="fatal-view">
        <div className="fatal-mark">SP</div>
        <h1>StockPilot을 열지 못했어요</h1>
        <p>{fatal || "시세 연결을 확인해 주세요."}</p>
        <button className="primary-button" type="button" onClick={() => window.location.reload()}>다시 시도</button>
        <small>실제 금융거래가 아닌 교육용 가상투자 서비스예요.</small>
      </main>
    );
  }

  const home = (
    <>
      <header className="page-header home-header"><div><span className="eyebrow">STOCKPILOT</span><h1>오늘의 투자 연습</h1></div><button className="notice-button" type="button" aria-label="알림">●</button></header>
      <section className="asset-card">
        <span>내 가상자산</span>
        <strong>{money(totalKrw)}</strong>
        <p className={tone(totalProfit)}>평가손익 {money(totalProfit)} <b>{totalProfit >= 0 ? "↗" : "↘"}</b></p>
        <div className="asset-actions">
          <button type="button" onClick={() => navigate("market")}>종목 찾기</button>
          <button type="button" onClick={() => navigate("portfolio")}>보유 주식</button>
        </div>
      </section>
      {bootstrap.kospi ? (
        <section className="index-card">
          <div className="index-copy"><span>코스피</span><strong>{numberFormatter().format(bootstrap.kospi.value)}</strong><small className={tone(bootstrap.kospi.changePercent)}>{percent(bootstrap.kospi.changePercent)}</small></div>
          <Sparkline values={(bootstrap.kospi.points || []).map((point) => point.close)} positive={bootstrap.kospi.changePercent >= 0} />
        </section>
      ) : null}
      <section className="section-block">
        <div className="section-title"><div><h2>실시간 인기 종목</h2><p>국내·미국 대표 종목을 바로 연습해 보세요</p></div><button type="button" onClick={() => navigate("market")}>전체</button></div>
        <div className="stock-list">{bootstrap.quotes.slice(0, 7).map((stock) => <StockRow key={`${stock.market}-${stock.exchange}-${stock.symbol}`} stock={stock} onOpen={openStock} />)}</div>
      </section>
      <button className="league-banner" type="button" onClick={() => navigate("league")}>
        <span className="league-emoji">🏆</span><span><strong>수익률 리그 진행 중</strong><small>{league.participantCount.toLocaleString("ko-KR")}명이 참여하고 있어요</small></span><b>›</b>
      </button>
      <aside className="disclosure">실제 투자 권유가 아니며 모든 자산과 주문은 가상입니다. 시세는 한국투자증권 KIS Open API를 활용합니다.</aside>
    </>
  );

  const marketView = (
    <>
      <header className="page-header"><div><span className="eyebrow">MARKET</span><h1>주식 찾기</h1></div></header>
      <div className="search-box"><span aria-hidden="true">⌕</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="회사명이나 종목코드 검색" aria-label="주식 검색" /><button type="button" onClick={() => setQuery("")} aria-label="검색어 지우기">{query ? "×" : ""}</button></div>
      <div className="market-tabs" role="tablist" aria-label="시장 선택">
        {(["ALL", "KR", "US"] as const).map((value) => <button key={value} role="tab" aria-selected={market === value} className={market === value ? "active" : ""} type="button" onClick={() => setMarket(value)}>{value === "ALL" ? "전체" : value === "KR" ? "국내" : "미국"}</button>)}
      </div>
      <section className="section-block market-results">
        <div className="section-title"><div><h2>{query ? `‘${query}’ 검색 결과` : "주요 종목"}</h2><p>{query ? "상장 종목을 실시간으로 검색해요" : "현재 관심이 높은 종목이에요"}</p></div></div>
        {searching ? <div className="inline-loading">검색하고 있어요…</div> : null}
        {!searching && query && results.length === 0 ? <EmptyState title="검색 결과가 없어요" description="회사명 또는 종목코드를 다시 확인해 주세요." /> : null}
        <div className="stock-list">{(query ? results : bootstrap.quotes.filter((stock) => market === "ALL" || stock.market === market)).map((stock) => <StockRow key={`${stock.market}-${stock.exchange}-${stock.symbol}`} stock={stock} onOpen={openStock} />)}</div>
      </section>
    </>
  );

  const portfolioView = (
    <>
      <header className="page-header"><div><span className="eyebrow">PAPER ACCOUNT</span><h1>내 투자</h1></div></header>
      <section className="balance-card">
        <span>총 가상자산</span><strong>{money(totalKrw)}</strong>
        <div><p><small>원화 주문가능</small><b>{money(portfolio.cash.KRW)}</b></p><p><small>달러 주문가능</small><b>{money(portfolio.cash.USD, "USD")}</b></p></div>
      </section>
      <section className="section-block">
        <div className="section-title"><div><h2>보유 주식</h2><p>{portfolio.positions.length}개 종목</p></div></div>
        {portfolio.positions.length ? <div className="position-list">{portfolio.positions.map((item) => (
          <button className="position-card" type="button" key={`${item.exchange}-${item.symbol}`} onClick={() => openStock(item)}>
            <BrandMark symbol={item.symbol} name={item.name} logoUrl={item.logoUrl} />
            <span><strong>{item.name}</strong><small>{item.quantity.toLocaleString("ko-KR")}주 · 평균 {money(item.averagePrice, item.currency)}</small></span>
            <span><strong>{money(item.marketValue, item.currency)}</strong><small className={tone(item.returnRate)}>{percent(item.returnRate)}</small></span>
          </button>
        ))}</div> : <EmptyState title="아직 보유한 주식이 없어요" description="시장 탭에서 첫 가상주문을 시작해 보세요." />}
      </section>
      <section className="section-block order-history">
        <div className="section-title"><div><h2>최근 주문</h2><p>최대 30건을 보여드려요</p></div></div>
        {portfolio.orders.length ? portfolio.orders.slice(0, 10).map((order) => <div className="history-row" key={order.id}><span className={order.side === "BUY" ? "history-side buy" : "history-side sell"}>{order.side === "BUY" ? "매수" : "매도"}</span><span><strong>{order.symbol}</strong><small>{order.quantity}주 · {order.status}</small></span><time>{new Date(order.createdAt).toLocaleDateString("ko-KR")}</time></div>) : <EmptyState title="주문 내역이 없어요" description="연습 주문을 하면 체결 결과가 여기에 쌓여요." />}
      </section>
    </>
  );

  const leagueView = (
    <>
      <header className="page-header"><div><span className="eyebrow">RETURN LEAGUE</span><h1>수익률 리그</h1></div></header>
      <section className="league-hero"><span>SEASON</span><h2>종목은 비공개,<br />실력은 수익률로</h2><p>모두 같은 가상자금으로 시작해요. 보유 종목은 공개되지 않습니다.</p><div><strong>{league.participantCount.toLocaleString("ko-KR")}</strong><small>참여자</small></div></section>
      {!league.me.joined ? <section className="join-card"><h2>나도 순위에 도전하기</h2><p>닉네임만 공개되고 보유 종목과 주문은 나만 볼 수 있어요.</p><input type="text" value={nickname} maxLength={12} onChange={(event) => setNickname(event.target.value)} placeholder="닉네임 2~12자 (선택)" aria-label="리그 닉네임" /><button className="primary-button" type="button" onClick={submitLeagueJoin}>무료로 참여하기</button></section> : <section className="my-rank-card"><span>나의 현재 순위</span><strong>{league.me.rank ? `${league.me.rank}위` : "집계 중"}</strong><small>{league.me.nickname} · {percent(league.me.returnRate || 0)}</small></section>}
      <section className="section-block rankings"><div className="section-title"><div><h2>실시간 순위</h2><p>수익률만 공개해요</p></div></div>{league.rankings.length ? league.rankings.slice(0, 50).map((row) => <div className={`rank-row ${row.isMe ? "is-me" : ""}`} key={`${row.rank}-${row.nickname}`}><b>{row.rank}</b><span>{row.nickname}{row.isMe ? <em>나</em> : null}</span><strong className={tone(row.returnRate)}>{percent(row.returnRate)}</strong></div>) : <EmptyState title="첫 순위를 기다리고 있어요" description="리그에 참여하면 매일 수익률 순위가 집계돼요." />}</section>
    </>
  );

  const moreView = (
    <>
      <header className="page-header"><div><span className="eyebrow">STOCKPILOT</span><h1>전체</h1></div></header>
      <section className="guide-card"><div className="guide-icon">₩</div><div><strong>실전 전에 안전하게 연습해요</strong><p>원화 1억 원과 달러 10만 달러의 가상자금으로 국내·미국 주식을 체험할 수 있어요.</p></div></section>
      <section className="menu-card">
        <div className="menu-row"><span><b>서비스 유형</b><small>교육용 가상투자</small></span><strong>실거래 아님</strong></div>
        <div className="menu-row"><span><b>시세 출처</b><small>한국투자증권 KIS Open API</small></span><strong>실시간·지연 가능</strong></div>
        <div className="menu-row"><span><b>거래 시장</b><small>KRX · NXT · 미국</small></span><strong>모의 체결</strong></div>
      </section>
      <section className="section-block policy-block"><h2>안전한 이용을 위해</h2><ul><li>현금 입금·출금·실제 증권계좌 연결 기능이 없어요.</li><li>시세 지연이나 장 운영시간에 따라 체결 결과가 달라질 수 있어요.</li><li>수익률과 학습 결과는 실제 투자성과를 보장하지 않아요.</li><li>개인 보유종목과 주문내역은 리그에 공개하지 않아요.</li></ul></section>
      <button className="danger-link" type="button" onClick={() => setConfirmDelete(true)}>내 가상투자 데이터 삭제</button>
      <p className="version">StockPilot for Apps in Toss · v1.0.0</p>
    </>
  );

  return (
    <div className="app-shell">
      <main className="app-main">{tab === "home" ? home : tab === "market" ? marketView : tab === "portfolio" ? portfolioView : tab === "league" ? leagueView : moreView}</main>
      <nav className="bottom-nav" aria-label="주요 메뉴">{(Object.keys(TAB_LABELS) as AppTab[]).map((item) => <button type="button" key={item} className={tab === item ? "active" : ""} aria-current={tab === item ? "page" : undefined} onClick={() => navigate(item)}><span aria-hidden="true">{item === "home" ? "⌂" : item === "market" ? "⌕" : item === "portfolio" ? "↗" : item === "league" ? "♛" : "≡"}</span><small>{TAB_LABELS[item]}</small></button>)}</nav>
      {selected ? <OrderSheet stock={selected} portfolio={portfolio} onClose={() => setSelected(null)} onComplete={async () => { await refresh(); setToast("가상주문이 처리됐어요."); }} /> : null}
      {toast ? <div className="toast" role="status">{toast}</div> : null}
      {confirmDelete ? <div className="sheet-backdrop"><section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title"><h2 id="delete-title">모든 가상투자 데이터를 삭제할까요?</h2><p>잔액, 주문, 리그 기록이 영구 삭제되며 되돌릴 수 없어요. 실제 금융계좌에는 영향이 없습니다.</p><div><button type="button" onClick={() => setConfirmDelete(false)}>취소</button><button type="button" className="danger" onClick={confirmAccountDeletion}>영구 삭제</button></div></section></div> : null}
    </div>
  );
}

export default App;
