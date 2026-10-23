"use client";

import {
  Activity,
  BarChart3,
  Gauge,
  LogIn,
  RefreshCw,
  ShieldAlert,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { signInHref } from "@/lib/identity";
import { ApiRequestError, requestJson } from "@/lib/reliable-request";
import { isAnalyticsResponse, type AnalyticsPoint, type PortfolioAnalyticsData } from "@/lib/analytics-response";

function percent(value: number | null, digits = 2) {
  return value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function metric(value: number | null, suffix = "") {
  return value === null ? "—" : `${value.toFixed(2)}${suffix}`;
}

function Sparkline({ points }: { points: AnalyticsPoint[] }) {
  const polyline = useMemo(() => {
    if (!points.length) return "";
    const values = points.map((point) => point.returnRate);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const spread = max - min || 1;
    return values
      .map((value, index) => {
        const x = points.length === 1 ? 50 : 4 + (index / (points.length - 1)) * 92;
        const y = 88 - ((value - min) / spread) * 70;
        return `${x},${y}`;
      })
      .join(" ");
  }, [points]);

  return (
    <svg className="analytics-sparkline" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="최근 포트폴리오 수익률 추이">
      <path d="M4 25H96M4 50H96M4 75H96" />
      <polyline points={polyline} />
    </svg>
  );
}

export default function PortfolioAnalytics() {
  const [state, setState] = useState<{ kind: "loading" | "error" | "guest" | "empty" | "ready"; analytics: PortfolioAnalyticsData | null; message: string }>({ kind: "loading", analytics: null, message: "" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void requestJson<unknown>("/api/growth/analytics", {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    }, 15_000)
      .then((payload) => {
        if (controller.signal.aborted) return;
        if (!isAnalyticsResponse(payload)) throw new Error("분석 응답을 확인하지 못했어요. 다시 조회해 주세요.");
        setState({ kind: !payload.authenticated ? "guest" : payload.analytics ? "ready" : "empty", analytics: payload.analytics, message: "" });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const guest = error instanceof ApiRequestError && error.status === 401;
        setState({ kind: guest ? "guest" : "error", analytics: null, message: guest ? "로그인이 만료됐어요. 다시 로그인한 뒤 분석을 확인해 주세요." : error instanceof Error ? error.message : "분석을 불러오지 못했어요." });
      });
    return () => controller.abort();
  }, [attempt]);
  const retry = () => { setState({ kind: "loading", analytics: null, message: "" }); setAttempt(value => value + 1); };
  const analytics = state.analytics;

  return (
    <section className="portfolio-analytics" aria-labelledby="portfolio-analytics-title" aria-busy={state.kind === "loading"}>
      <div className="analytics-heading">
        <div className="growth-section-head">
          <span><BarChart3 size={18} /></span>
          <div><p>PORTFOLIO INTELLIGENCE</p><h2 id="portfolio-analytics-title">내 투자 습관을 숫자로 설명해요</h2></div>
        </div>
        <small>보유 종목과 주문 내역은 공개하지 않고, 성과 지표만 계산합니다.</small>
      </div>

      {state.kind === "guest" ? (
        <div className="analytics-login">
          <Gauge size={25} />
          <span><b>로그인하면 나만의 리스크 리포트를 만들 수 있어요</b><small>{state.message || "수익률만 보는 대신 낙폭·변동성·체결 품질까지 함께 확인합니다."}</small></span>
          <a href={signInHref("/growth")}><LogIn size={14} /> Google 로그인</a>
        </div>
      ) : state.kind === "loading" ? (
        <div className="analytics-loading" role="status"><Activity className="spin" size={17} aria-hidden="true" /> 최근 기록을 분석하고 있어요</div>
      ) : state.kind === "error" ? (
        <div className="analytics-recovery" role="alert"><div><b>투자 분석을 불러오지 못했어요</b><p>{state.message} 잔고나 주문은 변경되지 않았어요.</p></div><button type="button" onClick={retry}><RefreshCw size={16} aria-hidden="true" /> 다시 조회</button></div>
      ) : !analytics ? (
        <div className="analytics-recovery"><div><b>아직 분석할 기록이 없어요</b><p>모의투자 기록이 쌓이면 실제 수익률과 체결 품질을 확인할 수 있어요.</p></div><button type="button" onClick={retry}><RefreshCw size={16} aria-hidden="true" /> 기록 다시 조회</button></div>
      ) : (
        <>
          <div className="analytics-overview">
            <div className={`analytics-return ${analytics.totalReturn === null ? "" : analytics.totalReturn >= 0 ? "positive" : "negative"}`}>
              <span>통합 누적 수익률</span>
              <strong>{percent(analytics.totalReturn)}</strong>
              <small>{analytics.periodDays}일 데이터 · {analytics.openPositionCount}개 보유 포지션</small>
            </div>
            {analytics.dailySeries.length ? <Sparkline points={analytics.dailySeries} /> : <p className="analytics-series-empty">아직 일별 수익률 기록이 없어요. 기록이 쌓이면 추이를 보여드려요.</p>}
            <div className="analytics-quality"><span><ShieldAlert size={14} /> 데이터 상태</span><b>{analytics.dataQuality === "TRACKING" ? "추적 중" : "기록 시작"}</b><small>최근 30일 흐름</small></div>
          </div>

          <div className="analytics-metrics">
            <article><TrendingDown size={15} /><span>최대 낙폭<small>고점 대비 하락폭</small></span><b>{metric(analytics.maxDrawdown, "%p")}</b></article>
            <article><Activity size={15} /><span>연환산 변동성<small>일간 변화 기준</small></span><b>{metric(analytics.annualizedVolatility, "%")}</b></article>
            <article><Target size={15} /><span>샤프 비율<small>위험 대비 성과</small></span><b>{metric(analytics.sharpeRatio)}</b></article>
            <article><TrendingUp size={15} /><span>매도 승률<small>실현 손익 기준</small></span><b>{metric(analytics.winRate, "%")}</b></article>
            <article><Gauge size={15} /><span>체결률<small>거절·취소 포함</small></span><b>{metric(analytics.fillRate, "%")}</b></article>
            <article><BarChart3 size={15} /><span>평균 슬리피지<small>체결가와 기준가</small></span><b>{metric(analytics.averageSlippageBps, " bps")}</b></article>
          </div>
          {analytics.dailySeries.length ? <details className="analytics-series"><summary>일별 수익률 숫자로 보기 · {analytics.dailySeries.length}일</summary><div className="analytics-series-scroll" role="region" aria-label="일별 수익률 데이터" tabIndex={0}><table><caption>서버에 기록된 최근 일별 수익률 · 날짜 기준은 한국 시간</caption><thead><tr><th scope="col">날짜</th><th scope="col">누적 수익률</th><th scope="col">이전 기록 대비</th></tr></thead><tbody>{[...analytics.dailySeries].reverse().map(point => <tr key={point.date}><th scope="row"><time dateTime={point.date}>{point.date}</time></th><td>{percent(point.returnRate)}</td><td>{point.change === null ? "—" : `${point.change >= 0 ? "+" : ""}${point.change.toFixed(2)}%p`}</td></tr>)}</tbody></table></div><p>이전 기록 대비는 누적 수익률의 차이(%p)이며, 누락된 날짜의 값을 채워 넣지 않아요.</p></details> : null}
          <p className="analytics-note">샤프 비율은 무위험수익률 0%, 252 거래일을 가정한 학습용 지표입니다. 실제 투자 판단을 대신하지 않습니다.</p>
          <button className="analytics-refresh" type="button" onClick={retry}><RefreshCw size={16} aria-hidden="true" /> 분석 다시 조회</button>
        </>
      )}
    </section>
  );
}

