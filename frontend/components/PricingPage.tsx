"use client";

import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  BellRing,
  Check,
  CircleHelp,
  Crown,
  Gauge,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { signInHref, useMe } from "@/lib/identity";
import {
  FALLBACK_PLANS,
  type BillingPlan,
  type BillingPlanId,
  priceText,
} from "@/lib/billing";

type PlanResponse = {
  checkoutConfigured: boolean;
  plans: BillingPlan[];
};

const planIcons: Record<BillingPlanId, typeof BadgeCheck> = {
  FREE: ShieldCheck,
  PRO: Crown,
  TEAM: Users,
};

const planHighlights: Record<BillingPlanId, string> = {
  FREE: "처음 시작하는 투자 학습",
  PRO: "나만의 투자 습관을 복기",
  TEAM: "스터디·교육기관 운영",
};

function formatLimit(value: number | null, suffix: string) {
  return value === null ? "무제한" : `${value}${suffix}`;
}

export default function PricingPage() {
  const me = useMe();
  const [catalog, setCatalog] = useState<PlanResponse>({
    checkoutConfigured: false,
    plans: FALLBACK_PLANS,
  });
  const [selectedPlan, setSelectedPlan] = useState<BillingPlanId | null>(null);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/billing/plans", {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: PlanResponse | null) => {
        if (payload?.plans?.length) setCatalog(payload);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const planMap = useMemo(
    () => new Map(catalog.plans.map((plan) => [plan.id, plan])),
    [catalog.plans],
  );

  const requestPlan = useCallback(
    async (planId: BillingPlanId) => {
      if (planId === "FREE") {
        window.location.assign("/");
        return;
      }
      if (!me) {
        window.location.assign(signInHref("/pricing"));
        return;
      }
      setSelectedPlan(planId);
      setNotice("");
      try {
        const response = await fetch(
          catalog.checkoutConfigured ? "/api/billing/checkout" : "/api/billing/interests",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ planId }),
          },
        );
        const body = await response.json().catch(() => ({}));
        if (response.ok) {
          setNotice(
            catalog.checkoutConfigured
              ? "결제 화면을 준비하고 있어요."
              : `${planMap.get(planId)?.name ?? planId} 출시 알림을 신청했어요.`,
          );
          return;
        }
        if (response.status === 401) {
          window.location.assign(signInHref("/pricing"));
          return;
        }
        setNotice(body?.detail?.message || body?.detail || "잠시 후 다시 시도해 주세요.");
      } catch {
        setNotice("네트워크가 잠시 불안정해요. 잠시 후 다시 시도해 주세요.");
      } finally {
        setSelectedPlan(null);
      }
    },
    [catalog.checkoutConfigured, me, planMap],
  );

  return (
    <main className="pricing-page">
      <header className="pricing-topbar">
        <Link className="brand" href="/"><span><BadgeCheck size={18} /></span>StockPilot</Link>
        <Link className="service-back" href="/"><ArrowLeft size={15} /> 시장으로 돌아가기</Link>
      </header>

      <section className="pricing-hero">
        <div>
          <p>STOCKPILOT MEMBERSHIP</p>
          <h1>배우는 만큼 깊어지는<br />가상투자 경험</h1>
          <span>핵심 시세와 주문은 누구에게나 열어 두고, 복기·리포트·팀 운영처럼 더 깊은 학습에만 합리적인 플랜을 적용합니다.</span>
        </div>
        <div className="pricing-hero-proof">
          <ShieldCheck size={19} />
          <b>실거래 없는 학습 서비스</b>
          <small>결제해도 실제 증권계좌와 연결되지 않아요.</small>
        </div>
      </section>

      {notice && <div className="pricing-notice" role="status" aria-live="polite">{notice}</div>}

      <section className="pricing-section" aria-labelledby="pricing-title">
        <div className="pricing-section-head">
          <div><p>CHOOSE YOUR PACE</p><h2 id="pricing-title">필요한 만큼만 시작하세요</h2></div>
          <span>{loading ? <><RefreshCw className="spin" size={13} /> 요금제 확인 중</> : catalog.checkoutConfigured ? "안전한 결제 준비 완료" : "출시 전 관심 등록 단계"}</span>
        </div>
        <div className="pricing-grid">
          {catalog.plans.map((plan) => {
            const Icon = planIcons[plan.id];
            const isPro = plan.id === "PRO";
            return (
              <article className={`pricing-card${isPro ? " featured" : ""}`} key={plan.id}>
                {isPro && <span className="pricing-popular"><Crown size={13} /> 가장 많이 선택</span>}
                <div className="pricing-card-head">
                  <span className={`pricing-plan-icon ${plan.id.toLowerCase()}`}><Icon size={19} /></span>
                  <div><small>{plan.eyebrow}</small><h3>{plan.name}</h3></div>
                </div>
                <p className="pricing-highlight">{planHighlights[plan.id]}</p>
                <p className="pricing-description">{plan.description}</p>
                <div className="pricing-price"><strong>{priceText(plan.priceKrw)}</strong><small>{plan.period}</small></div>
                <ul>
                  {plan.features.map((feature) => <li key={feature}><Check size={15} />{feature}</li>)}
                </ul>
                <button
                  type="button"
                  className={`pricing-cta ${plan.id.toLowerCase()}`}
                  disabled={selectedPlan === plan.id}
                  onClick={() => void requestPlan(plan.id)}
                >
                  {selectedPlan === plan.id ? <><RefreshCw className="spin" size={15} /> 처리 중</> : plan.id === "FREE" ? "무료로 시작" : catalog.checkoutConfigured ? "구독 시작" : "출시 알림 신청"}
                  <ArrowRight size={15} />
                </button>
                {plan.status === "prelaunch" && <small className="pricing-prelaunch"><LockKeyhole size={12} /> 현재는 결제 전 사전 등록 단계</small>}
              </article>
            );
          })}
        </div>
        <p className="pricing-footnote">모든 가격은 부가세·결제 수수료 적용 전 기준이며, 실제 결제 전 최종 금액과 환불 조건을 다시 안내합니다.</p>
      </section>

      <section className="pricing-value-grid" aria-label="유료 플랜 설계 원칙">
        <article><span><BellRing size={18} /></span><div><b>알림은 행동으로 연결</b><p>가격·조건 알림을 늘리는 대신, 사용자가 놓치지 않도록 복기와 안전 확인까지 이어집니다.</p></div></article>
        <article><span><Gauge size={18} /></span><div><b>성과보다 과정에 집중</b><p>수익률만 판매하지 않고 낙폭·변동성·체결 품질을 함께 보여줘 과장된 기대를 줄입니다.</p></div></article>
        <article><span><Users size={18} /></span><div><b>팀 플랜으로 확장</b><p>개인 결제에만 의존하지 않고 스터디·학교·교육기관이 반복적으로 사용할 수 있는 운영 도구를 제공합니다.</p></div></article>
      </section>

      <section className="pricing-compare" aria-labelledby="compare-title">
        <div className="pricing-section-head"><div><p>AT A GLANCE</p><h2 id="compare-title">플랜별 이용 한도</h2></div></div>
        <div className="pricing-table-wrap">
          <table>
            <thead><tr><th>항목</th>{catalog.plans.map((plan) => <th key={plan.id}>{plan.name}</th>)}</tr></thead>
            <tbody>
              <tr><th>가격 알림</th>{catalog.plans.map((plan) => <td key={plan.id}>{formatLimit(plan.limits.alerts, "개")}</td>)}</tr>
              <tr><th>비공개 리그</th>{catalog.plans.map((plan) => <td key={plan.id}>{formatLimit(plan.limits.leagues, "개")}</td>)}</tr>
              <tr><th>복기 데이터</th>{catalog.plans.map((plan) => <td key={plan.id}>{plan.limits.historyDays >= 3650 ? "전체 기간" : `${plan.limits.historyDays}일`}</td>)}</tr>
              <tr><th>팀 대시보드</th>{catalog.plans.map((plan) => <td key={plan.id}>{plan.id === "TEAM" ? "지원" : "—"}</td>)}</tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="pricing-trust">
        <CircleHelp size={17} />
        <p><b>결제는 아직 활성화하지 않았습니다.</b><br />현재는 수요를 확인하기 위한 출시 알림만 저장합니다. 결제 공급자·환불 정책·서명 검증 웹훅을 준비한 뒤에만 실제 구독을 열고, 결제 여부는 서버에서 검증된 계정에만 권한을 부여합니다.</p>
      </section>

      <footer className="service-page-footer pricing-footer"><b>StockPilot</b><span>실제 시세 기반 가상투자 학습 서비스</span><div><Link href="/guide">이용 가이드</Link><Link href="/privacy">개인정보처리방침</Link><Link href="/terms">이용약관</Link></div></footer>
    </main>
  );
}
