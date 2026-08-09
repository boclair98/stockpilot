"use client";

import {
  BarChart3,
  BrainCircuit,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  ShieldCheck,
  Trophy,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  live: boolean;
  statusText: string;
};

const slides = [
  {
    id: "market",
    kicker: "LIVE MARKET ACCESS",
    title: <>한국과 미국 시장을<br /><em>한 화면에서.</em></>,
    description: "KRX·NXT 통합 국내 시세와 미국 현지시장 시세를 빠르게 비교하고, 전체 종목을 이름과 코드로 찾아보세요.",
    icon: BarChart3,
    previewTitle: "실시간 시장 보드",
    previewRows: ["KRX+NXT 통합 시세", "한국 주식 TOP 10", "미국 주식 TOP 10"],
  },
  {
    id: "practice",
    kicker: "SAFE PAPER TRADING",
    title: <>실전처럼 주문하고<br /><em>내 돈은 안전하게.</em></>,
    description: "시장가·지정가·조건부 주문을 실제 시세로 연습하세요. 모든 주문은 StockPilot 가상원장 안에서만 처리됩니다.",
    icon: CircleDollarSign,
    previewTitle: "가상주문 연습",
    previewRows: ["시장가·지정가", "미보유 매도 자동 차단", "실제 주문 전송 없음"],
  },
  {
    id: "growth",
    kicker: "LEARN · RECORD · COMPETE",
    title: <>기록하고 겨루며<br /><em>투자 감각을 키워요.</em></>,
    description: "투자일지와 시세 리플레이로 복기하고, 보유 종목 공개 없이 수익률 리그와 투자 라운지에 참여하세요.",
    icon: Trophy,
    previewTitle: "나의 성장 루틴",
    previewRows: ["5분 투자 챌린지", "투자일지·거래 복기", "수익률 리그·라운지"],
  },
] as const;

export default function MarketHeroCarousel({ live, statusText }: Props) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchStart = useRef<number | null>(null);

  const move = useCallback((direction: number) => {
    setActive((current) => (current + direction + slides.length) % slides.length);
  }, []);

  useEffect(() => {
    if (paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => move(1), 5_500);
    return () => window.clearInterval(timer);
  }, [move, paused]);

  return (
    <div
      className="market-hero-carousel"
      role="region"
      aria-roledescription="carousel"
      aria-label="StockPilot 주요 기능"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      onTouchStart={(event) => { touchStart.current = event.touches[0]?.clientX ?? null; }}
      onTouchEnd={(event) => {
        if (touchStart.current === null) return;
        const distance = event.changedTouches[0].clientX - touchStart.current;
        if (Math.abs(distance) > 45) move(distance < 0 ? 1 : -1);
        touchStart.current = null;
      }}
    >
      <div className="market-hero-viewport">
        <div className="market-hero-track" style={{ transform: `translate3d(-${active * 100}%, 0, 0)` }}>
          {slides.map((slide, index) => {
            const Icon = slide.icon;
            return (
              <article className="market-hero-slide" key={slide.id} aria-hidden={active !== index}>
                <div className="hero-copy">
                  <p className="eyebrow">
                    <span className={live ? "live-dot" : "live-dot off"} />
                    {index === 0 ? statusText : index === 1 ? "100% 가상자산으로 안전하게 연습" : "기록과 복기로 만드는 투자 습관"}
                  </p>
                  <span className="hero-kicker">{slide.kicker}</span>
                  <h1>{slide.title}</h1>
                  <p>{slide.description}</p>
                </div>
                <div className={`hero-feature-preview preview-${slide.id}`} aria-hidden="true">
                  <div className="hero-preview-head"><span><Icon size={18} /></span><div><small>STOCKPILOT</small><b>{slide.previewTitle}</b></div></div>
                  <div className="hero-preview-chart"><i /><i /><i /><i /><i /><i /></div>
                  <div className="hero-preview-rows">
                    {slide.previewRows.map((row, rowIndex) => <span key={row}><i>{rowIndex + 1}</i><b>{row}</b><ChevronRight size={14} /></span>)}
                  </div>
                  <p><ShieldCheck size={13} /> 실제 계좌번호·비밀번호가 필요하지 않아요</p>
                </div>
              </article>
            );
          })}
        </div>
      </div>
      <div className="market-hero-controls">
        <button type="button" onClick={() => move(-1)} aria-label="이전 소개 화면"><ChevronLeft size={17} /></button>
        <div>{slides.map((slide, index) => <button type="button" key={slide.id} className={active === index ? "active" : ""} onClick={() => setActive(index)} aria-label={`${index + 1}번 소개 화면`} aria-current={active === index ? "true" : undefined} />)}</div>
        <button type="button" onClick={() => move(1)} aria-label="다음 소개 화면"><ChevronRight size={17} /></button>
      </div>
      <div className="market-hero-shortcuts">
        <a href="/practice"><BrainCircuit size={14} /> 시세 연습</a>
        <a href="/league"><Trophy size={14} /> 리그 참여</a>
      </div>
    </div>
  );
}
