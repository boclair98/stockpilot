"use client";

import { Activity, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type IndexPoint = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type IndexData = {
  name: string;
  value: number;
  change: number;
  changePercent: number;
  asOf: string;
  source: string;
  stale?: boolean;
  points: IndexPoint[];
};

const number = new Intl.NumberFormat("ko-KR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const shortDate = (value: string) =>
  new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
  }).format(new Date(`${value}T00:00:00+09:00`));

export default function MarketIndexChart() {
  const [data, setData] = useState<IndexData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;

    const load = async (initial: boolean) => {
      controller?.abort();
      controller = new AbortController();
      if (initial) setLoading(true);
      else setRefreshing(true);
      try {
        const response = await fetch("/api/trading/kospi", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("KOSPI request failed");
        const next: IndexData = await response.json();
        if (active && !controller.signal.aborted) setData(next);
      } catch (reason) {
        if (
          active &&
          !(reason instanceof DOMException && reason.name === "AbortError")
        ) {
          setData((current) => current);
        }
      } finally {
        if (active && !controller.signal.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };

    void load(true);
    const interval = window.setInterval(() => void load(false), 300_000);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(interval);
    };
  }, []);

  const chart = useMemo(() => {
    const points = data?.points || [];
    if (!points.length) return null;
    const width = 900;
    const height = 190;
    const padX = 8;
    const padY = 16;
    const values = points.map((point) => point.close);
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const padding = (rawMax - rawMin || rawMax * 0.01 || 1) * 0.12;
    const min = rawMin - padding;
    const max = rawMax + padding;
    const spread = max - min || 1;
    const coords = points.map((point, index) => ({
      x: padX + (index / Math.max(points.length - 1, 1)) * (width - padX * 2),
      y: padY + ((max - point.close) / spread) * (height - padY * 2),
    }));
    const line = coords
      .map((point, index) => `${index ? "L" : "M"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
      .join(" ");
    const area = `${line} L ${coords.at(-1)?.x ?? width} ${height} L ${coords[0].x} ${height} Z`;
    return { width, height, line, area, min: rawMin, max: rawMax };
  }, [data?.points]);

  const positive = (data?.changePercent ?? 0) >= 0;
  const updated = data?.asOf
    ? new Intl.DateTimeFormat("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(data.asOf))
    : null;

  return (
    <section className="market-index-card" aria-labelledby="kospi-title">
      <div className="market-index-copy">
        <span className="index-kicker"><Activity size={14} /> 국내 대표 지수</span>
        <div className="index-title">
          <div>
            <h2 id="kospi-title">{data?.name || "KOSPI"}</h2>
            <strong>{data?.value ? number.format(data.value) : "—"}</strong>
          </div>
          {data?.value ? (
            <span className={positive ? "up" : "down"}>
              {positive ? "+" : ""}{number.format(data.change)} · {positive ? "+" : ""}
              {data.changePercent.toFixed(2)}%
            </span>
          ) : null}
        </div>
        <p>최근 30거래일 일별 종가</p>
        <small>
          KIS Open API · 5분마다 갱신
          {updated ? ` · ${updated}` : ""}
          {data?.stale ? " · 이전 데이터 표시 중" : ""}
        </small>
      </div>

      <div className="market-index-visual">
        {loading ? (
          <div className="index-state">
            <RefreshCw className="spin" size={17} /> KOSPI 지수를 불러오고 있어요
          </div>
        ) : chart && data?.points.length ? (
          <>
            <svg
              viewBox={`0 0 ${chart.width} ${chart.height}`}
              preserveAspectRatio="none"
              role="img"
              aria-label={`최근 30거래일 ${data.name} 지수 그래프`}
            >
              <defs>
                <linearGradient id="kospi-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={positive ? "#f04452" : "#3182f6"} stopOpacity=".22" />
                  <stop offset="100%" stopColor={positive ? "#f04452" : "#3182f6"} stopOpacity="0" />
                </linearGradient>
              </defs>
              {[0.2, 0.5, 0.8].map((ratio) => (
                <line
                  key={ratio}
                  x1="0"
                  x2={chart.width}
                  y1={chart.height * ratio}
                  y2={chart.height * ratio}
                  className="index-grid-line"
                />
              ))}
              <path d={chart.area} fill="url(#kospi-area)" />
              <path d={chart.line} className={positive ? "index-line positive" : "index-line negative"} />
            </svg>
            <div className="index-axis">
              <span>{shortDate(data.points[0].date)}</span>
              <span>최저 {number.format(chart.min)}</span>
              <span>최고 {number.format(chart.max)}</span>
              <span>{shortDate(data.points.at(-1)?.date || data.points[0].date)}</span>
            </div>
          </>
        ) : (
          <div className="index-state">
            장 운영 시간 또는 KIS 연결 상태를 확인하고 있어요.
          </div>
        )}
        {refreshing ? <RefreshCw className="index-refresh spin" size={14} /> : null}
      </div>
    </section>
  );
}
