"use client";

import { ReactNode, useEffect, useRef, useState } from "react";

export default function DeferredMount({
  children,
  minHeight = 280,
}: {
  children: ReactNode;
  minHeight?: number;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = anchor.current;
    if (!node || !("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "700px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={anchor} className="deferred-mount" style={{ minHeight: visible ? undefined : minHeight }}>
      {visible ? children : <div className="deferred-placeholder" aria-hidden="true" />}
    </div>
  );
}
