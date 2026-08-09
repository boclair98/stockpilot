"use client";

import { BarChart3, ChevronLeft, ChevronRight, Search, ShieldCheck, Trophy, X } from "lucide-react";
import { useEffect, useState } from "react";

type Props = { open: boolean; onClose: () => void };

const steps = [
  {
    icon: BarChart3,
    kicker: "STEP 1 · 시장 둘러보기",
    title: "한국과 미국 시장을 한눈에",
    body: "실시간 인기 종목, KOSPI 흐름, KRX·NXT 거래 상태를 먼저 확인해 보세요. 화면의 가격은 KIS 실제 시세를 바탕으로 표시됩니다.",
    tip: "시세 연결 상태는 홈 상단의 초록색 표시로 확인할 수 있어요.",
  },
  {
    icon: Search,
    kicker: "STEP 2 · 종목 찾기",
    title: "이름이나 종목코드로 검색",
    body: "상위 10개에 없는 종목도 검색할 수 있어요. 삼성전자·애플 같은 이름이나 005930·AAPL 같은 코드로 찾아보세요.",
    tip: "최근 본 종목은 기기에 저장되어 다시 빠르게 열 수 있어요.",
  },
  {
    icon: ShieldCheck,
    kicker: "STEP 3 · 가상 주문",
    title: "내 돈 없이 실전처럼 연습",
    body: "Google 로그인 후 가상자산으로 시장가·지정가·조건부 주문을 연습하세요. 주문 전 예상 금액과 보유 수량을 다시 확인합니다.",
    tip: "StockPilot 주문은 실제 증권계좌에 전송되지 않습니다.",
  },
  {
    icon: Trophy,
    kicker: "STEP 4 · 성장하기",
    title: "기록으로 배우고 리그로 도전",
    body: "투자 일지, 리플레이 훈련, 손익 분석으로 습관을 돌아보고 수익률 리그에서 보유 종목 공개 없이 실력을 겨뤄 보세요.",
    tip: "성장 허브에서 다음에 할 훈련을 추천받을 수 있어요.",
  },
];

export default function OnboardingGuide({ open, onClose }: Props) {
  const [step, setStep] = useState(0);
  const current = steps[step];

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

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
        <div className="onboarding-icon"><Icon size={29} /></div>
        <p className="onboarding-kicker">{current.kicker}</p>
        <h2 id="onboarding-title">{current.title}</h2>
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
            <button type="button" className="onboarding-primary" onClick={onClose}>시작하기 <ChevronRight size={17} /></button>
          )}
        </div>
      </section>
    </div>
  );
}
