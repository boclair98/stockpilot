import { ArrowLeft, ArrowUpRight, BarChart3, Bell, BookOpen, ChevronRight, Compass, History, Layers2, Search, ShieldCheck, Trophy, WalletCards } from "lucide-react";
import Link from "next/link";
import ShareSiteButton from "@/components/ShareSiteButton";
import WorkspaceControls from "@/components/WorkspaceControls";
import { publicPageMetadata } from "@/lib/site-metadata";

export const metadata = publicPageMetadata("/guide", "모의투자 시작 가이드", "실제 한국·미국 주식 시세로 종목을 찾고, 연습 자금으로 주문하고, 나만의 투자 판단을 복기해 보세요.");

const journey = [
  { icon: Search, title: "궁금한 회사를 찾아요", body: "회사명이나 종목코드로 검색하고, 가격과 차트·기업 정보를 함께 살펴봐요.", href: "/#search-card", action: "종목 찾아보기", label: "살펴보기" },
  { icon: WalletCards, title: "연습 자금으로 주문해요", body: "Google 로그인 후 가격과 수량, 예상 금액을 확인하고 모의 매수·매도를 연습해요.", href: "/#holdings", action: "내 모의투자 열기", label: "직접 해보기" },
  { icon: History, title: "내 판단을 돌아봐요", body: "얼마를 벌었는지와 함께 왜 사고팔았는지도 기록해요. 다음 선택을 위한 나만의 기준이 생겨요.", href: "/#decision-review", action: "투자 기록 살펴보기", label: "돌아보기" },
];

const features = [
  { icon: Layers2, title: "고민되는 종목은 나란히", body: "같은 기간의 가격 흐름과 하락폭을 비교해요.", href: "/compare", action: "종목 비교" },
  { icon: Trophy, title: "함께하면 더 꾸준하게", body: "보유 종목은 공개하지 않고 수익률로 겨뤄요.", href: "/league", action: "수익률 리그" },
  { icon: Bell, title: "놓치고 싶지 않은 가격", body: "관심 가격을 설정하고 주문·공시 알림을 모아봐요.", href: "/notifications", action: "알림 모아보기" },
  { icon: WalletCards, title: "내 속도로 투자 연습", body: "정기 모의매수, 가상 환전과 자금 기록을 관리해요.", href: "/account-tools", action: "계좌 관리" },
];

export default function GuidePage() {
  return <main className="guide-page">
    <a className="guide-skip" href="#guide-content">본문으로 건너뛰기</a>
    <header className="guide-header">
      <Link className="guide-brand" href="/" aria-label="StockPilot 시장 홈"><span><BarChart3 size={21}/></span>StockPilot</Link>
      <div className="guide-header-actions"><Link className="guide-back" href="/" aria-label="시장으로 돌아가기" title="시장으로 돌아가기"><ArrowLeft size={16} aria-hidden="true"/><span>시장으로 돌아가기</span></Link><WorkspaceControls themeOnly/></div>
    </header>

    <section className="guide-hero" id="guide-content">
      <div className="guide-hero-copy">
        <p className="guide-eyebrow"><span aria-hidden="true"/> 처음 만나는 StockPilot</p>
        <h1>투자, 내 돈 없이<br/><em>먼저 연습해요.</em></h1>
        <p className="guide-lead">실제 시세로 한국·미국 주식을 살펴보고,<br className="guide-desktop-break"/> 연습 자금으로 나만의 판단을 확인해 보세요.</p>
        <div className="guide-hero-actions">
          <Link className="guide-button is-primary" href="/#search-card">종목 찾아보기<ArrowUpRight size={19} aria-hidden="true"/></Link>
          <Link className="guide-button is-secondary" href="/learn"><BookOpen size={18} aria-hidden="true"/>주식 기초 배우기</Link>
        </div>
        <p className="guide-reassurance"><ShieldCheck size={16} aria-hidden="true"/>실제 돈이 아닌 연습용 자금으로 이용해요.</p>
      </div>
      <div className="guide-flow" aria-label="투자 연습의 세 단계">
        <div className="guide-flow-heading"><Compass size={18} aria-hidden="true"/><span>첫 투자 연습, 이렇게 이어져요</span></div>
        <ol>{journey.map(({ icon: Icon, title, body, href, action, label }, i) => <li key={title}>
          <span className="guide-flow-number">0{i + 1}</span>
          <div><p className="guide-flow-label"><Icon size={15} aria-hidden="true"/>{label}</p><h2>{title}</h2><p>{body}</p><Link href={href}>{action}<ChevronRight size={16} aria-hidden="true"/></Link></div>
        </li>)}</ol>
      </div>
    </section>

    <section className="guide-discovery" aria-labelledby="guide-discovery-title">
      <div className="guide-section-heading"><div><p className="guide-eyebrow">내게 맞는 연습 찾기</p><h2 id="guide-discovery-title">살펴보고, 비교하고, 함께해요.</h2></div><p>익숙해지면 한 가지씩 더 해보세요.</p></div>
      <div className="guide-feature-grid">{features.map(({ icon: Icon, title, body, href, action }) => <Link href={href} key={href} className="guide-feature"><span className="guide-feature-icon"><Icon size={23} aria-hidden="true"/></span><h3>{title}</h3><p>{body}</p><span className="guide-feature-action">{action}<ArrowUpRight size={16} aria-hidden="true"/></span></Link>)}</div>
    </section>

    <section className="guide-questions" aria-labelledby="guide-questions-title">
      <div className="guide-section-heading"><div><p className="guide-eyebrow">시작 전에 궁금한 점</p><h2 id="guide-questions-title">가볍게 시작해도 괜찮아요.</h2></div><Link href="/support">도움이 더 필요하다면<ArrowUpRight size={16} aria-hidden="true"/></Link></div>
      <div className="guide-faq">
        <details><summary>로그인 전에 먼저 둘러볼 수 있나요?<ChevronRight size={18} aria-hidden="true"/></summary><p>네. 종목 검색, 시세, 차트와 공시는 로그인 없이 살펴볼 수 있어요. 모의주문과 개인 기록처럼 계정에 저장하는 기능은 Google 로그인 후 이용해 주세요.</p></details>
        <details><summary>실제 돈이나 증권계좌가 필요한가요?<ChevronRight size={18} aria-hidden="true"/></summary><p>필요하지 않아요. 잔액은 투자 연습을 위한 가상자금이며 실제 예금이나 증권계좌와 연결되지 않아요. 원화 자산과 달러 자산은 각각 표시해요. 주문도 실제 거래소로 보내지 않으며 수수료·세금·체결 방식은 실제 거래와 다를 수 있어요.</p></details>
        <details><summary>다른 증권 앱과 가격이 조금 다른 이유는 뭔가요?<ChevronRight size={18} aria-hidden="true"/></summary><p>거래소와 장 운영 시간, 자료 제공 범위와 갱신 시점에 따라 차이가 날 수 있어요. 종목의 거래소·통화와 화면에 표시된 기준 시각을 함께 확인해 주세요.</p></details>
        <details><summary>리그에서 제가 산 주식이 공개되나요?<ChevronRight size={18} aria-hidden="true"/></summary><p>리그에서는 보유 종목을 공개하지 않고 수익률을 비교해요. 투자 내역을 공유하지 않아도 함께 연습할 수 있어요.</p></details>
      </div>
    </section>

    <section className="guide-share-section" aria-label="StockPilot 소개 링크 공유"><div><h2>투자를 시작하는 친구에게도</h2><p>함께 배우고 싶은 사람에게 StockPilot을 알려주세요.</p></div><ShareSiteButton/></section>
    <footer className="guide-footer"><Link className="guide-brand" href="/">StockPilot</Link><p>실제 시세로 배우는 모의투자</p><nav aria-label="서비스 정보"><Link href="/support">고객지원</Link><Link href="/privacy">개인정보처리방침</Link><Link href="/terms">이용약관</Link></nav></footer>
  </main>;
}

