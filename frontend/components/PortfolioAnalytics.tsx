"use client";

import {
  Activity,
  BarChart3,
  Gauge,
  LogIn,
  ShieldAlert,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { signInHref } from "@/lib/identity";

type Point = { date: string; returnRate: number; change: number | null };
type Analytics = {
  dataQuality: "STARTING" | "TRACKING";
  periodDays: number;
  openPositionCount: number;
  totalReturn: number | null;
  maxDrawdown: number | null;
  dailyVolatility: number | null;
  annualizedVolatility: number | null;
  sharpeRatio: number | null;
  winRate: number | null;
  profitFactor: number | null;
  fillRate: number | null;
  averageSlippageBps: number | null;
  averageSpreadBps: number | null;
  filledOrderCount: number;
  closedTradeCount: number;
  dailySeries: Point[];
};

function percent(value: number | null, digits = 2) {
  return value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function metric(value: number | null, suffix = "") {
  return value === null ? "—" : `${value.toFixed(2)}${suffix}`;
}

function Sparkline({ points }: { points: Point[] }) {
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
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/growth/analytics", {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!payload) return;
        setAuthenticated(Boolean(payload.authenticated));
        setAnalytics(payload.analytics ?? null);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  return (
    <section className="portfolio-analytics" aria-labelledby="portfolio-analytics-title">
      <div className="analytics-heading">
        <div className="growth-section-head">
          <span><BarChart3 size={18} /></span>
          <div><p>PORTFOLIO INTELLIGENCE</p><h2 id="portfolio-analytics-title">내 투자 습관을 숫자로 설명해요</h2></div>
        </div>
        <small>보유 종목과 주문 내역은 공개하지 않고, 성과 지표만 계산합니다.</small>
      </div>

      {authenticated === false ? (
        <div className="analytics-login">
          <Gauge size={25} />
          <span><b>로그인하면 나만의 리스크 리포트를 만들 수 있어요</b><small>수익률만 보는 대신 낙폭·변동성·체결 품질까지 함께 확인합니다.</small></span>
          <a href={signInHref("/growth")}><LogIn size={14} /> Google 로그인</a>
        </div>
      ) : !analytics ? (
        <div className="analytics-loading"><Activity className="spin" size={17} /> 최근 기록을 분석하고 있어요</div>
      ) : (
        <>
          <div className="analytics-overview">
            <div className={`analytics-return ${(analytics.totalReturn ?? 0) >= 0 ? "positive" : "negative"}`}>
              <span>통합 누적 수익률</span>
              <strong>{percent(analytics.totalReturn)}</strong>
              <small>{analytics.periodDays}일 데이터 · {analytics.openPositionCount}개 보유 포지션</small>
            </div>
            <Sparkline points={analytics.dailySeries} />
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
          <p className="analytics-note">샤프 비율은 무위험수익률 0%, 252 거래일을 가정한 학습용 지표입니다. 실제 투자 판단을 대신하지 않습니다.</p>
        </>
      )}
    </section>
  );
}

