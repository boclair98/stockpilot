"use client";
import { Check, Plus, Star } from "lucide-react";
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
  metricLabel?: string;
  active?: boolean;
  saved: boolean;
  compared?: boolean;
  onCompare?: () => void;
  onOpen: () => void;
  onSave: () => void;
};
export default function StockRow({
  stock,
  rank,
  metric,
  metricLabel,
  active = false,
  saved,
  compared = false,
  onCompare,
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
      className={`consumer-stock-row${rank !== undefined ? " has-rank" : " without-rank"}${metric ? " with-metric" : ""}${active ? " selected" : ""}${onCompare ? " with-comparison" : ""}`}
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
              typeof change === "number" && Number.isFinite(change) ? (change > 0 ? "up" : change < 0 ? "down" : "") : ""
            }
          >
            {typeof change === "number" && Number.isFinite(change)
              ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`
              : "선택 후 조회"}
          </small>
        </span>
        {metric ? <span className="stock-row-metric">{metricLabel ? <small className="stock-row-metric-label">{metricLabel}</small> : null}<span>{metric}</span></span> : null}
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
      {onCompare ? <button className="stock-row-compare" type="button" aria-pressed={compared} aria-label={`${stock.name} 비교 ${compared ? "제외" : "추가"}`} onClick={onCompare}>
        {compared ? <Check size={17} aria-hidden="true" /> : <Plus size={17} aria-hidden="true" />}<span>비교</span>
      </button> : null}
    </div>
  );
}
