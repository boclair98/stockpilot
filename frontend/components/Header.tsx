"use client";

import Link from "next/link";

import { useMe } from "@/lib/identity";
import { SignInLink, SignOutLink } from "./SignIn";

export function Header() {
  const me = useMe();

  return (
    <header className="flex items-center justify-between py-5">
      <Link
        href="/"
        className="text-[15px] font-semibold tracking-tight transition-colors hover:text-muted-foreground"
      >
        StockPilot
      </Link>
      <nav className="flex items-center gap-4">
        {me === undefined ? (
          <span aria-hidden className="opacity-0">·</span>
        ) : me ? (
          <>
            <Link
              href="/profile"
              className="text-[13px] text-muted-foreground transition-colors hover:text-foreground"
            >
              {me.display_name}
            </Link>
            <SignOutLink />
          </>
        ) : (
          <SignInLink size="sm" />
        )}
      </nav>
    </header>
  );
}
