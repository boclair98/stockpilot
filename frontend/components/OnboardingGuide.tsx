"use client";

import { ChevronLeft, ChevronRight, History, Search, ShieldCheck, WalletCards, X } from "lucide-react";
import { useState } from "react";
import { useDialogFocus } from "@/lib/dialog-focus";

type Props = { open: boolean; onClose: () => void; onExplore: () => void };

const steps = [
  {
    icon: Search,
    kicker: "01 · 살펴보기",
    title: "궁금한 회사부터 찾아봐요",
    body: "회사명이나 종목코드로 한국·미국 주식을 찾아보세요. 가격과 차트, 기업 정보를 함께 살펴볼 수 있어요.",
    tip: "로그인하지 않아도 종목을 둘러볼 수 있어요.",
  },
  {
    icon: WalletCards,
    kicker: "02 · 직접 해보기",
    title: "연습 자금으로 주문해요",
    body: "Google 로그인 후 모의 매수·매도를 해보세요. 가격과 수량, 예상 금액을 확인한 뒤 주문을 확정해요.",
    tip: "실제 돈이 아니에요. 원화와 달러 자산은 각각 관리해요.",
  },
  {
    icon: History,
    kicker: "03 · 돌아보기",
    title: "결과와 이유를 함께 남겨요",
    body: "내 자산에서 보유 주식을 확인하고, 투자 기록에 사고판 이유를 남겨보세요. 다음 선택을 위한 기준을 만들어가요.",
    tip: "리그에서는 보유 종목을 공개하지 않고 수익률을 비교해요.",
  },
];

export default function OnboardingGuide({ open, onClose, onExplore }: Props) {
  const [step, setStep] = useState(0);
  const current = steps[step];

  useDialogFocus(open, ".onboarding-card", onClose);

  if (!open) return null;
  const Icon = current.icon;

  return (
    <div className="onboarding-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="onboarding-card" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
        <button type="button" className="onboarding-close" aria-label="시작 안내 닫기" onClick={onClose}>
          <X size={19} />
        </button>
        <div className="onboarding-progress" aria-label={`${step + 1}단계 / ${steps.length}단계`}>
          {steps.map((item, index) => <span key={item.title} className={index <= step ? "active" : ""} />)}
        </div>
        <div className="onboarding-icon"><Icon size={29} aria-hidden="true" /></div>
        <p className="onboarding-kicker">{current.kicker}</p>
        <h2 id="onboarding-title" aria-live="polite">{current.title}</h2>
        <p className="onboarding-body">{current.body}</p>
        <div className="onboarding-tip"><ShieldCheck size={16} /><span>{current.tip}</span></div>
        <div className="onboarding-actions">
          <button type="button" className="onboarding-secondary" disabled={step === 0} onClick={() => setStep((value) => value - 1)}>
            <ChevronLeft size={17} /> 이전
          </button>
          {step < steps.length - 1 ? (
            <button type="button" className="onboarding-primary" onClick={() => setStep((value) => value + 1)}>
              다음 <ChevronRight size={17} />
            </button>
          ) : (
            <button type="button" className="onboarding-primary" onClick={onExplore}>종목 찾아보기 <ChevronRight size={17} /></button>
          )}
        </div>
        <p className="onboarding-step-count">{step + 1} / {steps.length}</p>
      </section>
    </div>
  );
}
