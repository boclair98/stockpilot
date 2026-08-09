import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "StockPilot — 가상투자",
    short_name: "StockPilot",
    description: "KRX·NXT·미국주식 실제 시세 기반 가상투자 서비스",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f6f7f9",
    theme_color: "#11151c",
    lang: "ko-KR",
    categories: ["finance", "education"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
