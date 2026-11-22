"use client";

import { memo, useMemo, useState } from "react";
import { ArrowUpRight, ChevronDown, RotateCw, SlidersHorizontal, Star } from "lucide-react";

import StockRow from "./StockRow";

export type WatchlistItem = {
  id: string;
  symbol: string;
  name: string;
  market: "KR" | "US";
  currency: "KRW" | "USD";
  exchange: string;
  logoUrl?: string | null;
  price?: number;
  changePercent?: number;
};

type Props = {
  items: WatchlistItem[];
  selectedId: string;
  onSelect: (item: WatchlistItem) => void;
  onRemove: (item: WatchlistItem) => void;
  accountSaved?: boolean;
  loadState?: "loading" | "error" | "ready";
  errorMessage?: string;
  onRetry?: () => void;
  retryDisabled?: boolean;
  dedicated?: boolean;
};

function MarketWatchlist({ items, selectedId, onSelect, onRemove, accountSaved, loadState = "ready", errorMessage, onRetry, retryDisabled, dedicated }: Props) {
  const [market, setMarket] = useState("ALL");
  const [sort, setSort] = useState("saved");
  const [query, setQuery] = useState("");
  const hasFilters = Boolean(query || market !== "ALL" || sort !== "saved");
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase().replace(/\s+/g, "");
    const result = items.filter(item => (market === "ALL" || item.market === market)
      && (!needle || [item.name,item.symbol,item.exchange].some(value=>value?.toLocaleLowerCase().replace(/\s+/g, "").includes(needle))));
    if (sort === "name") result.sort((a, b) => a.name.localeCompare(b.name, "ko"));
    if (sort === "change" || sort === "decline") result.sort((a, b) => {
      const av = a.changePercent, bv = b.changePercent;
      const aValid = typeof av === "number" && Number.isFinite(av);
      const bValid = typeof bv === "number" && Number.isFinite(bv);
      return aValid && bValid ? (sort === "decline" ? av - bv : bv - av) : aValid ? -1 : bValid ? 1 : 0;
    });
    return result;
  }, [items, market, sort, query]);
  return (
    <section className="favorite-board watchlist-board" aria-labelledby="favorite-board-title" aria-busy={loadState === "loading"}>
      <div className="favorite-board-head">
        <div>
          <h2 id="favorite-board-title">{dedicated ? "저장한 종목" : "내 관심종목"}</h2>
        </div>
        <div className="watchlist-header-actions">
          <small className="watchlist-source">{loadState === "loading" ? "저장 목록 확인 중" : loadState === "error" ? "저장 상태 확인 필요" : `${items.length}/${accountSaved?50:12} · ${accountSaved?"내 계정":"이 브라우저"}`}</small>
          {dedicated ? <a className="watchlist-action" href="#search-card">종목 찾기 <ArrowUpRight size={15} aria-hidden="true" /></a> : null}
        </div>
      </div>
      {loadState === "error" ? (
        <div className="watchlist-feedback">
          <div role="alert">
            <b>{items.length ? "저장 목록을 다시 확인해 주세요." : "저장된 관심종목을 확인하지 못했어요."}</b>
            <p>{errorMessage || (items.length ? "마지막으로 확인한 목록을 표시하고 있어요." : "다시 조회하면 저장된 종목을 확인할 수 있어요.")}</p>
          </div>
          {onRetry ? <button className="watchlist-action" type="button" disabled={retryDisabled} onClick={onRetry}><RotateCw size={15} aria-hidden="true" /> 다시 조회</button> : null}
        </div>
      ) : null}
      {items.length > 0 && <div className="watchlist-toolbar">
        <details className="watchlist-filter-disclosure">
          <summary><SlidersHorizontal size={16} aria-hidden="true" /> 검색·정렬{hasFilters ? <span className="watchlist-filter-active">적용 중</span> : null}<ChevronDown size={16} aria-hidden="true" /></summary>
          <div className="watchlist-fields">
        <label className="watchlist-query">관심종목 찾기<input type="search" value={query} maxLength={100} placeholder="회사명·종목 코드" onChange={e=>setQuery(e.target.value)}/></label>
        <label>시장<select value={market} onChange={e => setMarket(e.target.value)}><option value="ALL">전체</option><option value="KR">한국</option><option value="US">미국</option></select></label>
        <label>정렬<select value={sort} onChange={e => setSort(e.target.value)}><option value="saved">저장 순서</option><option value="name">이름순</option><option value="change">등락률 높은순</option><option value="decline">등락률 낮은순</option></select></label>
          </div>
        </details>
        <div className="watchlist-scope">
        <small role="status" aria-live="polite">{visible.length === items.length ? `${visible.length}개 표시` : `전체 ${items.length}개 중 ${visible.length}개 표시`}</small>
        {hasFilters && <button type="button" onClick={()=>{setQuery("");setMarket("ALL");setSort("saved");}}>조건 초기화</button>}
        </div>
      </div>}
      {items.length ? (
        <div className="favorite-strip watchlist-rows">
          {visible.length === 0 && <p role="status">조건에 맞는 관심종목이 없어요. 검색어나 시장을 바꿔보세요.</p>}
          {visible.map((item) => (
            <StockRow
              key={item.id}
              stock={item}
              active={selectedId === item.id}
              saved
              onOpen={() => onSelect(item)}
              onSave={() => onRemove(item)}
            />
          ))}
        </div>
      ) : loadState === "loading" ? (
        <div className="favorite-empty" role="status"><p><b>관심종목을 불러오고 있어요.</b><span>계정의 저장 목록을 확인한 뒤 보여드릴게요.</span></p></div>
      ) : loadState === "ready" ? (
        <div className="favorite-empty">
          <span className="friendly-empty-icon">
            <Star size={23} aria-hidden="true" />
          </span>
          <p>
            <b>다시 보고 싶은 종목을 모아보세요.</b>
            <span>종목 옆 별을 누르면 여기에 저장돼요.</span>
          </p>
          {!dedicated ? <a className="watchlist-action" href="#search-card">종목 찾아보기</a> : null}
        </div>
      ) : null}
    </section>
  );
}

export default memo(MarketWatchlist);
