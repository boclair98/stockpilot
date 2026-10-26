"use client";

import { Activity, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { requestJson } from "@/lib/reliable-request";
import { indexSnapshot, parseIndexData, type IndexData } from "@/lib/market-index";
export type { IndexData } from "@/lib/market-index";

const number = new Intl.NumberFormat("ko-KR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const shortDate = (value: string) =>
  new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
  }).format(new Date(`${value}T00:00:00+09:00`));

export default function MarketIndexChart({
  initialData = null,
}: {
  initialData?: IndexData | null;
}) {
  const [data, setData] = useState<IndexData | null>(() => indexSnapshot(initialData));
  const [loading, setLoading] = useState(!initialData);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    let hydrateTimer: number | null = null;
    const initial = indexSnapshot(initialData);
    const saveSnapshot = (next: IndexData) => { try { localStorage.setItem("stockpilot_kospi_snapshot",JSON.stringify(next)); } catch { /* Restricted storage does not stop market data. */ } };
    if (initial?.points.length) {
      saveSnapshot(initial);
      hydrateTimer = window.setTimeout(() => {
        if (active) {
          setData(initial);
          setLoading(false);
        }
      }, 0);
    } else {
      try {
        const cached = indexSnapshot(JSON.parse(
          localStorage.getItem("stockpilot_kospi_snapshot") || "null",
        ));
        if (cached?.points?.length) {
          hydrateTimer = window.setTimeout(() => {
            if (active) setData({ ...cached, stale: true });
          }, 0);
        }
      } catch {
        try { localStorage.removeItem("stockpilot_kospi_snapshot"); } catch { /* Storage may be unavailable. */ }
      }
    }

    const load = async (initial: boolean) => {
      controller?.abort();
      controller = new AbortController();
      const current = controller;
      if (initial) setLoading(true);
      else setRefreshing(true);
      setError("");
      try {
        const payload = await requestJson<unknown>("/api/trading/kospi", {
          cache: "default",
          signal: current.signal,
        });
        const next = parseIndexData(payload);
        if (active && !current.signal.aborted) {
          setData(next);
          if (next.points?.length) {
            saveSnapshot(next);
          }
        }
      } catch (reason) {
        if (
          active &&
          !current.signal.aborted
        ) {
          setError(reason instanceof Error ? reason.message : "지수를 불러오지 못했어요.");
        }
      } finally {
        if (active && controller === current && !current.signal.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };

    if (!initial?.points.length || attempt > 0) void load(!initial);
    const interval = window.setInterval(() => void load(false), 300_000);
    return () => {
      active = false;
      controller?.abort();
      if (hydrateTimer !== null) window.clearTimeout(hydrateTimer);
      window.clearInterval(interval);
    };
  }, [initialData, attempt]);

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
      .map(
        (point, index) =>
          `${index ? "L" : "M"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`,
      )
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
        <span className="index-kicker">
          <Activity size={14} /> 국내 대표 지수
        </span>
        <div className="index-title">
          <div>
            <h2 id="kospi-title">{data?.name || "KOSPI"}</h2>
            <strong>{data?.value ? number.format(data.value) : "—"}</strong>
          </div>
          {data?.value ? (
            <span className={positive ? "up" : "down"}>
              {positive ? "+" : ""}
              {number.format(data.change)} · {positive ? "+" : ""}
              {data.changePercent.toFixed(2)}%
            </span>
          ) : null}
        </div>
        <p>최근 30거래일 일별 종가</p>
        <small title={data?.source || "KIS Open API"}>
          5분마다 갱신
          {updated ? ` · ${updated}` : ""}
          {data?.stale || error ? " · 이전 자료" : ""}
        </small>
      </div>

      <div className="market-index-visual">
        {loading && !data ? (
          <div className="index-state">
            <RefreshCw className="spin" size={17} /> KOSPI 지수를 불러오고
            있어요
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
                  <stop
                    offset="0%"
                    stopColor={positive ? "#f04452" : "#3182f6"}
                    stopOpacity=".22"
                  />
                  <stop
                    offset="100%"
                    stopColor={positive ? "#f04452" : "#3182f6"}
                    stopOpacity="0"
                  />
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
              <path
                d={chart.line}
                className={
                  positive ? "index-line positive" : "index-line negative"
                }
              />
            </svg>
            <div className="index-axis">
              <span>{shortDate(data.points[0].date)}</span>
              <span>최저 {number.format(chart.min)}</span>
              <span>최고 {number.format(chart.max)}</span>
              <span>
                {shortDate(data.points.at(-1)?.date || data.points[0].date)}
              </span>
            </div>
          </>
        ) : (
          <div className="index-state">
            장 운영 시간 또는 KIS 연결 상태를 확인하고 있어요.
          </div>
        )}
        {refreshing || loading && data ? (
          <RefreshCw className="index-refresh spin" size={14} />
        ) : null}
      </div>
      <button type="button" className="index-refresh-button" aria-label="KOSPI 지수 다시 조회" disabled={loading || refreshing} onClick={() => setAttempt(value => value + 1)}><RefreshCw size={14} className={refreshing ? "spin" : ""} aria-hidden="true"/></button>
      {error ? <p className="index-read-error" role="status">{data ? "최근 자료를 확인하지 못했어요. 이전 자료를 표시해요." : error}<button type="button" onClick={() => setAttempt(value => value + 1)}>다시 조회</button></p> : null}
    </section>
  );
}
