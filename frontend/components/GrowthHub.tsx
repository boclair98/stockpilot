"use client";

import {
  ArrowLeft,
  BookOpenCheck,
  BrainCircuit,
  CheckCircle2,
  Flame,
  Gauge,
  LogIn,
  Medal,
  RefreshCw,
  Send,
  Share2,
  ShieldCheck,
  Swords,
  Target,
  Trash2,
  Trophy,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { signInHref } from "@/lib/identity";
import InvestmentLicense, { type InvestmentLicenseData } from "@/components/InvestmentLicense";
import PortfolioAnalytics from "@/components/PortfolioAnalytics";

type Choice = "BUY" | "HOLD" | "SELL";
type Challenge = {
  available: boolean;
  date: string;
  market?: "KR" | "US";
  currency?: "KRW" | "USD";
  context?: Array<{
    step: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  answered: boolean;
  distribution: Record<Choice, number>;
  result?: {
    choice: Choice;
    score: number;
    correctChoice: Choice;
    movePercent: number;
    name: string;
    symbol: string;
    exchange: string;
    outcomePrice: number;
  };
};
type Skill = {
  overall: number;
  grade: string;
  return: number;
  risk: number;
  discipline: number;
  experience: number;
  maxDrawdown: number;
};
type Journal = {
  id: string;
  symbol: string;
  name: string;
  exchange: string;
  thesis: string;
  horizon: "DAY" | "WEEK" | "MONTH" | "LONG";
  targetReturn: number | null;
  stopLoss: number | null;
  confidence: number;
  review: string | null;
  outcome: "WIN" | "LOSS" | "EVEN" | "OPEN" | null;
  createdAt: string;
};
type GrowthData = {
  authenticated: boolean;
  challenge: Challenge;
  streak: number;
  skill: Skill | null;
  weeklyCard: {
    displayName: string;
    returnRate: number;
    tradeCount: number;
    journalCount: number;
    streak: number;
    skillScore: number;
    grade: string;
  } | null;
  journals: Journal[];
  recentOrders: Array<{ symbol: string; name: string; exchange: string }>;
  badges: Array<{ key: string; label: string }>;
  license: InvestmentLicenseData;
};

const CHOICE_LABEL: Record<Choice, string> = {
  BUY: "상승",
  HOLD: "횡보",
  SELL: "하락",
};
const HORIZON_LABEL = {
  DAY: "하루",
  WEEK: "1주",
  MONTH: "1개월",
  LONG: "장기",
};
const OUTCOME_LABEL = {
  WIN: "계획 성공",
  LOSS: "계획 실패",
  EVEN: "본전",
  OPEN: "진행 중",
};

function ChallengeLine({ values }: { values: number[] }) {
  const points = useMemo(() => {
    if (!values.length) return "";
    const min = Math.min(...values);
    const max = Math.max(...values);
    const spread = max - min || 1;
    return values
      .map((value, index) => {
        const x = values.length === 1 ? 50 : 4 + (index / (values.length - 1)) * 92;
        const y = 88 - ((value - min) / spread) * 70;
        return `${x},${y}`;
      })
      .join(" ");
  }, [values]);
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="익명 종목 5거래일 가격 흐름">
      <path d="M4 25H96M4 50H96M4 75H96" />
      <polyline points={points} />
    </svg>
  );
}

export default function GrowthHub() {
  const [data, setData] = useState<GrowthData | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [journalStock, setJournalStock] = useState("");
  const [thesis, setThesis] = useState("");
  const [horizon, setHorizon] = useState<"DAY" | "WEEK" | "MONTH" | "LONG">("WEEK");
  const [targetReturn, setTargetReturn] = useState("10");
  const [stopLoss, setStopLoss] = useState("-5");
  const [confidence, setConfidence] = useState("3");
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [review, setReview] = useState("");
  const [outcome, setOutcome] = useState<"WIN" | "LOSS" | "EVEN" | "OPEN">("OPEN");

  const load = useCallback(async () => {
    const response = await fetch("/api/growth/overview", {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) throw new Error("성장 허브를 불러오지 못했습니다.");
    const next: GrowthData = await response.json();
    setData(next);
    if (next.recentOrders[0]) {
      setJournalStock((current) => current || `${next.recentOrders[0].symbol}|${next.recentOrders[0].exchange}`);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load().catch((error) => setNotice(error.message)), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function request(url: string, options: RequestInit) {
    if (!data?.authenticated) {
      window.location.assign(signInHref("/growth"));
      return null;
    }
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(url, {
        ...options,
        credentials: "include",
        headers: { "Content-Type": "application/json", ...options.headers },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "요청을 처리하지 못했습니다.");
      if (body.challenge) setData(body);
      else await load();
      return body;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function answer(choice: Choice) {
    const body = await request("/api/growth/challenge", {
      method: "POST",
      body: JSON.stringify({ choice }),
    });
    if (body) setNotice("오늘의 선택을 기록했어요. 결과와 참여자 선택을 확인해 보세요.");
  }

  async function createJournal(event: FormEvent) {
    event.preventDefault();
    const [symbol, exchange] = journalStock.split("|");
    const body = await request("/api/growth/journals", {
      method: "POST",
      body: JSON.stringify({
        symbol,
        exchange,
        thesis: thesis.trim(),
        horizon,
        targetReturn: targetReturn ? Number(targetReturn) : null,
        stopLoss: stopLoss ? Number(stopLoss) : null,
        confidence: Number(confidence),
      }),
    });
    if (body) {
      setThesis("");
      setNotice("투자 이유와 계획을 비공개 일지에 저장했어요.");
    }
  }

  async function submitReview(event: FormEvent, id: string) {
    event.preventDefault();
    const body = await request(`/api/growth/journals/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ review: review.trim(), outcome }),
    });
    if (body) {
      setReviewing(null);
      setReview("");
      setNotice("복기를 저장했어요. 투자 원칙 점수에 반영됩니다.");
    }
  }

  async function removeJournal(id: string) {
    if (!confirm("이 투자일지를 삭제할까요?")) return;
    const body = await request(`/api/growth/journals/${id}`, { method: "DELETE" });
    if (body) {
      await load();
      setNotice("투자일지를 삭제했어요.");
    }
  }

  async function shareCard() {
    if (!data?.weeklyCard) return;
    const card = data.weeklyCard;
    const text = [
      `StockPilot 주간 성적표`,
      `${card.displayName} · ${card.grade} ${card.skillScore}점`,
      `수익률 ${card.returnRate >= 0 ? "+" : ""}${card.returnRate.toFixed(2)}%`,
      `이번 주 ${card.tradeCount}회 거래 · ${card.journalCount}회 기록 · ${card.streak}일 연속`,
    ].join("\n");
    try {
      if (navigator.share) {
        await navigator.share({ title: "StockPilot 주간 성적표", text, url: location.href });
      } else {
        await navigator.clipboard.writeText(`${text}\n${location.href}`);
        setNotice("주간 성적표와 링크를 복사했어요.");
      }
    } catch {
      // The native share sheet can be dismissed without showing an error.
    }
  }

  const challengeValues = data?.challenge.context?.map((item) => item.close) ?? [];

  return (
    <main className="growth-app">
      <header className="growth-topbar">
        <Link className="growth-brand" href="/"><span><BrainCircuit size={18} /></span>StockPilot</Link>
        <nav>
          <Link href="/"><ArrowLeft size={14} /> 가상투자</Link>
          <Link href="/league"><Trophy size={14} /> 수익률 리그</Link>
          <b><Gauge size={14} /> 성장 허브</b>
        </nav>
      </header>

      <section className="growth-hero">
        <div>
          <p><span /> DAILY PRACTICE</p>
          <h1>수익보다 오래 남는<br />나만의 투자 습관</h1>
          <small>매일 5분 예측하고, 거래 전 계획하고, 거래 후 복기해 보세요.</small>
        </div>
        <aside>
          <Flame size={26} />
          <span><b>{data?.streak ?? 0}일 연속 참여</b><small>오늘의 챌린지와 투자일지로 기록을 이어가세요</small></span>
        </aside>
      </section>

      {notice && <div className="growth-notice">{notice}</div>}

      {data?.license && (
        <InvestmentLicense authenticated={data.authenticated} data={data.license} />
      )}

      <div id="license-analytics">
        <PortfolioAnalytics />
      </div>

      <section className="growth-primary-grid">
        <article className="daily-challenge" id="license-challenge">
          <div className="growth-section-head">
            <span><BrainCircuit size={18} /></span>
            <div><p>TODAY&apos;S 5 MIN</p><h2>오늘의 익명 차트</h2></div>
            <em>{data?.challenge.market === "US" ? "미국 시장" : "한국 시장"}</em>
          </div>
          {!data ? (
            <div className="growth-loading"><RefreshCw className="spin" size={19} /> 문제를 준비하고 있어요</div>
          ) : !data.challenge.available ? (
            <div className="growth-loading">KIS 과거 시세를 준비하고 있어요. 잠시 후 다시 확인해 주세요.</div>
          ) : (
            <>
              <div className="challenge-chart">
                <ChallengeLine values={challengeValues} />
                <span>과거 5거래일 종가 흐름</span>
              </div>
              {!data.challenge.answered ? (
                <div className="challenge-actions">
                  <p>다음 거래일은 어떻게 움직였을까요?</p>
                  <div>
                    {(["BUY", "HOLD", "SELL"] as Choice[]).map((choice) => (
                      <button disabled={busy} key={choice} onClick={() => answer(choice)}>
                        {CHOICE_LABEL[choice]}
                      </button>
                    ))}
                  </div>
                  {!data.authenticated && <small>답을 기록하려면 Google 로그인이 필요합니다.</small>}
                </div>
              ) : data.challenge.result ? (
                <div className="challenge-result">
                  <span className={data.challenge.result.score ? "correct" : "wrong"}>
                    {data.challenge.result.score ? <CheckCircle2 size={17} /> : <Target size={17} />}
                    {data.challenge.result.score ? "예측 성공" : "다시 배우는 날"}
                  </span>
                  <b>{data.challenge.result.name} · 다음 날 {data.challenge.result.movePercent >= 0 ? "+" : ""}{data.challenge.result.movePercent.toFixed(2)}%</b>
                  <p>내 선택 {CHOICE_LABEL[data.challenge.result.choice]} · 정답 {CHOICE_LABEL[data.challenge.result.correctChoice]}</p>
                  <div>
                    {(["BUY", "HOLD", "SELL"] as Choice[]).map((choice) => (
                      <span key={choice}>{CHOICE_LABEL[choice]} <b>{data.challenge.distribution[choice]}%</b></span>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </article>

        <article className="skill-card">
          <div className="growth-section-head">
            <span><Gauge size={18} /></span>
            <div><p>SKILL SCORE</p><h2>StockPilot 실력 점수</h2></div>
          </div>
          {data?.skill ? (
            <>
              <div className="skill-score">
                <strong>{data.skill.overall}</strong>
                <span><b>{data.skill.grade}</b><small>100점 만점</small></span>
              </div>
              <div className="skill-bars">
                {[
                  ["성과", data.skill.return],
                  ["위험관리", data.skill.risk],
                  ["투자원칙", data.skill.discipline],
                  ["경험", data.skill.experience],
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <span>{label}<b>{value}</b></span>
                    <i><em style={{ width: `${value}%` }} /></i>
                  </div>
                ))}
              </div>
              <p><ShieldCheck size={13} /> 최대 낙폭 {data.skill.maxDrawdown.toFixed(2)}%p · 몰빵 수익률보다 꾸준한 습관을 평가합니다.</p>
            </>
          ) : (
            <div className="skill-login">
              <Gauge size={29} /><b>로그인하면 내 거래 습관을 계산해요</b>
              <a href={signInHref("/growth")}><LogIn size={14} /> Google로 시작하기</a>
            </div>
          )}
        </article>
      </section>

      <section className="weekly-section">
        <div className="growth-section-head">
          <span><Medal size={18} /></span>
          <div><p>WEEKLY REPORT</p><h2>공유 가능한 주간 성적표</h2></div>
        </div>
        {data?.weeklyCard ? (
          <div className="weekly-card">
            <div>
              <span>STOCKPILOT WEEKLY</span>
              <h3>{data.weeklyCard.displayName}님의 투자 비행 기록</h3>
              <p>{data.weeklyCard.grade} · 실력점수 {data.weeklyCard.skillScore}</p>
            </div>
            <strong className={data.weeklyCard.returnRate >= 0 ? "positive" : "negative"}>
              {data.weeklyCard.returnRate >= 0 ? "+" : ""}{data.weeklyCard.returnRate.toFixed(2)}%
              <small>통합 누적 수익률</small>
            </strong>
            <dl>
              <div><dt>이번 주 거래</dt><dd>{data.weeklyCard.tradeCount}회</dd></div>
              <div><dt>투자일지</dt><dd>{data.weeklyCard.journalCount}회</dd></div>
              <div><dt>연속 참여</dt><dd>{data.weeklyCard.streak}일</dd></div>
            </dl>
            <button onClick={shareCard}><Share2 size={15} /> 성과만 안전하게 공유</button>
          </div>
        ) : (
          <div className="weekly-empty">로그인 후 거래와 챌린지를 시작하면 매주 공유 성적표가 만들어집니다.</div>
        )}
        {!!data?.badges.length && (
          <div className="growth-badges">
            {data.badges.map((badge) => <span key={badge.key}><Medal size={13} /> {badge.label}</span>)}
          </div>
        )}
      </section>

      <section className="journal-section" id="license-journal">
        <div className="growth-section-head">
          <span><BookOpenCheck size={18} /></span>
          <div><p>PRIVATE JOURNAL</p><h2>투자일지와 자동 복기</h2></div>
          <em>본인에게만 공개</em>
        </div>
        {!data?.authenticated ? (
          <div className="journal-login">
            <BookOpenCheck size={25} />
            <span><b>거래 이유를 남기면 실력으로 쌓입니다</b><small>투자일지는 리그와 다른 사용자에게 공개되지 않습니다.</small></span>
            <a href={signInHref("/growth")}><LogIn size={14} /> 로그인</a>
          </div>
        ) : (
          <div className="journal-grid">
            <form className="journal-form" onSubmit={createJournal}>
              <h3>거래 전 계획 기록</h3>
              {data.recentOrders.length ? (
                <label>최근 거래 종목<select required value={journalStock} onChange={(event) => setJournalStock(event.target.value)}>
                  {data.recentOrders.map((item) => (
                    <option key={`${item.exchange}:${item.symbol}`} value={`${item.symbol}|${item.exchange}`}>{item.name} · {item.symbol}</option>
                  ))}
                </select></label>
              ) : <p>가상주문을 한 번 체결하면 투자일지를 작성할 수 있어요.</p>}
              <label>매수·매도한 이유<textarea required minLength={5} maxLength={500} value={thesis} onChange={(event) => setThesis(event.target.value)} placeholder="예: 실적 발표 후에도 추세가 유지되고 손절 기준이 명확해서" /></label>
              <div>
                <label>예상 기간<select value={horizon} onChange={(event) => setHorizon(event.target.value as typeof horizon)}>
                  {Object.entries(HORIZON_LABEL).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                </select></label>
                <label>확신 정도<select value={confidence} onChange={(event) => setConfidence(event.target.value)}>
                  {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} / 5</option>)}
                </select></label>
              </div>
              <div>
                <label>목표수익률<input type="number" value={targetReturn} onChange={(event) => setTargetReturn(event.target.value)} /></label>
                <label>손절기준<input type="number" max="0" value={stopLoss} onChange={(event) => setStopLoss(event.target.value)} /></label>
              </div>
              <button disabled={busy || !data.recentOrders.length}><Send size={14} /> 비공개 계획 저장</button>
            </form>
            <div className="journal-list">
              {data.journals.length ? data.journals.map((journal) => (
                <article key={journal.id}>
                  <header>
                    <span><b>{journal.name}</b><small>{HORIZON_LABEL[journal.horizon]} 계획 · 확신 {journal.confidence}/5</small></span>
                    <button aria-label="투자일지 삭제" onClick={() => removeJournal(journal.id)}><Trash2 size={13} /></button>
                  </header>
                  <p>{journal.thesis}</p>
                  <div><span>목표 {journal.targetReturn ?? "-"}%</span><span>손절 {journal.stopLoss ?? "-"}%</span><span>{new Date(journal.createdAt).toLocaleDateString("ko-KR")}</span></div>
                  {journal.review ? (
                    <blockquote><b>{journal.outcome ? OUTCOME_LABEL[journal.outcome] : "복기"}</b>{journal.review}</blockquote>
                  ) : reviewing === journal.id ? (
                    <form onSubmit={(event) => submitReview(event, journal.id)}>
                      <select value={outcome} onChange={(event) => setOutcome(event.target.value as typeof outcome)}>
                        {Object.entries(OUTCOME_LABEL).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                      </select>
                      <textarea required minLength={5} maxLength={500} value={review} onChange={(event) => setReview(event.target.value)} placeholder="계획과 실제 결과가 달랐던 이유를 적어보세요." />
                      <button disabled={busy}>복기 저장</button>
                    </form>
                  ) : (
                    <button className="review-open" onClick={() => setReviewing(journal.id)}>거래 후 복기하기</button>
                  )}
                </article>
              )) : (
                <div className="journal-empty"><BookOpenCheck size={26} /><b>아직 투자일지가 없어요</b><p>첫 계획을 적고 결과를 복기해 보세요.</p></div>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="duel-cta">
        <span><Swords size={25} /></span>
        <div><p>HEAD TO HEAD</p><h2>친구와 1·3·7일 투자 배틀</h2><small>같은 시점의 가상자산으로 시작하고, 대결 중에는 서로의 보유 종목을 숨깁니다.</small></div>
        <Link href="/league"><Swords size={15} /> 1:1 대결 만들기</Link>
      </section>

      <footer className="growth-footer"><ShieldCheck size={14} /> 모든 점수·챌린지·대결은 모의투자 학습용이며 실제 투자 권유가 아닙니다.</footer>
    </main>
  );
}
