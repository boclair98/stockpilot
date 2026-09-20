import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "StockPilot — 가상투자",
    short_name: "StockPilot",
    description: "KRX·NXT·미국주식 실제 시세 기반 가상투자 서비스",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    background_color: "#f6f7f9",
    theme_color: "#11151c",
    lang: "ko-KR",
    categories: ["finance", "education"],
    icons: [
      { src: "/icons/stockpilot-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/stockpilot-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/stockpilot-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
    shortcuts: [
      { name: "가상투자 시작", short_name: "가상투자", url: "/?source=shortcut" },
      { name: "투자 학습", short_name: "학습", url: "/learn?source=shortcut" },
      { name: "수익률 리그", short_name: "리그", url: "/league?source=shortcut" },
    ],
  };
}
