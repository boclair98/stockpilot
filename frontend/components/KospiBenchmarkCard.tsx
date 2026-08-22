"use client";

import { Activity, ArrowDownRight, ArrowUpRight, Gauge, RefreshCw, Scale } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type BenchmarkPoint = { date: string; value: number; returnRate: number };
type Benchmark = {
  current: number | null;
  changePercent: number | null;
  return5d: number | null;
  return20d: number | null;
  volatility: number | null;
  regime: "BULL" | "RANGE" | "BEAR" | "VOLATILE";
  regimeLabel: string;
  asOf: string | null;
  source: string;
  stale?: boolean;
  series: BenchmarkPoint[];
  dataQuality: "TRACKING" | "WAITING";
};
type Comparison = {
  status: "AHEAD" | "BEHIND" | "MATCH" | "STARTING";
  periodDays: number;
  portfolioReturn: number | null;
  benchmarkReturn: number | null;
  relativeReturn: number | null;
  portfolioSeries: Array<{ date: string; returnRate: number }>;
};
type BenchmarkResponse = {
  authenticated: boolean;
  benchmark: Benchmark;
  comparison: Comparison | null;
};

const indexNumber = new Intl.NumberFormat("ko-KR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const percent = (value: number | null) =>
  value === null || !Number.isFinite(value) ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

function Sparkline({ points, positive }: { points: BenchmarkPoint[]; positive: boolean }) {
  const chart = useMemo(() => {
    if (points.length < 2) return null;
    const width = 560;
    const height = 130;
    const values = points.map((point) => point.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const spread = max - min || 1;
    const coordinates = points.map((point, index) => ({
      x: (index / (points.length - 1)) * width,
      y: 12 + ((max - point.value) / spread) * (height - 24),
    }));
    const line = coordinates
      .map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
      .join(" ");
    return { width, height, line, min, max };
  }, [points]);

  if (!chart) return <div className="kospi-benchmark-empty">코스피 이력을 모으는 중이에요</div>;
  return (
    <div className="kospi-benchmark-chart">
      <svg viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label="최근 KOSPI 흐름">
        <defs>
          <linearGradient id="kospi-benchmark-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={positive ? "#ef4444" : "#3182f6"} stopOpacity=".22" />
            <stop offset="100%" stopColor={positive ? "#ef4444" : "#3182f6"} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d={`${chart.line} L ${chart.width} ${chart.height} L 0 ${chart.height} Z`}
          fill="url(#kospi-benchmark-fill)"
        />
        <path d={chart.line} className={positive ? "kospi-benchmark-line positive" : "kospi-benchmark-line negative"} />
      </svg>
      <div className="kospi-benchmark-axis">
        <span>최근 30거래일</span>
        <span>{indexNumber.format(chart.min)}–{indexNumber.format(chart.max)}</span>
      </div>
    </div>
  );
}

export default function KospiBenchmarkCard() {
  const [data, setData] = useState<BenchmarkResponse | null>(null);
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
        const response = await fetch("/api/growth/benchmark", {
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("KOSPI benchmark request failed");
        const next = (await response.json()) as BenchmarkResponse;
        if (active && !controller.signal.aborted) setData(next);
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
      } finally {
        if (active && !controller.signal.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };
    void load(true);
    const interval = window.setInterval(() => void load(false), 60_000);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(interval);
    };
  }, []);

  const benchmark = data?.benchmark;
  const comparison = data?.comparison;
  const positive = (benchmark?.changePercent ?? 0) >= 0;
  const comparisonClass = comparison?.relativeReturn && comparison.relativeReturn < 0 ? "down" : "up";
  const statusLabel =
    comparison?.status === "AHEAD"
      ? "시장보다 앞서고 있어요"
      : comparison?.status === "BEHIND"
        ? "시장보다 점검이 필요해요"
        : comparison?.status === "MATCH"
          ? "시장과 비슷한 흐름이에요"
          : "수익률을 기록하는 중이에요";

  return (
    <section className="kospi-benchmark-card" aria-labelledby="kospi-benchmark-title">
      <div className="kospi-benchmark-heading">
        <div>
          <span className="kospi-benchmark-kicker"><Scale size={14} /> KOSPI BENCHMARK</span>
          <h2 id="kospi-benchmark-title">코스피와 함께 보는 내 투자</h2>
          <p>시장 전체 흐름과 비교하면 내 모의투자의 강점과 리스크를 더 쉽게 발견할 수 있어요.</p>
        </div>
        {refreshing ? <RefreshCw className="spin" size={16} aria-label="갱신 중" /> : <Activity size={18} />}
      </div>

      {loading && !benchmark ? (
        <div className="kospi-benchmark-loading"><RefreshCw className="spin" size={16} /> 코스피 기준선을 준비하고 있어요</div>
      ) : benchmark ? (
        <div className="kospi-benchmark-body">
          <div className="kospi-benchmark-metrics">
            <div className="kospi-benchmark-price">
              <span>코스피 종합</span>
              <strong>{benchmark.current === null ? "—" : indexNumber.format(benchmark.current)}</strong>
              <em className={positive ? "up" : "down"}>{percent(benchmark.changePercent)} 오늘</em>
            </div>
            <div className={`kospi-regime ${benchmark.regime.toLowerCase()}`}>
              <Gauge size={16} />
              <span><small>시장 국면</small><b>{benchmark.regimeLabel}</b></span>
            </div>
            <div className="kospi-window-metrics">
              <span><small>5거래일</small><b className={(benchmark.return5d ?? 0) >= 0 ? "up" : "down"}>{percent(benchmark.return5d)}</b></span>
              <span><small>20거래일</small><b className={(benchmark.return20d ?? 0) >= 0 ? "up" : "down"}>{percent(benchmark.return20d)}</b></span>
              <span><small>일 변동성</small><b>{benchmark.volatility === null ? "—" : `${benchmark.volatility.toFixed(2)}%`}</b></span>
            </div>
          </div>
          <Sparkline points={benchmark.series} positive={positive} />
          <div className="kospi-benchmark-compare">
            <div className="kospi-compare-label"><span><Scale size={15} /> 내 포트폴리오 vs KOSPI</span><small>{comparison ? `최근 ${comparison.periodDays}거래일` : "로그인 후 비교"}</small></div>
            {data?.authenticated && comparison ? (
              <div className="kospi-compare-values">
                <span><small>내 모의투자</small><b>{percent(comparison.portfolioReturn)}</b></span>
                <span><small>KOSPI</small><b>{percent(comparison.benchmarkReturn)}</b></span>
                <strong className={comparisonClass}>{comparison.relativeReturn === null ? "—" : `${comparison.relativeReturn >= 0 ? "+" : ""}${comparison.relativeReturn.toFixed(2)}%`}<small>{statusLabel}</small></strong>
              </div>
            ) : (
              <div className="kospi-login-hint"><ArrowUpRight size={16} /> Google 로그인하면 내 수익률을 KOSPI와 익명으로 비교할 수 있어요.</div>
            )}
          </div>
          <small className="kospi-benchmark-footnote">{benchmark.source} · {benchmark.stale ? "이전 정상 데이터" : "5분 캐시"} · 투자 조언이 아닌 학습용 지표</small>
        </div>
      ) : (
        <div className="kospi-benchmark-loading"><ArrowDownRight size={16} /> KIS 연결 후 시장 기준선이 표시돼요</div>
      )}
    </section>
  );
}

