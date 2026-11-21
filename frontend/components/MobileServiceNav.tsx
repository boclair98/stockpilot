"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  BarChart3,
  BadgeCheck,
  BrainCircuit,
  Gauge,
  GraduationCap,
  Home,
  Star,
  Wallet,
  History,
  Menu,
  Search,
  MessageCircle,
  ShieldCheck,
  Trophy,
  UserRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useDialogFocus } from "@/lib/dialog-focus";
import { ALL_INSTRUMENTS_HREF, followMarketBrowseLink } from "@/lib/market-browse";
const subscribeHash = (callback: () => void) => {
  window.addEventListener("hashchange", callback);
  window.addEventListener("popstate", callback);
  window.addEventListener("stockpilot:market-browse", callback);
  return () => { window.removeEventListener("hashchange", callback); window.removeEventListener("popstate", callback); window.removeEventListener("stockpilot:market-browse", callback); };
};
const readHash = () => window.location.hash;

const primaryItems = [
  { href: "/", label: "시장", icon: Home },
  { href: "/#favorite-board-title", label: "관심", icon: Star },
  { href: "/#holdings", label: "내 자산", icon: Wallet },
  { href: "/#decision-review", label: "투자 기록", icon: History },
];

const menuGroups = [
  { title: "투자 도구", items: [
    { href: ALL_INSTRUMENTS_HREF, label: "전체 종목", description: "국내·미국 종목 검색", icon: Search },
    { href: "/compare", label: "종목 비교", description: "같은 기간의 가격 변화 비교", icon: BarChart3 },
    { href: "/notifications", label: "알림 모아보기", description: "주문·가격·공시 알림", icon: MessageCircle },
    { href: "/account-tools", label: "계좌 관리", description: "정기 모의 매수·가상 환전·권리 일정", icon: Wallet },
  ] },
  { title: "학습과 커뮤니티", items: [
    { href: "/learn", label: "주식 학습", description: "주식의 기초와 용어", icon: GraduationCap },
    { href: "/practice", label: "투자 연습", description: "시나리오로 연습하는 투자 판단", icon: BrainCircuit },
    { href: "/growth", label: "성장 허브", description: "미션과 활동 리포트", icon: Gauge },
    { href: "/league", label: "수익률 리그", description: "보유 종목 비공개 수익률 순위", icon: Trophy },
    { href: "/lounge", label: "투자 라운지", description: "투자 경험과 학습 이야기", icon: MessageCircle },
  ] },
  { title: "계정과 도움말", items: [
    { href: "/profile", label: "내 프로필", description: "계정과 알림 설정", icon: UserRound },
    { href: "/support", label: "고객지원", description: "문의와 서비스 공지", icon: ShieldCheck },
    { href: "/guide", label: "처음 이용 안내", description: "종목 찾기부터 첫 모의주문까지", icon: BookOpen },
    { href: "/pricing", label: "Pro 플랜", description: "멤버십 소개와 출시 알림", icon: BadgeCheck },
  ] },
];

function isCurrent(pathname: string, href: string) {
  return pathname === href || (href !== "/" && pathname.startsWith(href + "/"));
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

  const moreActive = menuGroups.some(group => group.items.some(item => isCurrent(pathname, item.href)));

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

            {menuGroups.map(group => (
              <section className="mobile-menu-group" key={group.title}>
                <h3>{group.title}</h3>
                <div className="mobile-menu-grid">
                  {group.items.map(({ href, label, description, icon: Icon }) => (
                    <Link
                      className={isCurrent(pathname, href) ? "active" : ""}
                      aria-current={isCurrent(pathname, href) ? "page" : undefined}
                      href={href}
                      prefetch={false}
                      key={href}
                      onClick={event => { followMarketBrowseLink(event); closeMenu(); }}
                    >
                      <span><Icon size={20} aria-hidden="true" /></span>
                      <div><b>{label}</b><small>{description}</small></div>
                    </Link>
                  ))}
                </div>
              </section>
            ))}

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
              ? pathname === "/" && (!hash || ["#market-rankings", "#search-card", "#kr-top", "#us-top"].includes(hash))
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
