"use client";
import { Star } from "lucide-react";
import StockLogo from "./StockLogo";

export type RowInstrument = {
  id: string;
  symbol: string;
  name: string;
  exchange: string;
  listingMarket?: string;
  currency: "KRW" | "USD";
  price?: number;
  changePercent?: number | null;
  logoUrl?: string | null;
};
type Props = {
  stock: RowInstrument;
  rank?: number;
  metric?: string;
  active?: boolean;
  saved: boolean;
  onOpen: () => void;
  onSave: () => void;
};
export default function StockRow({
  stock,
  rank,
  metric,
  active = false,
  saved,
  onOpen,
  onSave,
}: Props) {
  const known =
    typeof stock.price === "number" &&
    Number.isFinite(stock.price) &&
    stock.price > 0;
  const change = stock.changePercent;
  return (
    <div
      className={`consumer-stock-row${metric ? " with-metric" : ""}${active ? " selected" : ""}`}
    >
      <button
        className="stock-row-open"
        type="button"
        aria-label={`${stock.name} 상세 보기`}
        onClick={onOpen}
      >
        {rank !== undefined ? (
          <span className="rank-number">{rank}</span>
        ) : null}
        <StockLogo
          symbol={stock.symbol}
          name={stock.name}
          color="#18C899"
          logoUrl={stock.logoUrl}
        />
        <span className="rank-identity">
          <b>{stock.name}</b>
          <small>
            {stock.symbol} · {stock.listingMarket || stock.exchange}
          </small>
        </span>
        <span className="rank-price">
          <b>
            {known
              ? new Intl.NumberFormat("ko-KR", {
                  style: "currency",
                  currency: stock.currency,
                  maximumFractionDigits: stock.currency === "KRW" ? 0 : 2,
                }).format(stock.price!)
              : "—"}
          </b>
          <small
            className={
              typeof change === "number" ? (change >= 0 ? "up" : "down") : ""
            }
          >
            {typeof change === "number" && Number.isFinite(change)
              ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`
              : "선택 후 조회"}
          </small>
        </span>
        {metric ? <span className="stock-row-metric">{metric}</span> : null}
      </button>
      <button
        className="stock-row-save"
        type="button"
        aria-pressed={saved}
        aria-label={`${stock.name} 관심종목 ${saved ? "제거" : "추가"}`}
        onClick={onSave}
      >
        <Star size={19} fill={saved ? "currentColor" : "none"} />
      </button>
    </div>
  );
}
