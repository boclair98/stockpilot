"use client";

import { Download, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function InstallAppButton({
  variant = "topbar",
  onInstalled,
}: {
  variant?: "topbar" | "menu";
  onInstalled?: () => void;
}) {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(() => (
    typeof window !== "undefined" && window.matchMedia("(display-mode: standalone)").matches
  ));

  useEffect(() => {
    const capture = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
    };
    const markInstalled = () => {
      setInstalled(true);
      setPrompt(null);
      onInstalled?.();
    };
    window.addEventListener("beforeinstallprompt", capture);
    window.addEventListener("appinstalled", markInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", capture);
      window.removeEventListener("appinstalled", markInstalled);
    };
  }, [onInstalled]);

  if (!prompt || installed) return null;

  const Icon = variant === "menu" ? Smartphone : Download;

  return (
    <button
      type="button"
      className={`install-app-button${variant === "menu" ? " install-app-button--menu" : ""}`}
      onClick={async () => {
        await prompt.prompt();
        const choice = await prompt.userChoice;
        setPrompt(null);
        if (choice.outcome === "accepted") onInstalled?.();
      }}
    >
      <Icon size={variant === "menu" ? 20 : 15} />
      {variant === "menu" ? <span><b>안드로이드 앱 설치</b><small>홈 화면에서 빠르게 실행해요</small></span> : "앱으로 설치"}
    </button>
  );
}
