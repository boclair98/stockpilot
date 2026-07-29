import { getApp, getApps, initializeApp } from "firebase/app";
import {
  deleteToken,
  getMessaging,
  getToken,
  isSupported,
  onMessage,
  type MessagePayload,
} from "firebase/messaging";

const firebaseConfig = {
  apiKey: "AIzaSyB-Ynm3TORLK6q3IiJdrxIrRzn_3zV0sXs",
  authDomain: "stock-e7c73.firebaseapp.com",
  projectId: "stock-e7c73",
  storageBucket: "stock-e7c73.firebasestorage.app",
  messagingSenderId: "1026331457392",
  appId: "1:1026331457392:web:b541f3b82ab325ba5841b5",
};

const vapidKey =
  "BOMLsaznbUjVNm-3Ak3Fyrmqlf-h58BbC3a377USOOHsh5Z9gY_XlFs8jr8YR_gSgyisBxMv-dhrKp53RZYytjA";

async function messagingClient() {
  if (
    typeof window === "undefined" ||
    !("Notification" in window) ||
    !(await isSupported())
  ) {
    return null;
  }
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  return getMessaging(app);
}

async function workerRegistration() {
  if (!("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.register("/firebase-messaging-sw.js", {
    scope: "/",
  });
}

export function browserPushState(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission;
}

export async function enableBrowserPush(): Promise<string> {
  const messaging = await messagingClient();
  if (!messaging) throw new Error("이 브라우저에서는 푸시 알림을 지원하지 않아요.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "브라우저 설정에서 StockPilot 알림을 허용해 주세요."
        : "알림 권한이 허용되지 않았어요.",
    );
  }
  const registration = await workerRegistration();
  if (!registration) throw new Error("알림 서비스 워커를 등록하지 못했어요.");
  const token = await getToken(messaging, {
    vapidKey,
    serviceWorkerRegistration: registration,
  });
  if (!token) throw new Error("Firebase 기기 토큰을 발급하지 못했어요.");
  return token;
}

export async function disableBrowserPush(): Promise<string | null> {
  const messaging = await messagingClient();
  if (!messaging) return null;
  const registration = await workerRegistration();
  const token = await getToken(messaging, {
    vapidKey,
    serviceWorkerRegistration: registration ?? undefined,
  });
  await deleteToken(messaging);
  return token || null;
}

export async function restoreBrowserPush(): Promise<string | null> {
  if (browserPushState() !== "granted") return null;
  const messaging = await messagingClient();
  const registration = await workerRegistration();
  if (!messaging || !registration) return null;
  return getToken(messaging, {
    vapidKey,
    serviceWorkerRegistration: registration,
  });
}

export async function listenForForegroundPush(
  handler: (payload: MessagePayload) => void,
): Promise<() => void> {
  const messaging = await messagingClient();
  if (!messaging) return () => undefined;
  return onMessage(messaging, handler);
}
