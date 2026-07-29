"use client";

import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Crown,
  LockKeyhole,
  LogIn,
  Medal,
  Minus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  Trophy,
  Users,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";

import { signInHref, useMe } from "@/lib/identity";

type Ranking = {
  rank: number;
  nickname: string;
  returnRate: number;
  rankChange: number;
  isMe: boolean;
};

type LeagueData = {
  title: string;
  participantCount: number;
  asOf: string;
  rankings: Ranking[];
  me:
    | { joined: false }
    | {
        joined: true;
        nickname: string;
        rank: number;
        returnRate: number;
        rankChange: number;
      };
  rules: {
    startingCapital: string;
    scoring: string;
    privacy: string;
    trading: string;
  };
};

const rate = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

function RankChange({ value }: { value: number }) {
  if (value > 0) {
    return <span className="rank-change up-rank"><ChevronUp size={13} />{value}</span>;
  }
  if (value < 0) {
    return <span className="rank-change down-rank"><ChevronDown size={13} />{Math.abs(value)}</span>;
  }
  return <span className="rank-change same-rank"><Minus size={13} /></span>;
}

export default function LeagueBoard() {
  const me = useMe();
  const [data, setData] = useState<LeagueData | null>(null);
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/league/rankings", {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) throw new Error("리그 순위를 불러오지 못했습니다.");
    setData(await response.json());
  }, []);

  useEffect(() => {
    load().catch((reason) => setError(reason.message));
    const timer = window.setInterval(() => {
      load().catch(() => undefined);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function join(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/league/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ nickname: nickname.trim() || null }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "리그 참여에 실패했습니다.");
      setData(body);
      setNickname("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    if (!window.confirm("리그에서 나갈까요? 가상투자 기록은 그대로 유지됩니다.")) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/league/join", {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("리그 나가기에 실패했습니다.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  const topThree = data?.rankings.slice(0, 3) ?? [];
  const remaining = data?.rankings.slice(3) ?? [];

  return (
    <main className="league-app">
      <header className="league-topbar">
        <a className="league-brand" href="/">
          <span><Sparkles size={18} /></span>
          StockPilot
        </a>
        <nav>
          <a href="/"><ArrowLeft size={15} /> 가상투자</a>
          <span className="active"><Trophy size={15} /> 수익률 리그</span>
        </nav>
      </header>

      <section className="league-hero">
        <div>
          <p className="league-eyebrow"><span /> STOCKPILOT LEAGUE</p>
          <h1>종목은 비밀,<br />수익률로만 승부해요</h1>
          <p>실제 KIS 시세로 거래한 내 가상계좌 수익률을 다른 투자자와 겨뤄보세요.</p>
        </div>
        <div className="hero-trophy" aria-hidden>
          <span className="trophy-orbit orbit-one" />
          <span className="trophy-orbit orbit-two" />
          <Trophy size={72} />
        </div>
      </section>

      <section className="league-stats" aria-label="리그 현황">
        <div><Users size={20} /><span><small>참여자</small><b>{data?.participantCount ?? "—"}명</b></span></div>
        <div><Target size={20} /><span><small>진행 방식</small><b>오픈 리그</b></span></div>
        <div><ShieldCheck size={20} /><span><small>공개 범위</small><b>수익률만</b></span></div>
      </section>

      <section className="league-grid">
        <div className="ranking-column">
          <div className="league-section-head">
            <div>
              <p>LIVE RANKING</p>
              <h2>실시간 수익률 순위</h2>
            </div>
            <button onClick={() => load().catch(() => undefined)} aria-label="순위 새로고침">
              <RefreshCw size={16} />
            </button>
          </div>

          {!data ? (
            <div className="league-loading"><RefreshCw className="spin" size={20} /> 순위를 계산하고 있어요</div>
          ) : data.rankings.length === 0 ? (
            <div className="league-empty">
              <span>🏁</span>
              <b>아직 첫 참가자를 기다리고 있어요</b>
              <p>지금 참여하면 StockPilot 리그의 첫 번째 투자자가 됩니다.</p>
            </div>
          ) : (
            <>
              <div className="podium">
                {topThree.map((entry) => (
                  <article className={`podium-card place-${entry.rank} ${entry.isMe ? "mine" : ""}`} key={entry.nickname}>
                    <span className="podium-icon">
                      {entry.rank === 1 ? <Crown size={22} /> : <Medal size={21} />}
                    </span>
                    <small>{entry.rank}위</small>
                    <b>{entry.nickname}</b>
                    <strong className={entry.returnRate >= 0 ? "positive" : "negative"}>{rate(entry.returnRate)}</strong>
                    <RankChange value={entry.rankChange} />
                  </article>
                ))}
              </div>
              {remaining.length > 0 && (
                <div className="ranking-list">
                  {remaining.map((entry) => (
                    <article className={entry.isMe ? "mine" : ""} key={entry.nickname}>
                      <b className="rank-number">{entry.rank}</b>
                      <span className="league-avatar">{entry.nickname[0]}</span>
                      <span className="rank-name"><b>{entry.nickname}</b>{entry.isMe && <small>나</small>}</span>
                      <RankChange value={entry.rankChange} />
                      <strong className={entry.returnRate >= 0 ? "positive" : "negative"}>{rate(entry.returnRate)}</strong>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
          {data && (
            <p className="ranking-note">
              {new Date(data.asOf).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 기준 · 상위 100명 표시
            </p>
          )}
        </div>

        <aside className="league-side">
          <section className={`join-card ${data?.me.joined ? "joined" : ""}`}>
            {data?.me.joined ? (
              <>
                <span className="join-badge"><Trophy size={15} /> 리그 참여 중</span>
                <p>나의 현재 순위</p>
                <div className="my-rank">
                  <strong>{data.me.rank}<small>위</small></strong>
                  <span className={data.me.returnRate >= 0 ? "positive" : "negative"}>{rate(data.me.returnRate)}</span>
                </div>
                <div className="my-nickname"><span>{data.me.nickname[0]}</span><b>{data.me.nickname}</b><RankChange value={data.me.rankChange} /></div>
                <a className="trade-button" href="/">수익률 높이러 가기</a>
                <button className="leave-button" disabled={busy} onClick={leave}>리그 나가기</button>
              </>
            ) : me ? (
              <>
                <span className="join-badge"><Trophy size={15} /> 무료 참여</span>
                <h2>수익률 내기에<br />참여해 볼까요?</h2>
                <p>원하는 공개 닉네임을 정해 주세요. 비워두면 익명 닉네임이 자동으로 만들어집니다.</p>
                <form onSubmit={join}>
                  <label htmlFor="league-nickname">리그 닉네임</label>
                  <input
                    id="league-nickname"
                    value={nickname}
                    onChange={(event) => setNickname(event.target.value)}
                    maxLength={12}
                    placeholder="예: 장기투자왕"
                  />
                  <small>한글·영문·숫자·_- / 2~12자</small>
                  <button disabled={busy}>
                    {busy ? <><RefreshCw className="spin" size={16} /> 참여 중</> : "오픈 리그 참여하기"}
                  </button>
                </form>
              </>
            ) : (
              <>
                <span className="join-badge"><Trophy size={15} /> 무료 참여</span>
                <h2>Google 로그인하고<br />리그에 참여하세요</h2>
                <p>기존 StockPilot 가상투자 계정이 그대로 연결됩니다.</p>
                <a className="google-join" href={signInHref("/league")}><LogIn size={17} /> Google로 로그인</a>
              </>
            )}
            {error && <p className="league-error">{error}</p>}
          </section>

          <section className="privacy-card">
            <div><LockKeyhole size={20} /><span><b>투자 정보는 완전히 비공개</b><small>다른 사람은 아래 정보만 볼 수 있어요.</small></span></div>
            <ul>
              <li><span /> 닉네임</li>
              <li><span /> 현재 순위</li>
              <li><span /> 누적 수익률</li>
              <li><span /> 전일 대비 순위 변화</li>
            </ul>
            <p>보유 종목, 주문 내역, 잔고, 실명, 이메일은 공개 API에도 포함되지 않습니다.</p>
          </section>
        </aside>
      </section>

      <section className="league-rules">
        <p>HOW IT WORKS</p>
        <h2>모두에게 같은 조건이에요</h2>
        <div>
          <article><span>01</span><b>동일한 시작 자금</b><p>{data?.rules.startingCapital ?? "₩1억 + $10만으로 시작"}</p></article>
          <article><span>02</span><b>환율 영향 제거</b><p>{data?.rules.scoring ?? "한국·미국 계좌 수익률을 50:50 합산"}</p></article>
          <article><span>03</span><b>실제 시세, 가상 체결</b><p>KIS KRX·NXT 통합 및 미국 주식 시세를 사용해요.</p></article>
        </div>
      </section>

      <footer className="league-footer">
        <b>StockPilot League</b>
        <span>투자 권유가 아닌 가상투자 학습 서비스입니다.</span>
        <a href="/">가상투자로 돌아가기</a>
      </footer>
    </main>
  );
}
