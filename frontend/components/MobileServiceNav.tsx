"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  BrainCircuit,
  Gauge,
  GraduationCap,
  Home,
  Menu,
  MessageCircle,
  ShieldCheck,
  Trophy,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

const primaryItems = [
  { href: "/", label: "홈", icon: Home },
  { href: "/learn", label: "학습", icon: GraduationCap },
  { href: "/league", label: "리그", icon: Trophy },
  { href: "/practice", label: "연습", icon: BrainCircuit },
];

const moreItems = [
  {
    href: "/growth",
    label: "성장 허브",
    description: "미션과 리포트로 습관을 키워요",
    icon: Gauge,
  },
  {
    href: "/lounge",
    label: "투자 라운지",
    description: "투자 습관과 배움을 나눠요",
    icon: MessageCircle,
  },
  {
    href: "/profile",
    label: "내 프로필",
    description: "계정과 알림 설정을 확인해요",
    icon: UserRound,
  },
  {
    href: "/guide",
    label: "처음 이용 안내",
    description: "StockPilot의 모든 기능을 살펴봐요",
    icon: BookOpen,
  },
];

function isCurrent(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export default function MobileServiceNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const hideNavigation = pathname.startsWith("/operations");

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.body.classList.add("mobile-menu-open");
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.classList.remove("mobile-menu-open");
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  if (hideNavigation) return null;

  const moreActive = moreItems.some((item) => isCurrent(pathname, item.href));

  return (
    <>
      {open && (
        <div className="mobile-menu-layer">
          <button
            type="button"
            className="mobile-menu-backdrop"
            aria-label="전체 메뉴 닫기"
            onClick={() => setOpen(false)}
          />
          <section id="mobile-menu-sheet" className="mobile-menu-sheet" role="dialog" aria-modal="true" aria-labelledby="mobile-menu-title">
            <header>
              <div>
                <span>STOCKPILOT</span>
                <h2 id="mobile-menu-title">전체 기능</h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="전체 메뉴 닫기">
                <X size={21} />
              </button>
            </header>

            <div className="mobile-menu-grid">
              {moreItems.map(({ href, label, description, icon: Icon }) => (
                <Link className={isCurrent(pathname, href) ? "active" : ""} href={href} key={href} onClick={() => setOpen(false)}>
                  <span><Icon size={20} /></span>
                  <div><b>{label}</b><small>{description}</small></div>
                </Link>
              ))}
            </div>

            <div className="mobile-menu-note">
              <ShieldCheck size={18} />
              <p><b>실거래 없는 가상투자</b><small>실제 주문이나 고객 자산을 다루지 않아요.</small></p>
            </div>

            <footer>
              <Link href="/privacy" onClick={() => setOpen(false)}>개인정보처리방침</Link>
              <Link href="/terms" onClick={() => setOpen(false)}>이용약관</Link>
            </footer>
          </section>
        </div>
      )}

      <nav className="mobile-service-nav" aria-label="모바일 주요 메뉴">
        {primaryItems.map(({ href, label, icon: Icon }) => {
          const active = isCurrent(pathname, href);
          return (
            <Link href={href} className={active ? "active" : ""} aria-current={active ? "page" : undefined} key={href}>
              <span><Icon size={21} strokeWidth={active ? 2.5 : 2} /></span>
              <small>{label}</small>
            </Link>
          );
        })}
        <button
          type="button"
          className={open || moreActive ? "active" : ""}
          aria-expanded={open}
          aria-controls="mobile-menu-sheet"
          onClick={() => setOpen((value) => !value)}
        >
          <span><Menu size={21} strokeWidth={open || moreActive ? 2.5 : 2} /></span>
          <small>전체</small>
        </button>
      </nav>
    </>
  );
}

