"use client";

import {
  BellRing,
  Bookmark,
  Check,
  ChevronRight,
  LineChart,
  Newspaper,
  RefreshCw,
  Target,
  Trash2,
  Trophy,
} from "lucide-react";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  browserPushState,
  disableBrowserPush,
  enableBrowserPush,
  listenForForegroundPush,
  restoreBrowserPush,
} from "@/lib/firebase-push";

type Currency = "KRW" | "USD";
type Market = "KR" | "US";
type SelectedStock = {
  symbol: string;
  name: string;
  market: Market;
  currency: Currency;
  exchange: string;
  price: number;
};
type WatchItem = SelectedStock & {
  id: string;
  changePercent: number | null;
};
type AlertItem = {
  id: string;
  symbol: string;
  name: string;
  currency: Currency;
  direction: "ABOVE" | "BELOW";
  targetPrice: number;
  currentPrice: number | null;
  status: "ACTIVE" | "TRIGGERED";
  read: boolean;
  triggeredAt: string | null;
};
type Mission = {
  key: string;
  title: string;
  description: string;
  progress: number;
  goal: number;
  completed: boolean;
};
type Dashboard = {
  authenticated: boolean;
  watchlist: WatchItem[];
  alerts: AlertItem[];
  unreadAlerts: number;
  push: {
    configured: boolean;
    deviceCount: number;
  };
  report: {
    equity: Record<Currency, number>;
    returnRate: { KRW: number; USD: number; combined: number };
    tradeCount: number;
    realizedPnl: Record<Currency, number>;
    winRate: number;
    totalCosts: Record<Currency, number>;
    allocations: Array<{
      symbol: string;
      name: string;
      market: Market;
      currency: Currency;
      value: number;
    }>;
    history: Array<{ date: string; returnRate: number }>;
  } | null;
  missions: Mission[];
};
type NewsItem = {
  id: string;
  title: string;
  source: string;
  date: string | null;
  time: string | null;
};

const money = (value: number, currency: Currency) =>
  new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "KRW" ? 0 : 2,
  }).format(value);

function Sparkline({ values }: { values: number[] }) {
  const points = useMemo(() => {
    if (!values.length) return "";
    const min = Math.min(...values);
    const max = Math.max(...values);
    const spread = max - min || 1;
    return values
      .map((value, index) => {
        const x = values.length === 1 ? 50 : (index / (values.length - 1)) * 100;
        const y = 42 - ((value - min) / spread) * 34;
        return `${x},${y}`;
      })
      .join(" ");
  }, [values]);
  return (
    <svg className="report-sparkline" viewBox="0 0 100 48" preserveAspectRatio="none">
      <polyline points={points || "0,40 100,40"} />
    </svg>
  );
}

export default function InvestorTools({
  selected,
  authenticated,
  onSelect,
  onNotice,
  onAlertSummary,
  focusAlertsKey,
}: {
  selected: SelectedStock | null;
  authenticated: boolean;
  onSelect: (item: WatchItem) => void;
  onNotice: (message: string) => void;
  onAlertSummary: (summary: {
    unread: number;
    pushConfigured: boolean;
  }) => void;
  focusAlertsKey: number;
}) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [activeTab, setActiveTab] = useState<"WATCH" | "REPORT" | "MISSION" | "NEWS">("WATCH");
  const [targetPrice, setTargetPrice] = useState("");
  const [direction, setDirection] = useState<"ABOVE" | "BELOW">("ABOVE");
  const [busy, setBusy] = useState(false);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsRefreshing, setNewsRefreshing] = useState(false);
  const [newsUpdatedAt, setNewsUpdatedAt] = useState<string | null>(null);
  const [newsRefreshKey, setNewsRefreshKey] = useState(0);
  const [pushPermission, setPushPermission] = useState<
    NotificationPermission | "unsupported"
  >("default");
  const [thisDeviceEnabled, setThisDeviceEnabled] = useState(false);
  const seenTriggered = useRef<Set<string> | null>(null);
  const alertSelectionKey = useRef("");
  const newsSelectionKey = useRef("");
  const onNoticeRef = useRef(onNotice);
  const onAlertSummaryRef = useRef(onAlertSummary);

  useEffect(() => {
    onNoticeRef.current = onNotice;
    onAlertSummaryRef.current = onAlertSummary;
  }, [onAlertSummary, onNotice]);

  const load = useCallback(async () => {
    const response = await fetch("/api/features/dashboard", {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) return;
    const next: Dashboard = await response.json();
    setData(next);
    onAlertSummaryRef.current({
      unread: next.unreadAlerts,
      pushConfigured: next.push.configured,
    });
    const triggered = next.alerts.filter(
      (item) => item.status === "TRIGGERED",
    );
    if (seenTriggered.current) {
      const fresh = triggered.filter(
        (item) => !seenTriggered.current?.has(item.id),
      );
      if (fresh.length) {
        const names = fresh.slice(0, 2).map((item) => item.name).join(", ");
        onNoticeRef.current(
          `${names}${fresh.length > 2 ? ` 외 ${fresh.length - 2}개` : ""} 목표가에 도달했어요.`,
        );
      }
    }
    seenTriggered.current = new Set(triggered.map((item) => item.id));
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 15_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setPushPermission(browserPushState()),
      0,
    );
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let active = true;
    let unsubscribe: () => void = () => undefined;
    void listenForForegroundPush((payload) => {
      const title = payload.data?.title || "StockPilot 가격 알림";
      const body = payload.data?.body || "설정한 목표 가격에 도달했어요.";
      onNoticeRef.current(`${title} · ${body}`);
      void load();
    }).then((stop) => {
      if (active) unsubscribe = stop;
      else stop();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [load]);

  const registerToken = useCallback(async (token: string) => {
    const response = await fetch("/api/features/push/devices", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.detail || "푸시 알림 기기를 등록하지 못했어요.");
    }
  }, []);

  useEffect(() => {
    if (
      !authenticated ||
      typeof window === "undefined" ||
      localStorage.getItem("stockpilot_push_enabled") !== "1"
    ) {
      return;
    }
    let active = true;
    void restoreBrowserPush()
      .then(async (token) => {
        if (!token || !active) return;
        await registerToken(token);
        if (active) {
          setPushPermission("granted");
          setThisDeviceEnabled(true);
          void load();
        }
      })
      .catch(() => {
        if (active) setThisDeviceEnabled(false);
      });
    return () => {
      active = false;
    };
  }, [authenticated, load, registerToken]);

  useEffect(() => {
    if (!focusAlertsKey) return;
    const timer = window.setTimeout(() => {
      setActiveTab("WATCH");
      document
        .getElementById("investor-tools")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      if (!authenticated || !data?.unreadAlerts) return;
      void fetch("/api/features/alerts/read", {
        method: "POST",
        credentials: "include",
      }).then(() => void load());
    }, 0);
    return () => window.clearTimeout(timer);
  }, [authenticated, data?.unreadAlerts, focusAlertsKey, load]);

  useEffect(() => {
    if (!selected) return;
    const nextKey = `${selected.market}:${selected.exchange}:${selected.symbol}`;
    if (alertSelectionKey.current === nextKey) return;
    alertSelectionKey.current = nextKey;
    const initialPrice = selected.price;
    const timer = window.setTimeout(() => setTargetPrice(String(initialPrice)), 0);
    return () => window.clearTimeout(timer);
  }, [selected]);

  const newsSymbol = selected?.symbol;
  const newsMarket = selected?.market;
  const newsExchange = selected?.exchange;

  useEffect(() => {
    if (!newsSymbol || !newsMarket || !newsExchange || activeTab !== "NEWS") {
      return;
    }

    let active = true;
    let controller: AbortController | null = null;
    const selectionKey = `${newsMarket}:${newsExchange}:${newsSymbol}`;
    const selectionChanged = newsSelectionKey.current !== selectionKey;
    newsSelectionKey.current = selectionKey;
    if (selectionChanged) {
      setNews([]);
      setNewsUpdatedAt(null);
    }

    const loadNews = async (initial: boolean) => {
      controller?.abort();
      controller = new AbortController();
      if (initial) setNewsLoading(true);
      else setNewsRefreshing(true);
      try {
        const params = new URLSearchParams({
          symbol: newsSymbol,
          market: newsMarket,
          exchange: newsExchange,
        });
        const response = await fetch(`/api/features/news?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const body = response.ok
          ? await response.json()
          : { items: [], refreshedAt: null };
        if (active && !controller.signal.aborted) {
          setNews(body.items);
          setNewsUpdatedAt(body.refreshedAt || new Date().toISOString());
        }
      } catch (reason) {
        if (
          active &&
          !(reason instanceof DOMException && reason.name === "AbortError")
        ) {
          onNoticeRef.current("뉴스를 갱신하지 못했어요. 잠시 후 다시 시도할게요.");
        }
      } finally {
        if (active && !controller.signal.aborted) {
          setNewsLoading(false);
          setNewsRefreshing(false);
        }
      }
    };

    void loadNews(selectionChanged);
    const interval = window.setInterval(() => void loadNews(false), 300_000);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(interval);
    };
  }, [activeTab, newsExchange, newsMarket, newsRefreshKey, newsSymbol]);

  async function mutate(url: string, options: RequestInit, message: string) {
    if (!authenticated) {
      location.href = "/api/auth/google/login?return_to=%2F";
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(url, {
        ...options,
        credentials: "include",
        headers: { "Content-Type": "application/json", ...options.headers },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "요청을 처리하지 못했어요.");
      await load();
      onNotice(message);
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : "잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  async function addWatchlist() {
    if (!selected) return;
    await mutate(
      "/api/features/watchlist",
      {
        method: "POST",
        body: JSON.stringify({
          symbol: selected.symbol,
          market: selected.market,
          exchange: selected.exchange,
        }),
      },
      `${selected.name}을 관심종목에 저장했어요.`,
    );
  }

  async function addAlert(event: FormEvent) {
    event.preventDefault();
    if (!selected || !targetPrice) return;
    await mutate(
      "/api/features/alerts",
      {
        method: "POST",
        body: JSON.stringify({
          symbol: selected.symbol,
          market: selected.market,
          exchange: selected.exchange,
          direction,
          targetPrice: Number(targetPrice),
        }),
      },
      `${selected.name} 가격 알림을 만들었어요.`,
    );
  }

  async function togglePush() {
    if (!authenticated) {
      location.href = "/api/auth/google/login?return_to=%2F";
      return;
    }
    if (pushPermission === "denied") {
      onNotice("브라우저 주소창의 사이트 설정에서 알림을 허용해 주세요.");
      return;
    }
    setBusy(true);
    try {
      if (thisDeviceEnabled) {
        const token = await disableBrowserPush();
        if (token) {
          await fetch("/api/features/push/devices/remove", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
          });
        }
        localStorage.removeItem("stockpilot_push_enabled");
        setThisDeviceEnabled(false);
        onNotice("이 브라우저의 푸시 알림을 껐어요.");
      } else {
        const token = await enableBrowserPush();
        await registerToken(token);
        localStorage.setItem("stockpilot_push_enabled", "1");
        setPushPermission("granted");
        setThisDeviceEnabled(true);
        onNotice("푸시 알림을 켰어요. 목표가에 도달하면 알려드릴게요.");
      }
      await load();
    } catch (reason) {
      setPushPermission(browserPushState());
      onNotice(
        reason instanceof Error
          ? reason.message
          : "푸시 알림을 설정하지 못했어요.",
      );
    } finally {
      setBusy(false);
    }
  }

  const report = data?.report;
  const completed = data?.missions.filter((mission) => mission.completed).length ?? 0;

  return (
    <section className="investor-tools" id="investor-tools">
      <div className="section-head tools-head">
        <div>
          <h2>나의 투자 도구</h2>
          <p>관심종목부터 성과 리포트와 미션까지 한곳에서 관리해요</p>
        </div>
        <span className="tool-live"><BellRing size={13} /> 시세 15초 · 뉴스 5분</span>
      </div>

      <div className="tool-tabs">
        <button className={activeTab === "WATCH" ? "active" : ""} onClick={() => setActiveTab("WATCH")}>
          <Bookmark size={15} /> 관심·알림
          {!!data?.alerts.filter((item) => item.status === "TRIGGERED").length && <i />}
        </button>
        <button className={activeTab === "REPORT" ? "active" : ""} onClick={() => setActiveTab("REPORT")}>
          <LineChart size={15} /> 투자 리포트
        </button>
        <button className={activeTab === "MISSION" ? "active" : ""} onClick={() => setActiveTab("MISSION")}>
          <Target size={15} /> 미션 {completed}/{data?.missions.length || 6}
        </button>
        <button className={activeTab === "NEWS" ? "active" : ""} onClick={() => setActiveTab("NEWS")}>
          <Newspaper size={15} /> 종목 뉴스
        </button>
      </div>

      {!authenticated ? (
        <div className="tools-login">
          <span>🧭</span>
          <div><b>로그인하면 나만의 투자 도구가 열려요</b><p>관심종목, 가격 알림, 리포트와 미션이 계정에 저장됩니다.</p></div>
          <a href="/api/auth/google/login?return_to=%2F">Google로 시작하기</a>
        </div>
      ) : !data ? (
        <div className="company-loading"><RefreshCw className="spin" size={18} /> 투자 도구를 준비하고 있어요</div>
      ) : activeTab === "WATCH" ? (
        <div className="watch-tools-grid">
          <div className="saved-watchlist">
            <div className="tool-card-title">
              <span><Bookmark size={16} /><b>관심종목</b></span>
              <button disabled={busy || !selected} onClick={addWatchlist}>+ 현재 종목 저장</button>
            </div>
            {data.watchlist.length ? (
              <div className="saved-items">
                {data.watchlist.map((item) => (
                  <div key={item.id}>
                    <button className="saved-stock" onClick={() => onSelect(item)}>
                      <span><b>{item.name}</b><small>{item.symbol} · {item.exchange}</small></span>
                      <span>
                        <b>{item.price == null ? "—" : money(item.price, item.currency)}</b>
                        <small className={(item.changePercent ?? 0) >= 0 ? "up" : "down"}>
                          {item.changePercent == null ? "" : `${item.changePercent >= 0 ? "+" : ""}${item.changePercent.toFixed(2)}%`}
                        </small>
                      </span>
                      <ChevronRight size={14} />
                    </button>
                    <button
                      className="remove-tool"
                      aria-label={`${item.name} 관심종목 삭제`}
                      onClick={() => mutate(`/api/features/watchlist/${item.id}`, { method: "DELETE" }, "관심종목에서 삭제했어요.")}
                    ><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            ) : <p className="tool-empty">자주 보는 종목을 저장해 보세요.</p>}
          </div>

          <div className="alert-maker">
            <div className="tool-card-title">
              <span><BellRing size={16} /><b>가격 알림</b></span>
              <button
                type="button"
                className={`push-toggle ${thisDeviceEnabled ? "enabled" : ""} ${pushPermission === "denied" ? "blocked" : ""}`}
                disabled={busy || !data.push.configured || pushPermission === "unsupported"}
                onClick={togglePush}
              >
                {pushPermission === "unsupported"
                  ? "지원하지 않는 브라우저"
                  : pushPermission === "denied"
                    ? "브라우저에서 차단됨"
                    : thisDeviceEnabled
                      ? "이 기기 알림 켜짐"
                      : "푸시 알림 켜기"}
              </button>
            </div>
            <form onSubmit={addAlert}>
              <p>{selected ? `${selected.name} · ${money(selected.price, selected.currency)}` : "종목을 먼저 선택하세요"}</p>
              <div>
                <select value={direction} onChange={(event) => setDirection(event.target.value as "ABOVE" | "BELOW")}>
                  <option value="ABOVE">이 가격 이상</option>
                  <option value="BELOW">이 가격 이하</option>
                </select>
                <input
                  aria-label="목표 가격"
                  type="number"
                  min="0.01"
                  step={selected?.currency === "KRW" ? "1" : "0.01"}
                  inputMode="decimal"
                  required
                  value={targetPrice}
                  onChange={(event) => setTargetPrice(event.target.value)}
                />
                <button disabled={busy || !selected}>알림 만들기</button>
              </div>
            </form>
            <div className="alert-list">
              {data.alerts.slice(0, 5).map((item) => (
                <article className={item.status === "TRIGGERED" ? "triggered" : ""} key={item.id}>
                  <span className="alert-state">{item.status === "TRIGGERED" ? <BellRing size={14} /> : <Target size={14} />}</span>
                  <span><b>{item.name}</b><small>{item.direction === "ABOVE" ? "이상" : "이하"} {money(item.targetPrice, item.currency)}</small></span>
                  <em>{item.status === "TRIGGERED" ? "도달" : "감시 중"}</em>
                  <button aria-label={`${item.name} 알림 삭제`} onClick={() => mutate(`/api/features/alerts/${item.id}`, { method: "DELETE" }, "가격 알림을 삭제했어요.")}><Trash2 size={12} /></button>
                </article>
              ))}
            </div>
          </div>
        </div>
      ) : activeTab === "REPORT" && report ? (
        <div className="report-tools">
          <article className="return-report">
            <small>통합 누적 수익률</small>
            <strong className={report.returnRate.combined >= 0 ? "up" : "down"}>
              {report.returnRate.combined >= 0 ? "+" : ""}{report.returnRate.combined.toFixed(2)}%
            </strong>
            <Sparkline values={report.history.map((item) => item.returnRate)} />
            <div><span>한국 <b>{report.returnRate.KRW.toFixed(2)}%</b></span><span>미국 <b>{report.returnRate.USD.toFixed(2)}%</b></span></div>
          </article>
          <article className="trade-report">
            <span><small>체결 주문</small><b>{report.tradeCount}건</b></span>
            <span><small>매도 승률</small><b>{report.winRate.toFixed(0)}%</b></span>
            <span><small>실현손익</small><b>{money(report.realizedPnl.KRW, "KRW")}<em>{money(report.realizedPnl.USD, "USD")}</em></b></span>
            <span><small>모의 비용</small><b>{money(report.totalCosts.KRW, "KRW")}<em>{money(report.totalCosts.USD, "USD")}</em></b></span>
          </article>
          <article className="allocation-report">
            <b>보유 비중</b>
            {report.allocations.length ? report.allocations.slice(0, 6).map((item) => (
              <div key={`${item.market}:${item.symbol}`}>
                <span>{item.name}<small>{item.market}</small></span>
                <b>{money(item.value, item.currency)}</b>
              </div>
            )) : <p className="tool-empty">보유 종목이 생기면 투자 비중을 분석해 드려요.</p>}
          </article>
        </div>
      ) : activeTab === "NEWS" ? (
        <div className="stock-news">
          <div className="stock-news-head">
            <span><Newspaper size={16} /><b>{selected?.name || "선택 종목"} 뉴스</b></span>
            <span className="news-refresh-status">
              <small>
                5분마다 자동 갱신
                {newsUpdatedAt
                  ? ` · ${new Intl.DateTimeFormat("ko-KR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(new Date(newsUpdatedAt))}`
                  : ""}
              </small>
              <button
                type="button"
                aria-label="뉴스 지금 갱신"
                onClick={() => setNewsRefreshKey((value) => value + 1)}
                disabled={newsLoading || newsRefreshing}
              >
                <RefreshCw className={newsRefreshing ? "spin" : ""} size={13} />
              </button>
            </span>
          </div>
          {newsLoading ? (
            <div className="company-loading"><RefreshCw className="spin" size={16} /> 뉴스를 불러오고 있어요</div>
          ) : news.length ? (
            <div className="news-list">
              {news.map((item) => (
                <article key={item.id}>
                  <span><b>{item.title}</b><small>{item.source || "KIS"} · {item.date || "최근"}</small></span>
                  <Newspaper size={13} />
                </article>
              ))}
            </div>
          ) : (
            <p className="tool-empty">현재 KIS에서 조회된 이 종목의 뉴스가 없어요.</p>
          )}
          <p className="news-note">한국투자증권 KIS 제공 · 뉴스 제목은 정보 확인용이며 투자 권유가 아닙니다.</p>
        </div>
      ) : (
        <div className="mission-grid">
          {data.missions.map((mission) => (
            <article className={mission.completed ? "completed" : ""} key={mission.key}>
              <span>{mission.completed ? <Check size={16} /> : <Trophy size={16} />}</span>
              <div><b>{mission.title}</b><p>{mission.description}</p></div>
              <strong>{mission.progress}/{mission.goal}</strong>
              <i><span style={{ width: `${(mission.progress / mission.goal) * 100}%` }} /></i>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

