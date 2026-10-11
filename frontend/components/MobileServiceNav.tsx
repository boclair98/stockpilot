"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  BadgeCheck,
  BrainCircuit,
  Gauge,
  GraduationCap,
  Home,
  Star,
  Wallet,
  History,
  Menu,
  MessageCircle,
  ShieldCheck,
  Trophy,
  UserRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useDialogFocus } from "@/lib/dialog-focus";
const subscribeHash = (callback: () => void) => {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
};
const readHash = () => window.location.hash;

const primaryItems = [
  { href: "/", label: "시장", icon: Home },
  { href: "/#favorite-board-title", label: "관심", icon: Star },
  { href: "/#holdings", label: "내 자산", icon: Wallet },
  { href: "/#decision-review", label: "투자 기록", icon: History },
];

const moreItems = [
  {
    href: "/practice",
    label: "투자 연습",
    description: "별도 시나리오에서 익히는 판단",
    icon: BrainCircuit,
  },
  {
    href: "/league",
    label: "수익률 리그",
    description: "보유 종목 비공개 · 수익률 순위",
    icon: Trophy,
  },
  {
    href: "/learn",
    label: "주식 학습",
    description: "기초부터 연습까지",
    icon: GraduationCap,
  },
  {
    href: "/#decision-review",
    label: "판단 기록",
    description: "종목별 개인 메모와 주문 기록",
    icon: BookOpen,
  },
  {
    href: "/pricing",
    label: "Pro 플랜",
    description: "개인·팀 멤버십과 출시 알림",
    icon: BadgeCheck,
  },
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
  const hash = useSyncExternalStore(subscribeHash, readHash, () => "");
  const [open, setOpen] = useState(false);
  const closeMenu = useCallback(() => setOpen(false), []);
  useDialogFocus(open, ".mobile-menu-sheet", closeMenu);
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
            onClick={closeMenu}
          />
          <section
            id="mobile-menu-sheet"
            className="mobile-menu-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-menu-title"
          >
            <header>
              <div>
                <span>STOCKPILOT</span>
                <h2 id="mobile-menu-title">전체 기능</h2>
              </div>
              <button
                type="button"
                onClick={closeMenu}
                aria-label="전체 메뉴 닫기"
              >
                <X size={21} />
              </button>
            </header>

            <div className="mobile-menu-grid">
              {moreItems.map(({ href, label, description, icon: Icon }) => (
                <Link
                  className={isCurrent(pathname, href) ? "active" : ""}
                  href={href}
                  key={href}
                  onClick={closeMenu}
                >
                  <span>
                    <Icon size={20} />
                  </span>
                  <div>
                    <b>{label}</b>
                    <small>{description}</small>
                  </div>
                </Link>
              ))}
            </div>

            <div className="mobile-menu-note">
              <ShieldCheck size={18} />
              <p>
                <b>실거래 없는 가상투자</b>
                <small>실제 주문이나 고객 자산을 다루지 않아요.</small>
              </p>
            </div>

            <footer>
              <Link href="/privacy" onClick={closeMenu}>
                개인정보처리방침
              </Link>
              <Link href="/terms" onClick={closeMenu}>
                이용약관
              </Link>
            </footer>
          </section>
        </div>
      )}

      <nav className="mobile-service-nav" aria-label="모바일 주요 메뉴">
        {primaryItems.map(({ href, label, icon: Icon }) => {
          const active = href.includes("#")
            ? pathname + hash === href
            : href === "/"
              ? pathname === "/" && !hash
              : isCurrent(pathname, href);
          return (
            <Link
              href={href}
              className={active ? "active" : ""}
              aria-current={active ? "page" : undefined}
              key={href}
              onClick={(event)=>{
                if(pathname!=="/"||(!href.includes("#")&&href!=="/"))return;
                event.preventDefault();
                window.location.hash=href.includes("#")?href.split("#")[1]:"market-rankings";
                window.dispatchEvent(new Event("hashchange"));
              }}
            >
              <span>
                <Icon size={21} strokeWidth={active ? 2.5 : 2} />
              </span>
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
          <span>
            <Menu size={21} strokeWidth={open || moreActive ? 2.5 : 2} />
          </span>
          <small>전체</small>
        </button>
      </nav>
    </>
  );
}
