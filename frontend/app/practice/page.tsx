import PracticeLab from "@/components/PracticeLab";
import { publicPageMetadata } from "@/lib/site-metadata";

export const metadata = publicPageMetadata("/practice", "주식 투자 연습", "주식의 기초와 투자 판단을 직접 연습하고 결과를 확인해 보세요. 내 돈 없이 배우는 StockPilot 투자 연습실.");

export default function PracticePage() {
  return <PracticeLab />;
}
