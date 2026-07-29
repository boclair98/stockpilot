import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import "./globals.css";
import "./market.css";
import "./league.css";
import "./investor.css";
import "./rooms.css";
import "./practice.css";

const inter = Inter({ subsets: ["latin"], display: "swap" });

export const metadata = {
  title: "StockPilot — KRX·NXT 통합 시세 가상투자",
  description: "KIS KRX·NXT 통합 및 미국 주식 시세로 연습하는 가상투자 서비스",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="ko"><body className={inter.className}>{children}</body></html>;
}
