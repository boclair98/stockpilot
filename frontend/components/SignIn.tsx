"use client";

import { LogOut } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { signInHref } from "@/lib/identity";

export function SignInLink({
  returnTo,
  size = "default",
}: {
  returnTo?: string;
  size?: "sm" | "default" | "lg";
}) {
  return (
    <a
      href={signInHref(returnTo)}
      className={cn(buttonVariants({ size }))}
    >
      Google로 로그인
    </a>
  );
}

export function SignOutLink() {
  return (
    <button
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
        location.href = "/";
      }}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <LogOut className="size-3.5" />
      로그아웃
    </button>
  );
}
