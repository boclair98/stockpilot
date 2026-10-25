"use client";

import { ReactNode, useEffect, useRef, useState } from "react";

export default function DeferredMount({
  children,
  minHeight = 280,
  rootMargin = "480px 0px",
  eager = false,
}: {
  children: ReactNode;
  minHeight?: number;
  rootMargin?: string;
  eager?: boolean;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Primary content may be revealed by a CSS workspace switch after the
    // observer starts on a hidden element. Its availability must not depend
    // on a later scroll/intersection event (including direct detail URLs).
    const node = anchor.current;
    if (eager || !node || !("IntersectionObserver" in window)) {
      const frame = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(frame);
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [rootMargin, eager]);

  const mounted = visible || eager;

  return (
    <div ref={anchor} className="deferred-mount" style={{ minHeight: mounted ? undefined : minHeight }}>
      {mounted ? children : <div className="deferred-placeholder" aria-hidden="true" />}
    </div>
  );
}

