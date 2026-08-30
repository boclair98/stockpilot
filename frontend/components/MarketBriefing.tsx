import {
  Activity,
  ArrowRight,
  BarChart3,
  Check,
  CircleHelp,
  MousePointerClick,
  NotebookPen,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingDown,
  WalletCards,
} from "lucide-react";

type Tone = "positive" | "negative" | "neutral";

type Props = {
  live: boolean;
  average: number;
  risingCount: number;
  total: number;
  riser: { name: string; changePercent: number } | null;
  faller: { name: string; changePercent: number } | null;
  authenticated: boolean;
  positionCount: number;
  concentration: number;
  protectionCoverage: number;
  winners: number;
  losers: number;
  selectedName: string;
  quoteReady: boolean;
};

function signedPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export default function MarketBriefing({
  live,
  average,
  risingCount,
  total,
  riser,
  faller,
  authenticated,
  positionCount,
  concentration,
  protectionCoverage,
  winners,
  losers,
  selectedName,
  quoteReady,
}: Props) {
  const marketTone: Tone = !total ? "neutral" : average >= 0 ? "positive" : "negative";
  const marketTitle = !total
    ? "시장 데이터 준비 중"
    : average >= 0.7
      ? "상승 모멘텀이 강해요"
      : average <= -0.7
        ? "하락 압력이 커요"
        : "방향을 탐색하는 중이에요";
  const marketDescription = !total
    ? "실시간 시세가 들어오면 자동으로 갱신돼요."
    : `${risingCount}/${total}개 주요 종목 상승 · ${riser?.name || "상승 선두 대기"}`;
  const marketMeter = total ? clamp(50 + average * 12, 12, 88) : 18;

  const riskPenalty =
    (concentration >= 55 ? 25 : concentration >= 35 ? 10 : 0) +
    (protectionCoverage < 25 && positionCount > 0 ? 20 : 0) +
    (losers > winners && losers > 0 ? 10 : 0);
  const portfolioScore = authenticated
    ? positionCount > 0
      ? clamp(100 - riskPenalty, 42, 98)
      : 72
    : 0;
  const portfolioTone: Tone = !authenticated
    ? "neutral"
    : portfolioScore >= 80
      ? "positive"
      : portfolioScore >= 60
        ? "neutral"
        : "negative";
  const portfolioTitle = !authenticated
    ? "내 계좌를 연결해 보세요"
    : positionCount === 0
      ? "첫 가상주문을 준비해요"
      : portfolioScore >= 80
        ? "포트폴리오 균형이 좋아요"
        : "리스크 점검이 필요해요";
  const portfolioDescription = !authenticated
    ? "Google 로그인 후 보유·현금·보호 범위를 계산해요."
    : positionCount === 0
      ? "가상자금으로 시장가·지정가 주문을 연습할 수 있어요."
      : `최대 비중 ${concentration.toFixed(0)}% · 보호 범위 ${protectionCoverage.toFixed(0)}%`;

  const nextAction = !authenticated
    ? {
        href: "/api/auth/google/login?return_to=%2F",
        label: "Google로 시작하기",
        title: "가상계좌 준비",
        description: "개인별 원화·달러 가상자금을 받아요.",
        tone: "neutral" as Tone,
        icon: WalletCards,
      }
    : positionCount === 0
      ? {
          href: "#search-card",
          label: "종목 찾아보기",
          title: "첫 판단을 기록해요",
          description: "종목을 고르면 차트와 주문 카드가 열려요.",
          tone: "positive" as Tone,
          icon: Target,
        }
      : {
          href: "/growth",
          label: "성장 허브 열기",
          title: "오늘의 복기를 남겨요",
          description: "리포트·투자일지로 다음 행동을 정리해요.",
          tone: "positive" as Tone,
          icon: ShieldCheck,
        };
  const NextIcon = nextAction.icon;
  const journeyStep = !total ? 0 : !quoteReady ? 1 : positionCount === 0 ? 2 : 3;
  const journey = [
    {
      title: "시장 읽기",
      description: total ? `${total}개 주요 종목 확인` : "실시간 시세 연결 중",
      href: "#market-content",
      icon: BarChart3,
    },
    {
      title: "종목 선택",
      description: quoteReady ? `${selectedName} 선택됨` : "한국·미국 종목 검색",
      href: "#search-card",
      icon: Search,
    },
    {
      title: "안전 주문",
      description: authenticated ? "가상원장으로 체결 연습" : "로그인 후 가상자금 지급",
      href: "#order-ticket",
      icon: MousePointerClick,
    },
    {
      title: "기록·복기",
      description: positionCount ? `${positionCount}개 보유 종목 분석` : "주문 근거와 결과 기록",
      href: "/growth",
      icon: NotebookPen,
    },
  ];

  return (
    <section className="briefing-card" aria-labelledby="briefing-title">
      <div className="briefing-head">
        <div>
          <span className="briefing-kicker"><Sparkles size={13} /> READ · DECIDE · PRACTICE · REVIEW</span>
          <h2 id="briefing-title">오늘의 투자 루프</h2>
          <p>시장을 읽고 안전하게 연습한 뒤, 결과를 기록하는 한 사이클을 완성해 보세요.</p>
        </div>
        <span className={`briefing-live ${live ? "on" : "off"}`}>
          <i /> {live ? "LIVE" : "시세 대기"}
        </span>
      </div>

      <nav className="briefing-journey" aria-label="가상투자 핵심 여정">
        {journey.map((item, index) => {
          const JourneyIcon = item.icon;
          const isDone = index < journeyStep;
          const isActive = index === journeyStep;
          return (
            <a
              className={`${isDone ? "done" : ""}${isActive ? " active" : ""}`}
              href={item.href}
              key={item.title}
              aria-current={isActive ? "step" : undefined}
            >
              <i>{isDone ? <Check size={15} /> : <JourneyIcon size={16} />}</i>
              <span><b>{item.title}</b><small>{item.description}</small></span>
              <em>0{index + 1}</em>
            </a>
          );
        })}
      </nav>

      <div className="briefing-grid">
        <article className={`briefing-item ${marketTone}`}>
          <div className="briefing-item-top">
            <span className="briefing-item-icon"><Activity size={17} /></span>
            <span>시장 흐름</span>
            <strong>{total ? signedPercent(average) : "—"}</strong>
          </div>
          <b>{marketTitle}</b>
          <p>{marketDescription}</p>
          <div className="briefing-meter" role="progressbar" aria-label="주요 종목 상승 흐름" aria-valuemin={0} aria-valuemax={100} aria-valuenow={marketMeter}>
            <i style={{ width: `${marketMeter}%` }} />
          </div>
          {faller && <small className="briefing-footnote"><TrendingDown size={12} /> 약한 종목 {faller.name} {signedPercent(faller.changePercent)}</small>}
        </article>

        <article className={`briefing-item ${portfolioTone}`}>
          <div className="briefing-item-top">
            <span className="briefing-item-icon"><ShieldCheck size={17} /></span>
            <span>내 투자 컨디션</span>
            <strong>{authenticated ? `${portfolioScore}점` : "로그인 필요"}</strong>
          </div>
          <b>{portfolioTitle}</b>
          <p>{portfolioDescription}</p>
          <div className="briefing-meter" role="progressbar" aria-label="가상 포트폴리오 컨디션" aria-valuemin={0} aria-valuemax={100} aria-valuenow={authenticated ? portfolioScore : 0}>
            <i style={{ width: `${authenticated ? portfolioScore : 12}%` }} />
          </div>
          <small className="briefing-footnote"><WalletCards size={12} /> {authenticated ? `${positionCount}개 보유 종목 · ${winners}승 ${losers}패` : "실제 계좌 연결 없이 안전하게 연습"}</small>
        </article>

        <article className={`briefing-item briefing-action ${nextAction.tone}`}>
          <div className="briefing-item-top">
            <span className="briefing-item-icon"><NextIcon size={17} /></span>
            <span>추천 다음 행동</span>
            <ArrowRight size={15} />
          </div>
          <b>{nextAction.title}</b>
          <p>{nextAction.description}</p>
          <a href={nextAction.href}>{nextAction.label}<ArrowRight size={13} /></a>
          <small className="briefing-footnote"><CircleHelp size={12} /> 투자 조언이 아닌 모의투자 학습 안내예요.</small>
        </article>
      </div>
    </section>
  );
}
