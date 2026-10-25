"use client";

/**
 * Client-side identity helpers.
 *
 * StockPilot owns its Google OAuth session. The session cookie is HttpOnly,
 * so the SPA discovers identity through `/api/me`.
 */

import { useEffect, useState } from "react";

import { tracked } from "./warming";
import { requestJson } from "./reliable-request";

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
    const controller = new AbortController();
    tracked(async () => {
      const user = await requestJson<Me>("/api/me", { credentials: "include", signal: controller.signal });
      if (controller.signal.aborted) return;
      setMe(user && typeof user.id === "string" && typeof user.display_name === "string" ? user : null);
    }).catch(() => {
      if (!controller.signal.aborted) setMe(null);
    });
    return () => {
      controller.abort();
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
