"use client";
import { useEffect } from "react";

/** Hash navigation can scroll the server-rendered market before React changes
 * the workspace. Reposition only on primary-view transitions, after commit;
 * filtering, sorting and background quote updates must not move the viewport. */
export function useWorkspaceStart(view: string) {
  useEffect(() => {
    if (!["WATCH", "ASSETS", "RECORDS"].includes(view)) return;
    const frame = requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
    return () => cancelAnimationFrame(frame);
  }, [view]);
}
