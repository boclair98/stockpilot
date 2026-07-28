import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import "./globals.css";
import "./market.css";

const inter = Inter({ subsets: ["latin"], display: "swap" });

export const metadata = {
  title: "StockPilot — KIS 실시간 가상투자",
  description: "KIS 국내·미국 주식 시세로 연습하는 자체 가상투자 서비스",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="ko"><body className={inter.className}>{children}</body></html>;
}
