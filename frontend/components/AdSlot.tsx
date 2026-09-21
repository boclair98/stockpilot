"use client";

import { useEffect, useRef } from "react";

import { adSlotFor, adsenseClient, isAdsConfigured, type AdPlacement } from "@/lib/ads";

declare global {
  interface Window {
    adsbygoogle?: Array<Record<string, unknown>>;
  }
}

type Props = {
  placement: AdPlacement;
  label?: string;
};

/**
 * A conservative responsive ad surface for the website and TWA web content.
 * It is not rendered until both the publisher client and the placement slot
 * have been configured, which keeps previews and unverified deployments clean.
 */
export default function AdSlot({ placement, label = "광고" }: Props) {
  const pushed = useRef(false);
  const slot = adSlotFor(placement);
  const enabled = isAdsConfigured(placement);

  useEffect(() => {
    if (!enabled || pushed.current) return;

    try {
      window.adsbygoogle = window.adsbygoogle || [];
      window.adsbygoogle.push({});
      pushed.current = true;
    } catch {
      // An ad blocker or a pending consent flow should not affect trading UI.
    }
  }, [enabled]);

  if (!enabled) return null;

  return (
    <aside className={`ad-slot ad-slot-${placement}`} aria-label={`${label} 영역`}>
      <span className="ad-slot-label">{label}</span>
      <ins
        className="adsbygoogle"
        style={{ display: "block", width: "100%" }}
        data-ad-client={adsenseClient}
        data-ad-slot={slot}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </aside>
  );
}
