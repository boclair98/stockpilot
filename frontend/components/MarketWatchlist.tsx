"use client";

import { memo } from "react";
import { Star, X } from "lucide-react";

import StockLogo from "./StockLogo";

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

const priceFormatters = {
  KRW: new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 }),
  USD: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }),
};

function formatPrice(value: number, currency: "KRW" | "USD") {
  return priceFormatters[currency].format(value);
}

function MarketWatchlist({ items, selectedId, colorFor, onSelect, onRemove }: Props) {
  return (
    <section className="favorite-board" aria-labelledby="favorite-board-title">
      <div className="favorite-board-head">
        <div>
          <span><Star size={15} fill="currentColor" /> MY WATCHLIST</span>
          <h2 id="favorite-board-title">내 관심종목</h2>
        </div>
        <small>{items.length}/12</small>
      </div>

      {items.length ? (
        <div className="favorite-strip">
          {items.map((item) => {
            const hasQuote = typeof item.price === "number";
            const change = item.changePercent ?? 0;
            return (
              <article className={selectedId === item.id ? "active" : ""} key={item.id}>
                <button
                  className="favorite-open"
                  type="button"
                  onClick={() => onSelect(item)}
                  aria-label={`${item.name} 주문 화면 열기`}
                >
                  <StockLogo
                    symbol={item.symbol}
                    name={item.name}
                    color={colorFor(item.symbol)}
                    logoUrl={item.logoUrl}
                  />
                  <span>
                    <b>{item.name}</b>
                    <small>{item.symbol} · {item.market === "KR" ? "한국" : "미국"}</small>
                  </span>
                  <span className="favorite-price">
                    <b>{hasQuote ? formatPrice(item.price as number, item.currency) : "시세 보기"}</b>
                    {hasQuote && (
                      <small className={change >= 0 ? "up" : "down"}>
                        {change >= 0 ? "+" : ""}{change.toFixed(2)}%
                      </small>
                    )}
                  </span>
                </button>
                <button
                  className="favorite-remove"
                  type="button"
                  onClick={() => onRemove(item)}
                  aria-label={`${item.name} 관심종목에서 제거`}
                  title="관심종목에서 제거"
                >
                  <X size={14} />
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="favorite-empty">
          <Star size={18} />
          <p><b>관심종목을 한곳에서 빠르게 확인하세요.</b><span>종목을 선택한 뒤 주문창의 별을 누르면 여기에 저장돼요.</span></p>
        </div>
      )}
    </section>
  );
}

export default memo(MarketWatchlist);
