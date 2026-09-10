"use client";

import {
  Activity,
  BarChart3,
  FileText,
  Globe2,
  Home,
  Search,
  UserRound,
} from "lucide-react";

type Props = {
  onSearch: () => void;
};

const links = [
  { href: "#market-content", label: "홈", icon: Home },
  { href: "#kr-top", label: "국내", icon: Activity },
  { href: "#us-top", label: "미국·글로벌", icon: Globe2 },
  { href: "#market-indices", label: "시장지표", icon: BarChart3 },
  { href: "#news-panel", label: "뉴스·공시", icon: FileText },
  { href: "#holdings", label: "MY", icon: UserRound },
];

export default function MarketNavigation({ onSearch }: Props) {
  return (
    <nav className="market-navigation" aria-label="시장 탐색 메뉴">
      <div className="market-navigation-inner">
        <a className="market-navigation-brand" href="#market-content">
          <span className="market-navigation-live"><i aria-hidden="true" />LIVE</span>
          <b>시장 홈</b>
        </a>

        <div className="market-navigation-links">
          {links.map(({ href, label, icon: Icon }) => (
            <a href={href} key={href}>
              <Icon size={15} aria-hidden="true" />
              <span>{label}</span>
            </a>
          ))}
        </div>

        <button className="market-navigation-search" type="button" onClick={onSearch}>
          <Search size={16} aria-hidden="true" />
          <span>종목명·지수명 입력</span>
          <kbd>/</kbd>
        </button>
      </div>
    </nav>
  );
}

