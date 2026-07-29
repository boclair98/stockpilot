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

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};
  self.registration.showNotification(data.title || "StockPilot 가격 알림", {
    body: data.body || "설정한 목표 가격에 도달했어요.",
    icon: "/icons/stockpilot.svg",
    badge: "/icons/stockpilot-badge.svg",
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
