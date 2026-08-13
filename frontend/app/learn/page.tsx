import type { Metadata } from "next";

import StockLearningCenter from "@/components/StockLearningCenter";

export const metadata: Metadata = {
  title: "주식 학습센터",
  description: "주식의 뜻부터 주문, 기업분석, 위험관리까지 실제 시세·라이브 게임·퀴즈로 쉽게 배우는 StockPilot Academy",
  alternates: { canonical: "/learn" },
};

export default function LearnPage() {
  return <StockLearningCenter />;
}

