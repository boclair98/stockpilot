"use client";

/* eslint-disable @next/next/no-img-element */

import { useMemo, useState } from "react";

type Brand = {
  src: string;
  background?: string;
};

const simpleIcon = (slug: string, color?: string) =>
  `https://cdn.simpleicons.org/${slug}${color ? `/${color}` : ""}`;
const favicon = (domain: string) =>
  `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;

const brands: Record<string, Brand> = {
  "005930": { src: simpleIcon("samsung", "1428A0") },
  "000660": { src: favicon("skhynix.com") },
  "373220": { src: simpleIcon("lg", "A50034") },
  "207940": { src: favicon("samsungbiologics.com") },
  "005380": { src: simpleIcon("hyundai", "002C5F") },
  "068270": { src: favicon("celltrion.com") },
  "105560": { src: favicon("kbfg.com") },
  "035420": { src: simpleIcon("naver", "03C75A") },
  "000270": { src: simpleIcon("kia", "05141F") },
  "329180": { src: favicon("hd-hhi.com") },
  NVDA: { src: simpleIcon("nvidia", "76B900") },
  MSFT: { src: favicon("microsoft.com") },
  AAPL: { src: simpleIcon("apple", "000000") },
  AMZN: { src: favicon("amazon.com") },
  GOOGL: { src: simpleIcon("google") },
  GOOG: { src: simpleIcon("google") },
  META: { src: simpleIcon("meta", "0866FF") },
  AVGO: { src: simpleIcon("broadcom", "E31837") },
  TSLA: { src: simpleIcon("tesla", "CC0000") },
  NFLX: { src: simpleIcon("netflix", "E50914") },
  COST: { src: favicon("costco.com") },
  AMD: { src: simpleIcon("amd", "000000") },
  INTC: { src: simpleIcon("intel", "0071C5") },
  ORCL: { src: simpleIcon("oracle", "F80000") },
  IBM: { src: simpleIcon("ibm", "052FAD") },
  PLTR: { src: simpleIcon("palantir", "101113") },
  CRM: { src: simpleIcon("salesforce", "00A1E0") },
  ADBE: { src: simpleIcon("adobe", "FF0000") },
  DIS: { src: simpleIcon("disney", "113CCF") },
  UBER: { src: simpleIcon("uber", "000000") },
  ABNB: { src: simpleIcon("airbnb", "FF5A5F") },
  SPOT: { src: simpleIcon("spotify", "1ED760") },
  NKE: { src: simpleIcon("nike", "111111") },
  V: { src: simpleIcon("visa", "1A1F71") },
  MA: { src: simpleIcon("mastercard") },
};

export default function StockLogo({
  symbol,
  name,
  color,
  large = false,
}: {
  symbol: string;
  name: string;
  color: string;
  large?: boolean;
}) {
  const normalized = symbol.toUpperCase();
  const brand = useMemo(() => brands[normalized], [normalized]);
  const [failedSource, setFailedSource] = useState("");

  const showImage = Boolean(brand?.src && failedSource !== brand.src);

  return (
    <span
      className={`symbol-logo${large ? " large" : ""}${showImage ? " brand-logo" : ""}`}
      style={{ background: showImage ? brand?.background || "#ffffff" : color }}
      title={`${name} 로고`}
    >
      {showImage ? (
        <img
          src={brand?.src}
          alt={`${name} 로고`}
          loading="lazy"
          onError={() => setFailedSource(brand?.src || "")}
        />
      ) : (
        name.trim().charAt(0) || normalized.charAt(0)
      )}
    </span>
  );
}
