/* global firebase */
importScripts("https://www.gstatic.com/firebasejs/12.3.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.3.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyB-Ynm3TORLK6q3IiJdrxIrRzn_3zV0sXs",
  authDomain: "stock-e7c73.firebaseapp.com",
  projectId: "stock-e7c73",
  storageBucket: "stock-e7c73.firebasestorage.app",
  messagingSenderId: "1026331457392",
  appId: "1:1026331457392:web:b541f3b82ab325ba5841b5",
});

const SHELL_CACHE = "stockpilot-shell-20260920-1";
const CORE_ASSETS = [
  "/",
  "/offline.html",
  "/manifest.webmanifest",
  "/icons/stockpilot-192.png",
  "/icons/stockpilot-512.png",
  "/icons/stockpilot-maskable-512.png",
  "/icons/stockpilot-badge-96.png",
];

// The same worker powers both PWA resilience and Firebase notifications.
// API and OAuth traffic is intentionally never cached.
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(CORE_ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("stockpilot-shell-") && key !== SHELL_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => (
          (await caches.match(request)) ||
          caches.match("/offline.html")
        )),
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || ["style", "script", "image", "font"].includes(request.destination)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })),
    );
  }
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};
  self.registration.showNotification(data.title || "StockPilot 가격 알림", {
    body: data.body || "설정한 목표 가격에 도달했어요.",
    icon: "/icons/stockpilot-192.png",
    badge: "/icons/stockpilot-badge-96.png",
    tag: data.alertId || "stockpilot-price-alert",
    renotify: true,
    data: { url: data.url || "/#investor-tools" },
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(
    event.notification.data?.url || "/#investor-tools",
    self.location.origin,
  ).href;
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const existing = windows.find((client) => client.url.startsWith(self.location.origin));
      if (existing) {
        existing.navigate(target);
        return existing.focus();
      }
      return clients.openWindow(target);
    }),
  );
});
