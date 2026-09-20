"use client";

import { CloudOff, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const serviceWorkerUrl = "/firebase-messaging-sw.js?v=20260920-1";

export default function PwaRuntime() {
  // Some Android in-app browsers report navigator.onLine=false while requests
  // still succeed. Start optimistic and react to real online/offline events.
  const [online, setOnline] = useState(true);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const refreshing = useRef(false);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    if (!("serviceWorker" in navigator)) {
      return () => {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
      };
    }

    const watchInstallingWorker = (worker: ServiceWorker) => {
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          setWaitingWorker(worker);
        }
      });
    };

    navigator.serviceWorker
      .register(serviceWorkerUrl, { scope: "/", updateViaCache: "none" })
      .then((registration) => {
        if (registration.waiting) setWaitingWorker(registration.waiting);
        if (registration.installing) watchInstallingWorker(registration.installing);
        registration.addEventListener("updatefound", () => {
          if (registration.installing) watchInstallingWorker(registration.installing);
        });
      })
      .catch(() => undefined);

    const reloadOnActivation = () => {
      if (refreshing.current) window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", reloadOnActivation);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      navigator.serviceWorker.removeEventListener("controllerchange", reloadOnActivation);
    };
  }, []);

  if (online && !waitingWorker) return null;

  return (
    <aside className={`pwa-status${online ? " pwa-status--update" : ""}`} role="status" aria-live="polite">
      {online ? <RefreshCw size={18} /> : <CloudOff size={18} />}
      <div>
        <b>{online ? "새 버전이 준비됐어요" : "인터넷 연결을 확인해 주세요"}</b>
        <small>{online ? "업데이트하면 개선된 화면을 바로 사용할 수 있어요." : "저장된 화면은 계속 볼 수 있고, 연결되면 자동으로 복구돼요."}</small>
      </div>
      {online ? (
        <button
          type="button"
          onClick={() => {
            refreshing.current = true;
            waitingWorker?.postMessage({ type: "SKIP_WAITING" });
          }}
        >
          업데이트
        </button>
      ) : (
        <button type="button" onClick={() => window.location.reload()}>재시도</button>
      )}
    </aside>
  );
}
