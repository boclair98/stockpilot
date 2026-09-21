"use client";

import Script from "next/script";

type Props = { client: string };

export default function AdSenseScript({ client }: Props) {
  if (!client) return null;

  return (
    <Script
      id="google-adsense"
      async
      strategy="afterInteractive"
      src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`}
      crossOrigin="anonymous"
    />
  );
}
