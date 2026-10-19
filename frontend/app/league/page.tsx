import LeagueBoard from "@/components/LeagueBoard";
import { publicPageMetadata } from "@/lib/site-metadata";

export const metadata = publicPageMetadata("/league", "모의투자 수익률 리그", "보유 종목은 비공개로, 수익률로 함께 겨뤄보세요. 전체 리그와 친구 초대 리그에서 투자 연습을 이어가요.");

export default function LeaguePage() {
  return <LeagueBoard />;
}
