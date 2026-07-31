"use client";

import { BarChart3, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type Currency = "KRW" | "USD";
type Market = "KR" | "US";
type HistoryPoint = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

const PERIODS = [
  { label: "1주", days: 5 },
  { label: "1개월", days: 20 },
  { label: "3개월", days: 60 },
] as const;

const price = (value: number, currency: Currency) =>
  new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "KRW" ? 0 : 2,
  }).format(value);

function compactDate(value: string) {
  const normalized =
    value.length === 8
      ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
      : value;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
  }).format(new Date(`${normalized}T00:00:00+09:00`));
}

export default function StockTrendPanel({
  symbol,
  name,
  market,
  exchange,
  currency,
}: {
  symbol: string;
  name: string;
  market: Market;
  exchange: string;
  currency: Currency;
}) {
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [days, setDays] = useState<(typeof PERIODS)[number]["days"]>(20);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setFailed(false);
      try {
        const params = new URLSearchParams({ symbol, market, exchange });
        const response = await fetch(`/api/features/history?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("history unavailable");
        const body = await response.json();
        if (!controller.signal.aborted) setHistory(body.items || []);
      } catch (reason) {
        if (
          !controller.signal.aborted &&
          !(reason instanceof DOMException && reason.name === "AbortError")
        ) {
          setHistory([]);
          setFailed(true);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 0);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [exchange, market, symbol]);

  const chart = useMemo(() => {
    const points = history.slice(-days);
    if (points.length < 2) return null;
    const width = 820;
    const height = 176;
    const padX = 7;
    const padY = 14;
    const closes = points.map((item) => item.close);
    const rawMin = Math.min(...points.map((item) => item.low || item.close));
    const rawMax = Math.max(...points.map((item) => item.high || item.close));
    const margin = (rawMax - rawMin || rawMax * 0.01 || 1) * 0.1;
    const min = rawMin - margin;
    const max = rawMax + margin;
    const spread = max - min || 1;
    const coords = closes.map((value, index) => ({
      x: padX + (index / (closes.length - 1)) * (width - padX * 2),
      y: padY + ((max - value) / spread) * (height - padY * 2),
    }));
    const line = coords
      .map(
        (point, index) =>
          `${index ? "L" : "M"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`,
      )
      .join(" ");
    const area = `${line} L ${coords.at(-1)?.x ?? width} ${height} L ${coords[0].x} ${height} Z`;
    const start = closes[0];
    const end = closes.at(-1) || start;
    return {
      points,
      width,
      height,
      line,
      area,
      changePercent: start ? ((end - start) / start) * 100 : 0,
      high: rawMax,
      low: rawMin,
      end,
    };
  }, [days, history]);

  const positive = (chart?.changePercent || 0) >= 0;

  return (
    <section className="stock-trend-panel" aria-labelledby="stock-trend-title">
      <div className="stock-trend-head">
        <div>
          <span><BarChart3 size={15} /> 가격 흐름</span>
          <h2 id="stock-trend-title">{name} 기간별 차트</h2>
          <p>한국투자증권 KIS 일별 시세 · 과거 수익률은 미래 성과를 보장하지 않아요</p>
        </div>
        <div className="trend-periods" aria-label="차트 기간">
          {PERIODS.map((period) => (
            <button
              type="button"
              key={period.days}
              className={days === period.days ? "active" : ""}
              onClick={() => setDays(period.days)}
            >
              {period.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="trend-state">
          <RefreshCw className="spin" size={17} /> 가격 흐름을 불러오고 있어요
        </div>
      ) : failed || !chart ? (
        <div className="trend-state">현재 이 종목의 기간별 시세를 표시할 수 없어요.</div>
      ) : (
        <div className="stock-trend-body">
          <div className="trend-summary">
            <span className={positive ? "positive" : "negative"}>
              {positive ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
              <b>{positive ? "+" : ""}{chart.changePercent.toFixed(2)}%</b>
              <small>선택 기간</small>
            </span>
            <span><small>최근 종가</small><b>{price(chart.end, currency)}</b></span>
            <span><small>기간 최고</small><b>{price(chart.high, currency)}</b></span>
            <span><small>기간 최저</small><b>{price(chart.low, currency)}</b></span>
          </div>
          <div className="stock-trend-chart">
            <svg
              viewBox={`0 0 ${chart.width} ${chart.height}`}
              preserveAspectRatio="none"
              role="img"
              aria-label={`${name} 선택 기간 일별 종가 그래프`}
            >
              <defs>
                <linearGradient id="stock-trend-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={positive ? "#f04452" : "#3182f6"} stopOpacity=".2" />
                  <stop offset="100%" stopColor={positive ? "#f04452" : "#3182f6"} stopOpacity="0" />
                </linearGradient>
              </defs>
              {[0.25, 0.5, 0.75].map((ratio) => (
                <line
                  key={ratio}
                  x1="0"
                  x2={chart.width}
                  y1={chart.height * ratio}
                  y2={chart.height * ratio}
                  className="trend-grid-line"
                />
              ))}
              <path d={chart.area} fill="url(#stock-trend-area)" />
              <path
                d={chart.line}
                className={positive ? "trend-line positive" : "trend-line negative"}
              />
            </svg>
            <div className="trend-axis">
              <span>{compactDate(chart.points[0].date)}</span>
              <span>{compactDate(chart.points.at(-1)?.date || chart.points[0].date)}</span>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
