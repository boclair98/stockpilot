"use client";

import { memo } from "react";
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
  return (
    <section className="favorite-board" aria-labelledby="favorite-board-title">
      <div className="favorite-board-head">
        <div>
          <span>MY WATCHLIST</span>
          <h2 id="favorite-board-title">내 관심종목</h2>
        </div>
        <small>{items.length}/12 · 이 브라우저</small>
      </div>
      {items.length ? (
        <div className="favorite-strip">
          {items.map((item) => (
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
