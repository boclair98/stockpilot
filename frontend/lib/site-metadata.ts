import type { Metadata } from "next";

export const siteUrl = "https://stockpilot.coders.kr";
export const socialImage = {
  url: "/social/stockpilot.png",
  width: 1200,
  height: 630,
  alt: "StockPilot — 실제 시세로, 내 돈 없이 투자 연습",
};

export function publicPageMetadata(path: string, title: string, description: string): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: "website", locale: "ko_KR", siteName: "StockPilot", url: path, title: `${title} | StockPilot`, description, images: [socialImage] },
    twitter: { card: "summary_large_image", title: `${title} | StockPilot`, description, images: [socialImage.url] },
  };
}
