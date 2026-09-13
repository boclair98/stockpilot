import type { Metadata } from "next";

import PricingPage from "@/components/PricingPage";

export const metadata: Metadata = {
  title: "플랜 안내",
  description: "StockPilot 무료·Pro·Team 플랜과 출시 알림을 확인하세요.",
};

export default function PricingRoute() {
  return <PricingPage />;
}
