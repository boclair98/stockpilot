"use client";
import { useSyncExternalStore } from "react";

function subscribe(callback: () => void) {
  window.addEventListener("popstate", callback);
  window.addEventListener("personal-navigation", callback);
  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener("personal-navigation", callback);
  };
}
const snapshot = () => window.location.search;
const serverSnapshot = () => "";

/** URL-backed tabs survive refresh, direct links and browser back/forward. */
export function usePersonalTab(allowed: readonly string[], fallback: string) {
  const search = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const value = new URLSearchParams(search).get("tab") || fallback;
  const tab = allowed.includes(value) ? value : fallback;
  const select = (next: string) => {
    if (next === tab || !allowed.includes(next)) return;
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.pushState(null, "", url);
    window.dispatchEvent(new Event("personal-navigation"));
  };
  return [tab, select] as const;
}
