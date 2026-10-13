"use client";

import { memo, useMemo, useState } from "react";
import { Star } from "lucide-react";

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
  colorFor: (symbol: string) => string;
  onSelect: (item: WatchlistItem) => void;
  onRemove: (item: WatchlistItem) => void;
};

function MarketWatchlist({ items, selectedId, onSelect, onRemove }: Props) {
  const [market, setMarket] = useState("ALL");
  const [sort, setSort] = useState("saved");
  const visible = useMemo(() => {
    const result = items.filter(item => market === "ALL" || item.market === market);
    if (sort === "name") result.sort((a, b) => a.name.localeCompare(b.name, "ko"));
    if (sort === "change") result.sort((a, b) => {
      const av = a.changePercent, bv = b.changePercent;
      const aValid = typeof av === "number" && Number.isFinite(av);
      const bValid = typeof bv === "number" && Number.isFinite(bv);
      return aValid && bValid ? bv - av : aValid ? -1 : bValid ? 1 : 0;
    });
    return result;
  }, [items, market, sort]);
  return (
    <section className="favorite-board" aria-labelledby="favorite-board-title">
      <div className="favorite-board-head">
        <div>
          <span>MY WATCHLIST</span>
          <h2 id="favorite-board-title">내 관심종목</h2>
        </div>
        <small>{items.length}/12 · 이 브라우저</small>
      </div>
      {items.length > 0 && <div className="record-filters">
        <label>시장<select value={market} onChange={e => setMarket(e.target.value)}><option value="ALL">전체</option><option value="KR">한국</option><option value="US">미국</option></select></label>
        <label>정렬<select value={sort} onChange={e => setSort(e.target.value)}><option value="saved">저장 순서</option><option value="name">이름순</option><option value="change">등락률 높은순</option></select></label>
        <small role="status">{visible.length}개 표시</small>
      </div>}
      {items.length ? (
        <div className="favorite-strip">
          {visible.length === 0 && <p>이 시장에 저장한 관심종목이 없어요.</p>}
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
      ) : (
        <div className="favorite-empty">
          <span className="friendly-empty-icon">
            <Star size={23} />
          </span>
          <p>
            <b>다시 보고 싶은 종목을 모아보세요.</b>
            <span>종목 옆 별을 누르면 여기에 저장돼요.</span>
          </p>
          <a href="#search-card">종목 찾아보기</a>
        </div>
      )}
    </section>
  );
}

export default memo(MarketWatchlist);
