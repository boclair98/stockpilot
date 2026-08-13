import type { Metadata } from "next";
import { BarChart3, BookOpen, GraduationCap, Search, ShieldCheck, Trophy, WalletCards } from "lucide-react";
import Link from "next/link";
import ServicePageShell from "@/components/ServicePageShell";

export const metadata: Metadata = { title: "이용 가이드", description: "StockPilot 가상투자를 안전하게 시작하는 방법" };

const steps = [
  [GraduationCap, "주식 이해", "학습센터에서 주식의 뜻, 가격, 주문, 기업분석과 위험관리부터 익혀 보세요."],
  [Search, "종목 찾기", "홈 검색창에서 회사명이나 종목코드를 입력하세요. 한국·미국 시장을 나누어 찾을 수도 있어요."],
  [WalletCards, "가상 주문", "Google 로그인 후 시장가·지정가·손절·조건부 지정가를 선택하고 주문 확인을 거쳐 제출하세요."],
  [BarChart3, "성과 확인", "보유 종목, 평균 단가, 평가손익과 자산 배분을 살펴보고 투자 일지에 판단을 기록하세요."],
  [Trophy, "훈련과 리그", "시세 리플레이로 판단을 연습하고, 수익률 리그에서 보유 종목 공개 없이 결과를 비교하세요."],
] as const;

export default function GuidePage() {
  return (
    <ServicePageShell eyebrow="GETTING STARTED" title="StockPilot 이용 가이드" description="처음 방문해도 몇 분 안에 가상투자를 시작할 수 있도록 핵심 흐름을 정리했어요.">
      <section>
        <h2><BookOpen size={20} /> 빠른 시작</h2>
        <div className="guide-step-grid">{steps.map(([Icon, title, body], index) => <div className="guide-step" key={title}><span>{index + 1}</span><Icon size={21} /><h3>{title}</h3><p>{body}</p></div>)}</div>
      </section>
      <section>
        <h2><ShieldCheck size={20} /> 실제 서비스와 다른 점</h2>
        <div className="service-callout"><b>StockPilot은 학습용 가상투자 서비스입니다.</b><p>표시되는 시세는 한국투자증권 KIS API 등 외부 데이터를 바탕으로 하지만 주문은 StockPilot 내부에서만 처리되며 실제 증권계좌나 거래소로 전송되지 않습니다. 수수료·세금·체결 지연 등은 실제 거래와 다를 수 있어요.</p></div>
      </section>
      <section><h2>자주 묻는 질문</h2><div className="service-faq"><details><summary>로그인하지 않아도 이용할 수 있나요?</summary><p>시세, 종목 검색, 지수와 공시는 누구나 볼 수 있습니다. 가상 주문, 개인 기록, 라운지 작성처럼 저장이 필요한 기능은 Google 로그인이 필요해요.</p></details><details><summary>왜 가격이 다른 증권 앱과 조금 다른가요?</summary><p>시장 운영 시간, KRX·NXT 거래소 선택, 데이터 갱신 시점과 제공사의 지연 정책에 따라 차이가 날 수 있습니다. 화면에 표시된 출처와 기준 시각을 함께 확인해 주세요.</p></details><details><summary>가상자산을 잃으면 실제 돈도 줄어드나요?</summary><p>아니요. StockPilot의 원화·달러 잔액은 연습용 가상자산이며 실제 예금이나 증권계좌와 연결되지 않습니다.</p></details><details><summary>앱처럼 설치할 수 있나요?</summary><p>지원하는 Chrome·Edge·Android 환경에서는 주소창 또는 상단 ‘앱으로 설치’ 버튼으로 홈 화면에 설치할 수 있습니다. iPhone은 Safari 공유 메뉴의 ‘홈 화면에 추가’를 사용하세요.</p></details></div></section>
      <section className="service-cta"><div><b>주식이 처음인가요?</b><p>12개 짧은 코스와 용어사전, 퀴즈로 기초를 익힌 뒤 가상주문을 시작해 보세요.</p></div><Link href="/learn">학습센터 열기</Link></section>
    </ServicePageShell>
  );
}

