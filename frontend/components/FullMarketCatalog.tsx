"use client";

import { useCallback, useRef, useState } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import StockRow from "./StockRow";

type Market = "KR" | "US";
type Instrument = {
  id: string;
  symbol: string;
  name: string;
  englishName: string;
  market: Market;
  currency: "KRW" | "USD";
  exchange: string;
  listingMarket?: string;
  logoUrl?: string | null;
};
type CatalogPage = {
  items: Instrument[];
  total: number;
  hasMore: boolean;
  nextOffset: number | null;
  partial: boolean;
};

async function getPage(
  market: Market,
  exchange: string,
  offset: number,
  signal: AbortSignal,
): Promise<CatalogPage> {
  const params = new URLSearchParams({
    market,
    exchange,
    offset: String(offset),
    limit: "20",
  });
  const response = await fetch(`/api/toss-market/instruments?${params}`, {
    signal,
  });
  if (!response.ok)
    throw new Error("종목 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
  const payload = await response.json();
  if (
    !Array.isArray(payload.items) ||
    !Number.isInteger(payload.total) ||
    payload.total < 0
  )
    throw new Error("종목 목록을 확인할 수 없어요.");
  const items = payload.items.filter(
    (item: Instrument) =>
      item.market === market &&
      item.currency === (market === "KR" ? "KRW" : "USD") &&
      typeof item.id === "string" &&
      typeof item.symbol === "string" &&
      typeof item.name === "string" &&
      typeof item.exchange === "string",
  );
  const nextOffset = payload.nextOffset;
  const canContinue =
    !payload.partial &&
    Boolean(payload.hasMore) &&
    items.length > 0 &&
    Number.isInteger(nextOffset) &&
    nextOffset > offset;
  return {
    items,
    total: payload.total,
    hasMore: canContinue,
    nextOffset: canContinue ? nextOffset : null,
    partial: Boolean(payload.partial),
  };
}

export default function FullMarketCatalog({
  selectedId,
  savedIds,
  onSelect,
  onSave,
}: {
  selectedId: string;
  savedIds: Set<string>;
  onSelect: (item: Instrument) => Promise<void>;
  onSave: (item: Instrument) => void;
}) {
  const [open, setOpen] = useState(false);
  const [market, setMarket] = useState<Market>("KR");
  const [exchange, setExchange] = useState("ALL");
  const [items, setItems] = useState<Instrument[]>([]);
  const [total, setTotal] = useState(0);
  const [partial, setPartial] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const activeRequest = useRef<AbortController | null>(null);

  const fetchFirst = useCallback(
    async (nextMarket: Market, nextExchange: string) => {
      activeRequest.current?.abort();
      const controller = new AbortController();
      activeRequest.current = controller;
      setBusy(true);
      setError("");
      try {
        const page = await getPage(nextMarket, nextExchange, 0, controller.signal);
        if (controller.signal.aborted) return;
        setItems(page.items);
        setTotal(page.total);
        setPartial(page.partial);
        setHasMore(page.hasMore);
        setNextOffset(page.nextOffset);
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "종목 목록을 불러오지 못했어요.",
          );
      } finally {
        if (activeRequest.current === controller) {
          activeRequest.current = null;
          setBusy(false);
        }
      }
    },
    [],
  );

  async function loadMore() {
    if (!hasMore || nextOffset === null || busy || partial) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    setBusy(true);
    setError("");
    try {
      const page = await getPage(market, exchange, nextOffset, controller.signal);
      if (controller.signal.aborted) return;
      const ids = new Set(items.map((item) => item.id));
      if (page.items.some((item) => ids.has(item.id))) {
        throw new Error("목록이 바뀌었어요. 새로고침한 뒤 다시 살펴봐 주세요.");
      }
      setItems((current) => [...current, ...page.items]);
      setTotal(page.total);
      setPartial(page.partial);
      setHasMore(page.hasMore);
      setNextOffset(page.nextOffset);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : "다음 종목을 불러오지 못했어요.",
        );
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setBusy(false);
      }
    }
  }

  const exchanges =
    market === "KR"
      ? [
          ["ALL", "전체 거래소"],
          ["KOSPI", "코스피"],
          ["KOSDAQ", "코스닥"],
        ]
      : [
          ["ALL", "전체 거래소"],
          ["NAS", "나스닥"],
          ["NYS", "뉴욕증권거래소"],
          ["AMS", "아멕스"],
        ];

  return (
    <details
      className="full-market-catalog"
      onToggle={(event) => {
        const isOpen = event.currentTarget.open;
        setOpen(isOpen);
        if (isOpen && !items.length && !busy && !error)
          void fetchFirst(market, exchange);
      }}
    >
      <summary>
        <span>
          <b>국내·미국 전체 종목</b>
          <small>시장 순위와 별도로, 상장 종목을 20개씩 살펴봐요</small>
        </span>
        <ChevronDown size={19} aria-hidden="true" />
      </summary>
      {open ? (
        <div className="full-market-catalog-content">
          <div className="catalog-controls">
            <div className="ranked-market-switch" aria-label="시장 선택">
              {(["KR", "US"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={market === value}
                  onClick={() => {
                    if (market === value) return;
                    const nextExchange = "ALL";
                    setMarket(value);
                    setExchange(nextExchange);
                    setItems([]);
                    setTotal(0);
                    setPartial(false);
                    setHasMore(false);
                    setNextOffset(null);
                    void fetchFirst(value, nextExchange);
                  }}
                >
                  {value === "KR" ? "한국" : "미국"}
                </button>
              ))}
            </div>
            <label>
              거래소
              <select
                aria-label="전체 종목 거래소 필터"
                value={exchange}
                onChange={(event) => {
                  const value = event.target.value;
                  setExchange(value);
                  setItems([]);
                  setTotal(0);
                  setPartial(false);
                  setHasMore(false);
                  setNextOffset(null);
                  void fetchFirst(market, value);
                }}
              >
                {exchanges.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="catalog-refresh"
              type="button"
              aria-label="전체 종목 다시 조회"
              disabled={busy}
              onClick={() => void fetchFirst(market, exchange)}
            >
              <RefreshCw size={16} />
            </button>
          </div>
          <p className="catalog-note">
            거래소 종목 목록이에요. 종목을 누르면 해당 종목의 현재 시세를
            불러옵니다.
          </p>
          <div className="catalog-list-heading">
            <span>종목</span>
            <span>가격</span>
          </div>
          <ol className="ranked-list catalog-list">
            {items.map((item, index) => (
              <li key={item.id}>
                <StockRow
                  stock={item}
                  rank={index + 1}
                  active={selectedId === item.id}
                  saved={savedIds.has(item.id)}
                  onOpen={() => void onSelect(item)}
                  onSave={() => onSave(item)}
                />
              </li>
            ))}
          </ol>
          {busy ? (
            <p className="ranked-state" role="status">
              종목 목록을 확인하고 있어요…
            </p>
          ) : null}
          {error ? (
            <div className="ranked-state" role="alert">
              <p>{error}</p>
              <button type="button" onClick={() => void fetchFirst(market, exchange)}>
                다시 조회
              </button>
            </div>
          ) : null}
          {partial ? (
            <div className="ranked-state" role="status">
              일부 거래소 자료를 받지 못했어요. 지금 보이는 목록은 전체가 아닐 수
              있어요.
              <button type="button" onClick={() => void fetchFirst(market, exchange)}>
                다시 조회
              </button>
            </div>
          ) : null}
          {hasMore ? (
            <button
              className="ranked-more"
              type="button"
              disabled={busy}
              onClick={() => void loadMore()}
            >
              <ChevronDown size={15} />
              20개 더 보기 · {items.length.toLocaleString("ko-KR")}개 조회
            </button>
          ) : null}
          {!busy && !error && !partial && items.length === 0 ? (
            <p className="ranked-state">이 거래소에서 찾을 수 있는 종목이 없어요.</p>
          ) : null}
          {!busy && items.length > 0 ? (
            <p className="ranked-basis">
              {partial
                ? `현재 ${items.length.toLocaleString("ko-KR")}종목 표시 · 전체 자료 조회 필요`
                : `전체 ${total.toLocaleString("ko-KR")}종목 중 ${items.length.toLocaleString("ko-KR")}종목 표시`}
            </p>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}
