import StockLearningCenter from "@/components/StockLearningCenter";
import { publicPageMetadata } from "@/lib/site-metadata";

export const metadata = publicPageMetadata("/learn", "주식 학습센터", "주식의 뜻부터 주문, 기업분석, 위험관리까지 짧은 코스와 퀴즈로 쉽게 배우는 StockPilot 주식 학습센터.");

export default function LearnPage() {
  return <StockLearningCenter />;
}
