import GrowthHub from "@/components/GrowthHub";
import { publicPageMetadata } from "@/lib/site-metadata";

export const metadata = publicPageMetadata("/growth", "투자 기록과 성장", "투자 일지와 성과를 돌아보고 나만의 투자 습관을 만들어 보세요. 모의투자 기록으로 배우는 StockPilot 성장 허브.");

export default function GrowthPage() {
  return <GrowthHub />;
}
