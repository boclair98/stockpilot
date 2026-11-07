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
import { ApiRequestError, requestJson } from "@/lib/reliable-request";
import { alertPrice, filterPriceAlerts, validAlertReadReceipt, validAlertScope, validPriceAlerts, type AlertScope, type PriceAlert } from "@/lib/price-alerts";
import { incompleteReportValuation, validInvestorReport, type InvestorReport } from "@/lib/investor-report";

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
  alerts: PriceAlert[];
  alertScope?: AlertScope;
  unreadAlerts: number;
  push: {
    configured: boolean;
    deviceCount: number;
  };
  report: InvestorReport | null;
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
  if (!values.length) return <p className="tool-empty">기록이 쌓이면 수익률 흐름을 확인할 수 있어요.</p>;
  return (
    <svg className="report-sparkline" viewBox="0 0 100 48" preserveAspectRatio="none">
      <polyline points={points} />
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
  const [dashboardError, setDashboardError] = useState("");
  const [newsError, setNewsError] = useState("");
  const dashboardRead = useRef<AbortController | null>(null);
  const writeLock = useRef(false);
  const [activeTab, setActiveTab] = useState<"WATCH" | "REPORT" | "MISSION" | "NEWS">("WATCH");
  const [targetPrice, setTargetPrice] = useState("");
  const [direction, setDirection] = useState<"ABOVE" | "BELOW">("ABOVE");
  const [busy, setBusy] = useState(false);
  const [alertQuery, setAlertQuery] = useState("");
  const [alertStatus, setAlertStatus] = useState("ALL");
  const [alertReadBusy, setAlertReadBusy] = useState(false);
  const [alertReadError, setAlertReadError] = useState("");
  const [alertReadMessage, setAlertReadMessage] = useState("");
  const [alertReadUncertain, setAlertReadUncertain] = useState(false);
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
  const alertSelection = useRef(selected);
  const selectedAlertIdentity = selected ? `${selected.market}:${selected.exchange}:${selected.symbol}` : "";
  const newsSelectionKey = useRef("");
  const onNoticeRef = useRef(onNotice);
  const onAlertSummaryRef = useRef(onAlertSummary);

  useEffect(() => {
    onNoticeRef.current = onNotice;
    onAlertSummaryRef.current = onAlertSummary;
  }, [onAlertSummary, onNotice]);

  const load = useCallback(async () => {
    dashboardRead.current?.abort();
    const controller = new AbortController();
    dashboardRead.current = controller;
    try {
    const next = await requestJson<Dashboard>("/api/features/dashboard", {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!next || typeof next.authenticated !== "boolean" || ![next.watchlist,next.missions].every(Array.isArray) || !validPriceAlerts(next.alerts) || !validAlertScope(next.alertScope) || !validInvestorReport(next.report) || !next.push || !Number.isSafeInteger(next.unreadAlerts) || next.unreadAlerts<0) throw new Error("투자 도구 응답을 확인하지 못했어요. 다시 조회해 주세요.");
    if (controller.signal.aborted) return false;
    setData(next);
    setDashboardError("");
    setAlertReadUncertain(false);
    setAlertReadError("");
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
    return true;
    } catch (reason) {
      if (!controller.signal.aborted) setDashboardError(reason instanceof Error ? reason.message : "투자 도구를 불러오지 못했어요.");
      return false;
    } finally {
      if (dashboardRead.current === controller) dashboardRead.current = null;
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => { if (!document.hidden && !dashboardRead.current && !writeLock.current) void load(); }, 15_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
      dashboardRead.current?.abort();
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
    }).catch(() => { /* Missing browser messaging support must not break the page. */ });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [load]);

  const registerToken = useCallback(async (token: string) => {
    await requestJson<unknown>("/api/features/push/devices", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
  }, []);

  useEffect(() => {
    if (!authenticated || typeof window === "undefined") return;
    try { if (localStorage.getItem("stockpilot_push_enabled") !== "1") return; }
    catch { return; } // Storage may be blocked; the user can enable push manually.
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
        ?.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? "auto" : "smooth", block: "start" });
      document.getElementById("price-alerts-title")?.focus?.();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [focusAlertsKey]);

  useEffect(() => { alertSelection.current = selected; }, [selected]);
  useEffect(() => {
    if (!selectedAlertIdentity || !alertSelection.current) return;
    if (alertSelectionKey.current === selectedAlertIdentity) return;
    alertSelectionKey.current = selectedAlertIdentity;
    const initialPrice = alertSelection.current.price;
    const timer = window.setTimeout(() => setTargetPrice(String(initialPrice)), 0);
    return () => window.clearTimeout(timer);
  }, [selectedAlertIdentity]);

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
      setNewsError("");
    }

    const loadNews = async (initial: boolean) => {
      controller?.abort();
      const request = new AbortController();
      controller = request;
      if (initial) setNewsLoading(true);
      else setNewsRefreshing(true);
      try {
        const params = new URLSearchParams({
          symbol: newsSymbol,
          market: newsMarket,
          exchange: newsExchange,
        });
        const body = await requestJson<{items: NewsItem[]; refreshedAt?: string | null}>(`/api/features/news?${params}`, {
          cache: "no-store",
          signal: request.signal,
        });
        if (!Array.isArray(body?.items) || !body.items.every(item => item && typeof item.id === "string" && typeof item.title === "string")) throw new Error("뉴스 응답을 확인하지 못했어요.");
        if (active && !request.signal.aborted) {
          setNews(body.items);
          setNewsUpdatedAt(typeof body.refreshedAt === "string" && Number.isFinite(Date.parse(body.refreshedAt)) ? body.refreshedAt : null);
          setNewsError("");
        }
      } catch {
        if (
          active &&
          !request.signal.aborted
        ) {
          setNewsError("뉴스를 갱신하지 못했어요. 다시 갱신해 주세요.");
          onNoticeRef.current("뉴스를 갱신하지 못했어요. 잠시 후 다시 시도할게요.");
        }
      } finally {
        if (active && !request.signal.aborted) {
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
    if (writeLock.current) return;
    writeLock.current = true;
    setBusy(true);
    try {
      await requestJson<unknown>(url, {
        ...options,
        credentials: "include",
        headers: { "Content-Type": "application/json", ...options.headers },
      });
      await load();
      onNotice(message);
    } catch (reason) {
      onNotice(reason instanceof ApiRequestError && reason.uncertain ? "처리 결과를 확인하지 못했어요. 같은 요청을 다시 보내기 전에 목록을 확인해 주세요." : reason instanceof Error ? reason.message : "잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
      writeLock.current = false;
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
    const target = Number(targetPrice);
    const scaled = target * (selected.currency === "KRW" ? 1 : 100);
    if (!Number.isFinite(target) || target <= 0 || target > 1_000_000_000_000 || Math.abs(scaled - Math.round(scaled)) > 0.000001) {
      onNotice(selected.currency === "KRW" ? "목표가는 0원보다 큰 정수로 입력해 주세요." : "목표가는 0달러보다 크고 소수점 둘째 자리까지 입력해 주세요.");
      return;
    }
    await mutate(
      "/api/features/alerts",
      {
        method: "POST",
        body: JSON.stringify({
          symbol: selected.symbol,
          market: selected.market,
          exchange: selected.exchange,
          direction,
          targetPrice: target,
        }),
      },
      `${selected.name} 가격 알림을 만들었어요.`,
    );
  }

  async function markAlertsRead() {
    if (!authenticated || !data?.authenticated || !data.unreadAlerts || writeLock.current || alertReadUncertain) return;
    writeLock.current=true;
    dashboardRead.current?.abort();
    setBusy(true);
    setAlertReadBusy(true);
    setAlertReadError("");
    setAlertReadMessage("");
    try {
      const receipt=await requestJson<unknown>("/api/features/alerts/read",{method:"POST",credentials:"include"});
      if(!validAlertReadReceipt(receipt)) throw new ApiRequestError("읽음 처리 결과를 확인하지 못했어요. 다시 처리하기 전에 목록을 조회해 주세요.",null,true);
      setAlertReadMessage(`도달한 알림 ${receipt.read}건을 읽음으로 처리했어요.`);
      await load();
    } catch(reason) {
      setAlertReadUncertain(reason instanceof ApiRequestError&&reason.uncertain);
      setAlertReadError(reason instanceof ApiRequestError&&reason.uncertain ? "읽음 처리 결과가 불확실해요. 같은 요청을 다시 보내기 전에 알림 목록을 조회해 주세요." : reason instanceof Error ? reason.message : "읽음 상태를 저장하지 못했어요. 알림 목록을 확인해 주세요.");
    } finally {
      writeLock.current=false;
      setBusy(false);
      setAlertReadBusy(false);
    }
  }

  async function togglePush() {
    if (writeLock.current) return;
    if (!authenticated) {
      location.href = "/api/auth/google/login?return_to=%2F";
      return;
    }
    if (pushPermission === "denied") {
      onNotice("브라우저 주소창의 사이트 설정에서 알림을 허용해 주세요.");
      return;
    }
    setBusy(true);
    writeLock.current = true;
    try {
      if (thisDeviceEnabled) {
        const token = await disableBrowserPush();
        if (token) {
          await requestJson<unknown>("/api/features/push/devices/remove", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
          });
        }
        try { localStorage.removeItem("stockpilot_push_enabled"); } catch { /* The server/device result remains authoritative. */ }
        setThisDeviceEnabled(false);
        onNotice("이 브라우저의 푸시 알림을 껐어요.");
      } else {
        const token = await enableBrowserPush();
        await registerToken(token);
        try { localStorage.setItem("stockpilot_push_enabled", "1"); } catch { /* This session can still receive notifications. */ }
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
      writeLock.current = false;
    }
  }

  const report = data?.report;
  const incompleteValuation = report ? incompleteReportValuation(report) : false;
  const completed = data?.missions.filter((mission) => mission.completed).length ?? 0;
  const visibleAlerts=useMemo(()=>filterPriceAlerts(data?.alerts||[],alertQuery,alertStatus),[data?.alerts,alertQuery,alertStatus]);

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

      {dashboardError && <div className="tool-read-error" role="alert"><p>{dashboardError}</p>{data && <p>이전에 불러온 기록을 표시하고 있어요.</p>}<button type="button" disabled={busy} onClick={() => void load()}>다시 조회</button></div>}
      {!authenticated || data?.authenticated===false ? (
        <div className="tools-login">
          <span>🧭</span>
          <div><b>로그인하면 나만의 투자 도구가 열려요</b><p>관심종목, 가격 알림, 리포트와 미션이 계정에 저장됩니다.</p></div>
          <a href="/api/auth/google/login?return_to=%2F">Google로 시작하기</a>
        </div>
      ) : !data && !dashboardError ? (
        <div className="company-loading"><RefreshCw className="spin" size={18} /> 투자 도구를 준비하고 있어요</div>
      ) : !data ? null : activeTab === "WATCH" ? (
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
              <span><BellRing size={16} /><b id="price-alerts-title" tabIndex={-1}>가격 알림</b></span>
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
                <select aria-label="가격 알림 조건" value={direction} onChange={(event) => setDirection(event.target.value as "ABOVE" | "BELOW")}>
                  <option value="ABOVE">이 가격 이상</option>
                  <option value="BELOW">이 가격 이하</option>
                </select>
                <input
                  aria-label="목표 가격"
                  type="number"
                  min={selected?.currency === "KRW" ? "1" : "0.01"}
                  step={selected?.currency === "KRW" ? "1" : "0.01"}
                  inputMode="decimal"
                  required
                  value={targetPrice}
                  onChange={(event) => setTargetPrice(event.target.value)}
                />
                <button disabled={busy || !selected}>알림 만들기</button>
              </div>
            </form>
            <div className="alert-management-actions">
              <button type="button" disabled={busy||!data.unreadAlerts||alertReadUncertain} onClick={()=>void markAlertsRead()}>{alertReadBusy?"읽음 처리 중…":`도달한 알림 모두 읽음${data.unreadAlerts?` (${data.unreadAlerts})`:""}`}</button>
              <button type="button" disabled={busy} onClick={()=>void load()}>알림 목록 다시 조회</button>
            </div>
            <p className="alert-list-scope">{data.alertScope?<>감시 중 {data.alertScope.activeCount}개 중 {data.alerts.filter(item=>item.status==="ACTIVE").length}개와 도달 기록 {data.alertScope.triggeredCount}개 중 최근 {data.alerts.filter(item=>item.status==="TRIGGERED").length}개를 불러왔어요. 도달 기록은 최근 {data.alertScope.recentTriggeredLimit}개까지 표시해요.{data.alertScope.activeHasMore?" 감시 중 목록도 일부만 표시 중이에요.":""}</>:<>불러온 알림 {data.alerts.length}개예요. 이전 서버에서는 전체 조회 범위를 제공하지 않아요.</>} 모두 읽음은 목록에 보이지 않는 도달 기록도 포함해요.</p>
            {alertReadMessage&&<p className="alert-read-status" role="status">{alertReadMessage}</p>}
            {alertReadError&&<p className="alert-read-status" role="alert">{alertReadError}</p>}
            <div className="alert-filters">
              <label>알림 종목 찾기<input type="search" maxLength={100} value={alertQuery} placeholder="회사명·종목 코드·거래소" onChange={event=>setAlertQuery(event.target.value)}/></label>
              <label>알림 상태<select value={alertStatus} onChange={event=>setAlertStatus(event.target.value)}><option value="ALL">전체</option><option value="ACTIVE">감시 중</option><option value="TRIGGERED">도달</option><option value="UNREAD">읽지 않은 도달</option></select></label>
            </div>
            <p className="alert-list-scope" role="status">불러온 {data.alerts.length}개 중 조건에 맞는 {visibleAlerts.length}개 표시 {(alertQuery||alertStatus!=="ALL")&&<button type="button" onClick={()=>{setAlertQuery("");setAlertStatus("ALL");}}>조건 초기화</button>}</p>
            <div className="alert-list" aria-label="가격 알림 목록" aria-busy={busy}>
              {visibleAlerts.map((item) => (
                <article className={item.status === "TRIGGERED" ? "triggered" : ""} key={item.id}>
                  <span className="alert-state">{item.status === "TRIGGERED" ? <BellRing size={14} /> : <Target size={14} />}</span>
                  <span className="alert-identity"><b>{item.name}</b><small>{item.symbol} · {item.market==="KR"?"한국":item.market==="US"?"미국":"시장 미제공"} · {item.exchange||"거래소 미제공"}</small><small>{item.direction === "ABOVE" ? "이상" : "이하"} {alertPrice(item.targetPrice, item.currency)}</small></span>
                  <em>{item.status === "TRIGGERED" ? item.read?"도달 · 읽음":"도달 · 안 읽음" : "감시 중"}</em>
                  <button type="button" disabled={busy} aria-label={`${item.name} ${item.exchange||item.symbol} ${alertPrice(item.targetPrice,item.currency)} ${item.direction==="ABOVE"?"이상":"이하"} 알림 삭제`} onClick={() => mutate(`/api/features/alerts/${item.id}`, { method: "DELETE" }, "가격 알림을 삭제했어요.")}><Trash2 size={12} /></button>
                </article>
              ))}
              {!visibleAlerts.length&&<p className="tool-empty">{data.alerts.length?"조건에 맞는 알림이 없어요. 검색어나 상태를 바꿔 주세요.":"아직 가격 알림이 없어요. 종목과 목표 가격을 선택해 만들어 보세요."}</p>}
            </div>
          </div>
        </div>
      ) : activeTab === "REPORT" && report ? (
        <div className="report-tools">
          <article className="return-report">
            <small>통합 누적 수익률</small>
            {incompleteValuation ? <>
              <strong>시세 확인 필요</strong>
              <p className="report-valuation-notice" role="status">보유 종목의 평가가 완전하지 않아 현재 수익률과 추이를 표시하지 않아요.
                {!!report.estimatedPositions && <> 시세 미확인 {report.estimatedPositions}종목은 매입금액 기준 참고액이에요.</>}
                {!!report.unavailablePositions && <> 종목 정보를 확인할 수 없는 {report.unavailablePositions}종목은 평가액에서 제외돼 있어요.</>}
              </p>
            </> : <>
            <strong className={report.returnRate.combined >= 0 ? "up" : "down"}>
              {report.returnRate.combined >= 0 ? "+" : ""}{report.returnRate.combined.toFixed(2)}%
            </strong>
            <Sparkline values={report.history.map((item) => item.returnRate)} />
            <div><span>한국 <b>{report.returnRate.KRW.toFixed(2)}%</b></span><span>미국 <b>{report.returnRate.USD.toFixed(2)}%</b></span></div>
            </>}
          </article>
          <article className="trade-report">
            <span><small>체결 주문</small><b>{report.tradeCount}건</b></span>
            <span><small>매도 승률</small><b>{report.winRate.toFixed(0)}%</b></span>
            <span><small>실현손익</small><b>{money(report.realizedPnl.KRW, "KRW")}<em>{money(report.realizedPnl.USD, "USD")}</em></b></span>
            <span><small>모의 비용</small><b>{money(report.totalCosts.KRW, "KRW")}<em>{money(report.totalCosts.USD, "USD")}</em></b></span>
          </article>
          <article className="allocation-report">
            <b>{incompleteValuation ? "보유 평가 · 참고" : "보유 비중"}</b>
            {report.allocations.length ? report.allocations.slice(0, 6).map((item) => (
              <div key={`${item.market}:${item.symbol}`}>
                <span>{item.name}<small>{item.market}</small></span>
                <b>{money(item.value, item.currency)}{item.valuationBasis === "COST" && <small className="allocation-reference">매입금액 기준 참고액</small>}</b>
              </div>
            )) : <p className="tool-empty">{report.unavailablePositions ? "종목 정보를 확인할 수 없어 보유 평가액을 표시하지 못했어요." : "보유 종목이 생기면 투자 비중을 분석해 드려요."}</p>}
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
          {newsError && <p role="alert" className="tool-read-error">{newsError}{news.length ? " 이전 뉴스는 아래에 유지하고 있어요." : ""}</p>}
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
          ) : !newsError ? (
            <p className="tool-empty">현재 KIS에서 조회된 이 종목의 뉴스가 없어요.</p>
          ) : null}
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

