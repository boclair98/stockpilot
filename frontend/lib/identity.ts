"use client";

/**
 * Client-side identity helpers.
 *
 * StockPilot owns its Google OAuth session. The session cookie is HttpOnly,
 * so the SPA discovers identity through `/api/me`.
 */

import { useEffect, useState } from "react";

import { tracked } from "./warming";

export type Me = {
  id: string;
  coders_id: string;
  display_name: string;
  email: string | null;
  picture: string | null;
  provider: "google";
  first_seen_at: string;
};

// `undefined` = still loading; `null` = anonymous; Me = signed in.
export type MeState = Me | null | undefined;

export function useMe(): MeState {
  const [me, setMe] = useState<MeState>(undefined);
  useEffect(() => {
    let alive = true;
    tracked(async () => {
      const r = await fetch("/api/me", { credentials: "include" });
      if (!alive) return;
      if (r.ok) setMe(await r.json());
      else setMe(null);
    }).catch(() => {
      if (alive) setMe(null);
    });
    return () => {
      alive = false;
    };
  }, []);
  return me;
}

function currentLocation(): string {
  if (typeof window === "undefined") return "/";
  return window.location.pathname + window.location.search;
}

export function signInHref(returnTo?: string): string {
  return `/api/auth/google/login?return_to=${encodeURIComponent(returnTo ?? currentLocation())}`;
}

export function signOutHref(): string {
  return "/api/auth/logout";
}
