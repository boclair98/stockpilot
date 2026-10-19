import CommunityLounge from "@/components/CommunityLounge";
import { publicPageMetadata } from "@/lib/site-metadata";

export const metadata = publicPageMetadata("/lounge", "투자 라운지", "보유 종목 공개 없이 투자 습관과 배움을 공유하는 StockPilot 커뮤니티.");

export default function LoungePage() {
  return <CommunityLounge />;
}
