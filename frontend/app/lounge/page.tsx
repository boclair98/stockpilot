import type { Metadata } from "next";
import CommunityLounge from "@/components/CommunityLounge";

export const metadata: Metadata = {
  title: "투자 라운지",
  description: "보유 종목 공개 없이 투자 습관과 배움을 공유하는 StockPilot 커뮤니티",
};

export default function LoungePage() {
  return <CommunityLounge />;
}
