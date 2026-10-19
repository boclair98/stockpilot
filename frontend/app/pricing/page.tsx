import PricingPage from "@/components/PricingPage";
import { publicPageMetadata } from "@/lib/site-metadata";

export const metadata = publicPageMetadata("/pricing", "플랜 안내", "StockPilot 무료·Pro·Team 플랜과 출시 알림을 확인하세요.");

export default function PricingRoute() {
  return <PricingPage />;
}
