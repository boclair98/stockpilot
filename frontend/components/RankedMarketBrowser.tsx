"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { RefreshCw, ChevronDown, X, ArrowUpRight, Search } from "lucide-react";
import StockRow from "./StockRow";
import MarketLens from "./MarketLens";
import StockDirectory from "./StockDirectory";
import { BROWSE_METRICS, marketBrowseHref, navigateMarketBrowse, parseMarketBrowse, readMarketBrowse, serverMarketBrowse, subscribeMarketBrowse } from "@/lib/market-browse";
import { EMPTY_MARKET_LENS, filterRankedStocks, type MarketLensValue } from "@/lib/market-lens";
import { type InstrumentIdentity } from "@/lib/instrument-identity";
import { ApiRequestError, requestJson } from "@/lib/reliable-request";
import { normalizeRankingPage, rankingComparisonHref, toggleComparison, type RankedStock, type RankingPage } from "@/lib/ranking-comparison";
type Stock = RankedStock;
type Page = RankingPage;
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
  try {
    const payload = await requestJson<unknown>(`/api/toss-market/browse-rankings?${params}`, { signal, cache: "no-store" }, 15_000);
    return normalizeRankingPage(payload, market, offset);
  } catch (cause) {
    if (cause instanceof ApiRequestError && cause.status === 409) throw new Error("자료가 갱신됐어요. 새로고침해 주세요.");
    throw cause;
  }
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
  const browseLocation = useSyncExternalStore(subscribeMarketBrowse, readMarketBrowse, serverMarketBrowse);
  const {market, metric, exchange} = parseMarketBrowse(browseLocation);
  const queryKey = `${market}:${metric}:${exchange}`;
  const [loadedData, setData] = useState<(Page & {queryKey: string}) | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [comparison, setComparison] = useState<InstrumentIdentity[]>([]);
  const [selectionNotice, setSelectionNotice] = useState("");
  const data = loadedData?.queryKey === queryKey ? loadedData : null;
  const [lensState, setLensState] = useState<{market: "KR" | "US"; value: MarketLensValue}>({market: "KR", value: {...EMPTY_MARKET_LENS}});
  const lens = lensState.market === market ? lensState.value : EMPTY_MARKET_LENS;
  const setLens = (value: MarketLensValue) => setLensState({market, value});
  const [failedPage, setFailedPage] = useState<"first" | "more" | null>(null);
  const request = useRef<AbortController | null>(null);
  const comparisonHref = rankingComparisonHref(comparison);
  const filtered = filterRankedStocks(data?.items ?? [], lens, savedIds, market === "KR" ? "KRW" : "USD");
  function selectForComparison(item: Stock | InstrumentIdentity) {
    const next = toggleComparison(comparison, item);
    setComparison(next.items);
    setSelectionNotice(next.message);
  }
  useEffect(() => {
    if (metric === "ALL" || parseMarketBrowse(readMarketBrowse()).metric === "ALL") return;
    const c = new AbortController();
    request.current?.abort();
    request.current = c;
    // Synchronize the pending state with this external, abortable ranking query.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBusy(true);
    setError("");
    setFailedPage(null);
    void load(market, metric, exchange, 0, undefined, c.signal)
      .then((d) => {
        if (!c.signal.aborted) setData({...d, queryKey});
      })
      .catch((e) => {
        if (!c.signal.aborted) { setError(e instanceof Error ? e.message : "목록을 확인하지 못했어요."); setFailedPage("first"); }
      })
      .finally(() => {
        if (request.current === c) {
          request.current = null;
          setBusy(false);
        }
      });
    return () => request.current?.abort();
  }, [market, metric, exchange, attempt, queryKey]);
  async function more() {
    if (metric === "ALL" || !data?.hasMore || data.nextOffset === null || request.current) return;
    const c = new AbortController();
    request.current = c;
    setBusy(true);
    setError("");
    setFailedPage(null);
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
      setData({ ...next, items: [...data.items, ...next.items], queryKey });
    } catch (e) {
      if (!c.signal.aborted) {
        setError(e instanceof Error ? e.message : "다시 시도해 주세요.");
        setFailedPage("more");
      }
    } finally {
      if (request.current === c) {
        request.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <section className={`ranked-browser broker-rankings${metric === "ALL" ? " is-directory" : ""}`} aria-label="시장 종목 탐색">
      <div className="market-discovery-heading"><div><span>MARKET DISCOVERY</span><h2>주식 골라보기</h2></div></div>
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
                navigateMarketBrowse(marketBrowseHref(browseLocation, {market: v, exchange: "ALL"}));
                setLens({ ...EMPTY_MARKET_LENS });
              }}
            >
              {v === "KR" ? "한국" : "미국"}
            </button>
          ))}
        </div>
        <div className="ranked-metric-tabs" aria-label="종목 탐색 방식">
          {BROWSE_METRICS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={metric === value}
              onClick={() => {
                if (metric === value) return;
                setData(null);
                setError("");
                setBusy(true);
                navigateMarketBrowse(marketBrowseHref(browseLocation, {metric: value}));
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {metric !== "ALL" ? <><button
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
      <div className="record-filters ranking-exchange-filter">
        <label>거래소<select aria-label="순위 거래소 필터" value={exchange} onChange={e => { setData(null); navigateMarketBrowse(marketBrowseHref(browseLocation, {exchange: e.target.value})); }}>
          <option value="ALL">전체 거래소</option>
          {market === "KR" ? <><option value="KOSPI">코스피</option><option value="KOSDAQ">코스닥</option></> : <><option value="NAS">나스닥</option><option value="NYS">뉴욕증권거래소</option><option value="AMS">아멕스</option></>}
        </select></label>
      </div></> : null}
      </header>
      {metric === "ALL" ? <StockDirectory embedded /> : <>
      <label className="ranked-sort">
        정렬 기준
        <select
          aria-label="종목 정렬 기준"
          value={metric}
          onChange={(e) => {
            setData(null);
            setError("");
            setBusy(true);
            navigateMarketBrowse(marketBrowseHref(browseLocation, {metric: e.target.value as typeof metric}));
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
      <section className={`ranking-comparison${comparison.length ? " has-selection" : " is-empty"}`} aria-labelledby="ranking-comparison-title">
        <div className="ranking-comparison-heading"><div><h3 id="ranking-comparison-title">함께 비교하기 <span>{comparison.length}/3</span></h3><p>종목 옆 비교 버튼으로 2~3개를 골라보세요.</p></div>
          {comparison.length ? <button className="ranking-comparison-clear" type="button" onClick={() => { setComparison([]); setSelectionNotice("비교 선택을 모두 해제했어요."); }}>선택 초기화</button> : null}
        </div>
        {comparison.length ? <ul className="ranking-comparison-items">{comparison.map(item => <li key={item.id}><span><b>{item.name}</b><small>{item.symbol} · {item.exchange}</small></span><button type="button" aria-label={`${item.name} 비교 선택 해제`} onClick={() => selectForComparison(item)}><X size={16} aria-hidden="true" /></button></li>)}</ul> : null}
        {comparison.length ? <div className="ranking-comparison-action">{comparisonHref ? <Link href={comparisonHref}>선택한 {comparison.length}개 비교 <ArrowUpRight size={16} aria-hidden="true" /></Link> : <button type="button" disabled>2개부터 비교할 수 있어요</button>}<small>계좌·보유 정보는 전달하지 않아요.</small></div> : null}
        <p className="ranking-selection-status" role="status">{selectionNotice}</p>
      </section>
      <MarketLens items={data?.items ?? []} value={lens} currency={market === "KR" ? "KRW" : "USD"} matched={filtered.items.length} error={filtered.error} onChange={setLens}/>
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
        {filtered.items.map(({ stock: s, rank }) => (
          <li key={s.id}>
            <StockRow
              stock={s}
              rank={rank}
              metric={
                metric === "VOLUME"
                  ? s.volume !== null ? `${s.volume.toLocaleString("ko-KR")}주` : "—"
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
              metricLabel={metric === "CAP" ? "시가총액" : metric === "VOLUME" ? "거래량" : undefined}
              compared={comparison.some(item => item.id === s.id)}
              onCompare={() => selectForComparison(s)}
              onOpen={() => void onSelect(s)}
              onSave={() => onSave(s)}
            />
          </li>
        ))}
      </ol>
      {busy ? (
        <p className="ranked-state" role="status">
          {data?.items.length ? "다음 자료 확인 중…" : "순위를 확인하고 있어요…"}
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
                : failedPage === "more" && data?.hasMore
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
      {!busy && Boolean(data?.items.length) && filtered.items.length === 0 && !error ? <div className="ranked-state lens-empty"><Search size={24} aria-hidden="true"/><b>{filtered.error ? "가격 조건을 확인해 주세요" : "현재 목록에서 찾지 못했어요"}</b><p>{data?.hasMore ? "조건을 바꾸거나 다음 20개를 불러와 더 살펴보세요." : "다른 조건이나 전체 종목 검색으로 찾아보세요."}</p><button type="button" onClick={() => setLens({ ...EMPTY_MARKET_LENS })}>조건 초기화</button></div> : null}
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
      {comparisonHref && data?.items.length ? <div className="ranking-comparison-bottom"><span>{comparison.length}개 종목 선택</span><Link href={comparisonHref}>나란히 비교하기 <ArrowUpRight size={16} aria-hidden="true" /></Link><button type="button" aria-label="비교 선택 모두 해제" onClick={() => { setComparison([]); setSelectionNotice("비교 선택을 모두 해제했어요."); }}><X size={17} aria-hidden="true"/></button></div> : null}
      </>}
    </section>
  );
}
