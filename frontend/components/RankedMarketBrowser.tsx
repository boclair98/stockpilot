"use client";
import { useEffect, useRef, useState } from "react";
import { RefreshCw, ChevronDown } from "lucide-react";
import StockRow from "./StockRow";
import { isInstrument } from "@/lib/instrument-identity";
type Stock = {
  id: string;
  symbol: string;
  name: string;
  englishName: string;
  market: "KR" | "US";
  currency: "KRW" | "USD";
  exchange: string;
  price: number;
  changePercent: number | null;
  marketCapEok?: number | null;
  marketCapUsd?: number | null;
  volume?: number | null;
  logoUrl?: string | null;
};
type Page = {
  items: Stock[];
  asOf: string;
  hasMore: boolean;
  nextOffset: number | null;
  partial: boolean;
};
async function load(
  market: "KR" | "US",
  metric: string,
  exchange: string,
  offset: number,
  snapshot: string | undefined,
  signal: AbortSignal,
): Promise<Page> {
  const params = new URLSearchParams({
    market,
    metric,
    exchange,
    limit: "20",
    offset: String(offset),
  });
  if (snapshot) params.set("snapshot", snapshot);
  const response = await fetch(`/api/toss-market/browse-rankings?${params}`, {
    signal,
  });
  if (!response.ok)
    throw new Error(
      response.status === 409
        ? "자료가 갱신됐어요. 새로고침해 주세요."
        : "목록을 불러오지 못했어요. 다시 시도해 주세요.",
    );
  const p = await response.json();
  if (!p || !Array.isArray(p.items) || typeof p.asOf !== "string" || !Number.isFinite(Date.parse(p.asOf)))
    throw new Error("확인 가능한 목록이 없어요.");
  const items = p.items.filter(
    (s: Stock) => isInstrument(s) && s.market === market && Number.isFinite(s.price) && s.price > 0,
  );
  const hasMore = p.hasMore === true && items.length > 0 && Number.isInteger(p.nextOffset) && p.nextOffset > offset;
  return {
    ...p,
    items,
    hasMore,
    nextOffset: hasMore ? p.nextOffset : null,
  };
}
export default function RankedMarketBrowser({
  selectedId,
  onSelect,
  savedIds,
  onSave,
}: {
  selectedId: string;
  onSelect: (item: Stock) => Promise<void>;
  savedIds: Set<string>;
  onSave: (item: Stock) => void;
}) {
  const [market, setMarket] = useState<"KR" | "US">("KR"),
    [metric, setMetric] = useState("CAP"),
    [data, setData] = useState<Page | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [exchange, setExchange] = useState("ALL");
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    const sync = () => {
      const desired =
        location.hash === "#us-top"
          ? "US"
          : location.hash === "#kr-top"
            ? "KR"
            : null;
      if (desired && desired !== market) {
        setData(null);
        setError("");
        setBusy(true);
        setMarket(desired);
        setExchange("ALL");
      }
    };
    const timer = setTimeout(sync, 0);
    window.addEventListener("hashchange", sync);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("hashchange", sync);
    };
  }, [market]);
  useEffect(() => {
    const c = new AbortController();
    request.current?.abort();
    request.current = c;
    setBusy(true);
    setError("");
    void load(market, metric, exchange, 0, undefined, c.signal)
      .then((d) => {
        if (!c.signal.aborted) setData(d);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (request.current === c) {
          request.current = null;
          setBusy(false);
        }
      });
    return () => request.current?.abort();
  }, [market, metric, exchange, attempt]);
  async function more() {
    if (!data?.hasMore || data.nextOffset === null || request.current) return;
    const c = new AbortController();
    request.current = c;
    setBusy(true);
    setError("");
    try {
      const next = await load(
        market,
        metric,
        exchange,
        data.nextOffset,
        data.asOf,
        c.signal,
      );
      if (c.signal.aborted) return;
      if (
        next.asOf !== data.asOf ||
        next.items.some((n) => data.items.some((s) => s.id === n.id))
      )
        throw new Error("순위가 바뀌었어요. 새로고침해 주세요.");
      setData({ ...next, items: [...data.items, ...next.items] });
    } catch (e) {
      if (!c.signal.aborted)
        setError(e instanceof Error ? e.message : "다시 시도해 주세요.");
    } finally {
      if (request.current === c) {
        request.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <section className="ranked-browser" aria-label="시장 종목 순위">
      <header>
        <div className="ranked-market-switch">
          {(["KR", "US"] as const).map((v) => (
            <button
              type="button"
              key={v}
              aria-pressed={market === v}
              onClick={() => {
                if (market === v) return;
                setData(null);
                setError("");
                setBusy(true);
                setMarket(v);
                setExchange("ALL");
              }}
            >
              {v === "KR" ? "한국" : "미국"}
            </button>
          ))}
        </div>
        <div className="ranked-metric-tabs" aria-label="순위 기준">
          {(
            [
              ["CAP", "시가총액"],
              ["VOLUME", "거래량"],
              ["UP", "상승률"],
              ["DOWN", "하락률"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={metric === value}
              onClick={() => {
                if (metric === value) return;
                setData(null);
                setError("");
                setBusy(true);
                setMetric(value);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          className="ranked-refresh"
          type="button"
          aria-label="순위 새로고침"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError("");
            setAttempt((v) => v + 1);
          }}
        >
          <RefreshCw size={16} />
        </button>
      </header>
      <div className="record-filters ranking-exchange-filter">
        <label>거래소<select aria-label="순위 거래소 필터" value={exchange} onChange={e => { setData(null); setExchange(e.target.value); }}>
          <option value="ALL">전체 거래소</option>
          {market === "KR" ? <><option value="KOSPI">코스피</option><option value="KOSDAQ">코스닥</option></> : <><option value="NAS">나스닥</option><option value="NYS">뉴욕증권거래소</option><option value="AMS">아멕스</option></>}
        </select></label>
      </div>
      <label className="ranked-sort">
        정렬 기준
        <select
          aria-label="종목 정렬 기준"
          value={metric}
          onChange={(e) => {
            setData(null);
            setError("");
            setBusy(true);
            setMetric(e.target.value);
          }}
        >
          <option value="CAP">시가총액</option>
          <option value="VOLUME">거래량</option>
          <option value="UP">상승률</option>
          <option value="DOWN">하락률</option>
        </select>
      </label>
      <p className="ranked-basis">
        {metric === "CAP"
          ? "시가총액이 큰 순서"
          : metric === "VOLUME"
            ? "거래량이 많은 순서"
            : metric === "UP"
              ? "전일 대비 상승률 순서"
              : "전일 대비 하락률 순서"}{" "}
        · 제공 자료 기준
      </p>
      <div
        className={`stock-list-heading${metric === "CAP" || metric === "VOLUME" ? " with-metric" : ""}`}
      >
        <span>종목</span>
        <span>현재가 · 전일 대비</span>
        {metric === "CAP" || metric === "VOLUME" ? (
          <span className="stock-metric-heading">
            {metric === "CAP" ? "시가총액" : "거래량"}
          </span>
        ) : null}
      </div>
      <ol className="ranked-list">
        {data?.items.map((s, i) => (
          <li key={s.id}>
            <StockRow
              stock={s}
              rank={i + 1}
              metric={
                metric === "VOLUME" && typeof s.volume === "number"
                  ? `${s.volume.toLocaleString("ko-KR")}주`
                  : metric === "CAP"
                    ? s.currency === "KRW" &&
                      typeof s.marketCapEok === "number" &&
                      Number.isFinite(s.marketCapEok)
                      ? `${s.marketCapEok.toLocaleString("ko-KR", { maximumFractionDigits: 0 })}억원`
                      : s.currency === "USD" &&
                          typeof s.marketCapUsd === "number" &&
                          Number.isFinite(s.marketCapUsd)
                        ? new Intl.NumberFormat("ko-KR", {
                            style: "currency",
                            currency: "USD",
                            notation: "compact",
                            maximumFractionDigits: 1,
                          }).format(s.marketCapUsd)
                        : "—"
                    : undefined
              }
              active={selectedId === s.id}
              saved={savedIds.has(s.id)}
              onOpen={() => void onSelect(s)}
              onSave={() => onSave(s)}
            />
          </li>
        ))}
      </ol>
      {busy ? (
        <p className="ranked-state" role="status">
          다음 자료 확인 중…
        </p>
      ) : null}
      {error ? (
        <div className="ranked-state" role="alert">
          <p>{error}</p>
          <button
            type="button"
            onClick={() =>
              error.includes("새로고침")
                ? setAttempt((v) => v + 1)
                : data?.hasMore
                  ? void more()
                  : setAttempt((v) => v + 1)
            }
          >
            다시 조회
          </button>
        </div>
      ) : null}
      {!busy && data?.items.length === 0 && !error ? (
        <p className="ranked-state">이 조건의 자료가 없어요.</p>
      ) : null}
      {data?.hasMore ? (
        <button
          className="ranked-more"
          type="button"
          disabled={busy}
          onClick={() => void more()}
        >
          <ChevronDown size={15} />
          20개 더 보기 · {data.items.length.toLocaleString("ko-KR")}개 조회
        </button>
      ) : null}
      {data ? (
        <p className="ranked-basis">
          {new Date(data.asOf).toLocaleTimeString("ko-KR", {
            hour: "2-digit",
            minute: "2-digit",
          })}{" "}
          조회{data.partial ? " · 일부 자료 지연" : ""}
          {!data.hasMore ? " · 제공 자료 끝" : ""}
        </p>
      ) : null}
    </section>
  );
}
