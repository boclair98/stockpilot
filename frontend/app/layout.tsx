import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import AdSenseScript from "@/components/AdSenseScript";
import MobileServiceNav from "@/components/MobileServiceNav";
import PwaRuntime from "@/components/PwaRuntime";
import GlobalDisplayControls from "@/components/GlobalDisplayControls";
import { adsenseClient } from "@/lib/ads";
import { siteUrl, socialImage } from "@/lib/site-metadata";
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
import "./simulation-control.css";
import "./kospi-benchmark.css";
import "./replay.css";
import "./ux.css";
import "./briefing.css";
import "./performance.css";
import "./watchlist.css";
import "./market-navigation.css";
import "./pricing.css";
import "./monetization.css";
import "./ads.css";
import "./pwa.css";
import "./app-polish.css";
import "./workspace.css";
import "./consumer.css";
import "./stockpilot-design.css";
import "./theme-contrast.css";
import "./comparison.css";
import "./mobile-refinements.css";
import "./release-safety.css";
import "./personal.css";
import "./welcome.css";
import "./order-history.css";
import "./holdings-upgrade.css";
import "./analytics-recovery.css";
import "./trade-calendar.css";
import "./brokerage-workspace.css";
import "./us-market-details.css";
import "./broker-chart.css";
import "./broker-rankings.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "StockPilot — 실제 시세로, 내 돈 없이 투자 연습",
    template: "%s | StockPilot",
  },
  description: "한국·미국 주식을 실제 시세로 살펴보고, 연습 자금으로 모의 매수·매도를 해보세요. 종목 비교부터 투자 기록과 수익률 리그까지 StockPilot에서 함께해요.",
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
    images: [socialImage],
  },
  twitter: {
    card: "summary_large_image",
    title: "StockPilot — 실전처럼 배우는 가상투자",
    description: "KRX·NXT·미국주식 실제 시세 기반 가상투자 서비스",
    images: [socialImage.url],
  },
  robots: { index: true, follow: true },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/stockpilot-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/icons/stockpilot-192.png",
    apple: [{ url: "/icons/stockpilot-192.png", sizes: "192x192", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "StockPilot",
  },
};

export const viewport: Viewport = {
  themeColor: "#2463EB",
  colorScheme: "light dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="ko"><body>{children}<AdSenseScript client={adsenseClient} /><PwaRuntime /><MobileServiceNav /><GlobalDisplayControls/></body></html>;
}

