import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import MobileServiceNav from "@/components/MobileServiceNav";
import "./globals.css";
import "./market.css";
import "./market-index.css";
import "./stock-trend.css";
import "./league.css";
import "./investor.css";
import "./rooms.css";
import "./practice.css";
import "./order-safety.css";
import "./growth.css";
import "./polish.css";
import "./experience.css";
import "./hero-carousel.css";
import "./mobile-nav.css";
import "./operations.css";
import "./lounge.css";
import "./lounge-overrides.css";
import "./service-pages.css";
import "./responsive.css";
import "./learn.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://stockpilot.coders.kr"),
  title: {
    default: "StockPilot — KRX·NXT·미국주식 가상투자",
    template: "%s | StockPilot",
  },
  description: "주식 기초부터 KRX·NXT·미국주식 실제 시세 가상투자까지 배우고 연습하는 투자 학습 서비스",
  applicationName: "StockPilot",
  keywords: ["주식 기초", "주식 공부", "모의투자", "가상투자", "주식 연습", "KRX", "NXT", "미국주식", "수익률 리그"],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "ko_KR",
    url: "/",
    siteName: "StockPilot",
    title: "StockPilot — 실전처럼 배우는 가상투자",
    description: "실제 시세, 안전한 가상 주문, 수익률 리그와 투자 훈련을 한곳에서 경험하세요.",
  },
  twitter: {
    card: "summary",
    title: "StockPilot — 실전처럼 배우는 가상투자",
    description: "KRX·NXT·미국주식 실제 시세 기반 가상투자 서비스",
  },
  robots: { index: true, follow: true },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    shortcut: "/icon.svg",
    apple: "/icons/stockpilot.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#11151c",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="ko"><body>{children}<MobileServiceNav /></body></html>;
}
