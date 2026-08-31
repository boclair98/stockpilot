"use client";

import {
  ArrowRight,
  BookCheck,
  CheckCircle2,
  Eye,
  LockKeyhole,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import Link from "next/link";

import { signInHref } from "@/lib/identity";

type SafetyIndicator = {
  key: string;
  label: string;
  score: number;
  maxScore: number;
  description: string;
  action: string;
  href: string;
};

export type FinancialSafetyData = {
  score: number;
  grade: string;
  status: "PREPARE" | "CAUTION" | "STABLE" | "EXCELLENT";
  indicators: SafetyIndicator[];
  nextAction: {
    title: string;
    description: string;
    href: string;
  };
  guardrails: string[];
  disclaimer: string;
};

const SAFETY_ICONS = {
  planning: BookCheck,
  protection: ShieldCheck,
  diversification: WalletCards,
  review: Eye,
  moderation: CheckCircle2,
};

export default function FinancialSafetyReport({
  authenticated,
  data,
}: {
  authenticated: boolean;
  data: FinancialSafetyData;
}) {
  return (
    <section className={`financial-safety safety-${data.status.toLowerCase()}`} aria-labelledby="financial-safety-title">
      <header className="safety-heading">
        <span className="safety-heading-icon"><ShieldCheck size={22} /></span>
        <div>
          <p>FINANCIAL CONSUMER CARE</p>
          <h2 id="financial-safety-title">금융생활 안전 리포트</h2>
          <small>수익률이 아닌 보호 습관을 서버 기록으로 평가해요.</small>
        </div>
        <span className="safety-private"><LockKeyhole size={13} /> 나만 볼 수 있어요</span>
      </header>

      <div className="safety-summary">
        <div className="safety-score" role="meter" aria-label="금융생활 안전점수" aria-valuemin={0} aria-valuemax={100} aria-valuenow={data.score}>
          <span>안전점수</span>
          <strong>{data.score}<small>점</small></strong>
          <b>{data.grade}</b>
        </div>

        <div className="safety-indicators">
          {data.indicators.map((indicator) => {
            const Icon = SAFETY_ICONS[indicator.key as keyof typeof SAFETY_ICONS] ?? CheckCircle2;
            const percent = Math.round((indicator.score / indicator.maxScore) * 100);
            return (
              <article key={indicator.key} title={indicator.description}>
                <span><Icon size={15} /></span>
                <div>
                  <b>{indicator.label}</b>
                  <i aria-hidden="true"><em style={{ width: `${percent}%` }} /></i>
                </div>
                <strong>{indicator.score}<small>/{indicator.maxScore}</small></strong>
              </article>
            );
          })}
        </div>

        <aside className="safety-next">
          <span>다음 안전 행동</span>
          <b>{authenticated ? data.nextAction.title : "로그인하고 안전 습관 측정하기"}</b>
          <p>{authenticated ? data.nextAction.description : "가상 거래와 투자일지 기록만으로 나만의 리포트를 만들어요."}</p>
          <Link href={authenticated ? data.nextAction.href : signInHref()}>
            {authenticated ? "바로 실천하기" : "Google로 시작하기"}<ArrowRight size={13} />
          </Link>
        </aside>
      </div>

      <div className="safety-guardrails">
        <div><LockKeyhole size={16} /><span><b>개인정보 최소수집</b><small>은행 계좌와 비밀번호를 받지 않아요</small></span></div>
        <div><WalletCards size={16} /><span><b>100% 가상거래</b><small>실제 증권 주문으로 전송하지 않아요</small></span></div>
        <div><Eye size={16} /><span><b>설명 가능한 평가</b><small>점수 항목과 기준을 그대로 보여줘요</small></span></div>
      </div>

      <details className="safety-policy">
        <summary>소비자 보호 설계 자세히 보기</summary>
        <ul>{data.guardrails.map((guardrail) => <li key={guardrail}>{guardrail}</li>)}</ul>
      </details>
      <p className="safety-disclaimer">{data.disclaimer}</p>
    </section>
  );
}
