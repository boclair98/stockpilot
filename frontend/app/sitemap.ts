import type { MetadataRoute } from "next";

export const dynamic = "force-static";

const routes = ["", "/learn", "/growth", "/league", "/practice", "/lounge", "/guide", "/privacy", "/terms"];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date("2026-08-09T00:00:00+09:00");
  return routes.map((route) => ({
    url: `https://stockpilot.coders.kr${route || "/"}`,
    lastModified,
    changeFrequency: route === "" ? "daily" : route === "/lounge" ? "hourly" : "weekly",
    priority: route === "" ? 1 : route === "/learn" ? 0.9 : route === "/growth" || route === "/league" ? 0.8 : 0.6,
  }));
}

