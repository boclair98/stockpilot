import type { ReactNode } from "react";
import "./globals.css";
import "./market.css";
import "./market-index.css";
import "./stock-trend.css";
import "./league.css";
import "./investor.css";
import "./rooms.css";
import "./practice.css";
import "./order-safety.css";

export const metadata = {
  title: "StockPilot — KRX·NXT 통합 시세 가상투자",
  description: "KIS KRX·NXT 통합 및 미국 주식 시세로 연습하는 가상투자 서비스",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="ko"><body>{children}</body></html>;
}
