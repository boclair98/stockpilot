import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-metadata";

export const dynamic = "force-static";

const routes = ["", "/compare", "/learn", "/growth", "/league", "/practice", "/lounge", "/guide", "/pricing", "/privacy", "/terms", "/account-deletion"];

export default function sitemap(): MetadataRoute.Sitemap {
  return routes.map((route) => ({
    url: `${siteUrl}${route || "/"}`,
    // Only declare dates for pages actually changed in this release.
    ...(["", "/guide", "/learn"].includes(route) ? { lastModified: new Date("2026-10-20T00:00:00+09:00") } : {}),
    changeFrequency: route === "" ? "daily" : route === "/lounge" ? "hourly" : "weekly",
    priority: route === "" ? 1 : route === "/learn" ? 0.9 : route === "/growth" || route === "/league" ? 0.8 : 0.6,
  }));
}

