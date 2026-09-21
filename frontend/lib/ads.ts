export type AdPlacement = "home" | "market-news" | "growth" | "league";

/**
 * Web ads are intentionally opt-in. A deployment without a client and slot
 * IDs renders no placeholder, so the product never looks broken while the
 * AdSense account is being reviewed.
 */
export const adsenseClient = process.env.NEXT_PUBLIC_ADSENSE_CLIENT?.trim() ?? "";

const slots: Record<AdPlacement, string> = {
  home: process.env.NEXT_PUBLIC_ADSENSE_HOME_SLOT?.trim() ?? "",
  "market-news": process.env.NEXT_PUBLIC_ADSENSE_NEWS_SLOT?.trim() ?? "",
  growth: process.env.NEXT_PUBLIC_ADSENSE_GROWTH_SLOT?.trim() ?? "",
  league: process.env.NEXT_PUBLIC_ADSENSE_LEAGUE_SLOT?.trim() ?? "",
};

export function adSlotFor(placement: AdPlacement): string {
  return slots[placement];
}

export function isAdsConfigured(placement: AdPlacement): boolean {
  return Boolean(adsenseClient && adSlotFor(placement));
}
