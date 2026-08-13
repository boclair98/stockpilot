"use client";

import {
  Activity,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  CircleDollarSign,
  Clock3,
  Gamepad2,
  Gauge,
  Layers3,
  RefreshCw,
  Sparkles,
  Target,
  Timer,
  Trophy,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { glossary } from "@/lib/learning-content";

type ArcadeQuote = {
  symbol: string;
  name: string;
  currency: "KRW" | "USD";
  price: number;
  changePercent: number;
};

type GameId = "pulse" | "order" | "risk" | "words";
type ArcadeProgress = {
  xp: number;
  streak: number;
  plays: number;
  bestPulse: number;
  bestWords: number;
};

const ARCADE_STORAGE_KEY = "stockpilot_arcade_v1";
const emptyProgress: ArcadeProgress = {
  xp: 0,
  streak: 0,
  plays: 0,
  bestPulse: 0,
  bestWords: 0,
};

const games = [
  { id: "pulse" as const, label: "시세 순발력", icon: Activity, color: "mint", description: "움직이는 실제 시세의 의미를 7초 안에 판단해요." },
  { id: "order" as const, label: "주문 체결실", icon: Layers3, color: "blue", description: "움직이는 호가에서 시장가와 지정가를 직접 비교해요." },
  { id: "risk" as const, label: "위험 밸런서", icon: Gauge, color: "orange", description: "주식과 현금 비중을 조절해 미션 조건을 맞춰요." },
  { id: "words" as const, label: "용어 스프린트", icon: Zap, color: "purple", description: "20초 동안 설명에 맞는 용어를 최대한 많이 찾아요." },
];

function money(value: number, currency: ArcadeQuote["currency"] = "KRW") {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "KRW" ? 0 : 2,
  }).format(value);
}

function seededOffset(seed: number) {
  return Math.sin(seed * 12.9898) * 0.0018 + Math.cos(seed * 4.123) * 0.0011;
}

function PulseGame({ quotes, onReward }: { quotes: ArcadeQuote[]; onReward: (xp: number, correct: boolean) => void }) {
  const [round, setRound] = useState(0);
  const [timeLeft, setTimeLeft] = useState(7);
  const [score, setScore] = useState(0);
  const [answered, setAnswered] = useState<"UP" | "DOWN" | "FLAT" | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const quote = quotes[round % Math.max(quotes.length, 1)];
  const expected = !quote ? "FLAT" : quote.changePercent > 0.05 ? "UP" : quote.changePercent < -0.05 ? "DOWN" : "FLAT";

  useEffect(() => {
    if (answered || !quote) return;
    const timer = window.setInterval(() => {
      setTimeLeft((value) => {
        if (value <= 1) {
          window.clearInterval(timer);
          setTimedOut(true);
          setAnswered(expected === "FLAT" ? "UP" : "FLAT");
          onReward(0, false);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [answered, expected, onReward, quote]);

  function answer(value: "UP" | "DOWN" | "FLAT") {
    if (answered) return;
    setAnswered(value);
    const correct = value === expected;
    if (correct) setScore((current) => current + 1);
    onReward(correct ? 12 + timeLeft : 0, correct);
  }

  function next() {
    setRound((value) => value + 1);
    setTimeLeft(7);
    setAnswered(null);
    setTimedOut(false);
  }

  if (!quote) return <div className="arcade-empty">실제 시세를 연결하면 게임이 시작돼요.</div>;

  return (
    <div className="pulse-game">
      <div className="game-status-row"><span><Timer size={14} /> <b>{timeLeft}</b>초</span><span>연속 점수 <b>{score}</b></span></div>
      <div className="pulse-live-card">
        <div className="pulse-wave" aria-hidden>{[0, 1, 2, 3, 4, 5, 6, 7].map((item) => <i key={item} style={{ height: `${26 + Math.abs(Math.sin(round + item)) * 54}%` }} />)}</div>
        <small>LIVE READING · {quote.symbol}</small>
        <h3>{quote.name}</h3>
        <strong>{money(quote.price, quote.currency)}</strong>
        <em className={quote.changePercent >= 0 ? "up" : "down"}>{quote.changePercent >= 0 ? "+" : ""}{quote.changePercent.toFixed(2)}%</em>
      </div>
      <p className="game-question">전 거래일 기준으로 이 시세를 어떻게 읽어야 할까요?</p>
      <div className="pulse-answers">
        {([['UP', ArrowUp, '상승'], ['FLAT', ArrowRight, '보합'], ['DOWN', ArrowDown, '하락']] as const).map(([value, Icon, label]) => {
          const correct = answered && value === expected;
          const wrong = answered === value && value !== expected;
          return <button type="button" className={correct ? "correct" : wrong ? "wrong" : ""} disabled={Boolean(answered)} onClick={() => answer(value)} key={value}><Icon size={18} />{label}{correct ? <Check size={14} /> : wrong ? <X size={14} /> : null}</button>;
        })}
      </div>
      {answered && <div className="game-feedback"><b>{timedOut ? "시간이 끝났어요" : answered === expected ? "정확해요!" : "방향을 다시 확인해요"}</b><span>등락률의 부호는 전 거래일 종가와 비교한 방향입니다. 기업의 미래를 예측하는 신호는 아니에요.</span><button type="button" onClick={next}>다음 시세 <ArrowRight size={14} /></button></div>}
    </div>
  );
}

function OrderGame({ quote, onReward }: { quote?: ArcadeQuote; onReward: (xp: number, correct: boolean) => void }) {
  const [tick, setTick] = useState(0);
  const [round, setRound] = useState(0);
  const [choice, setChoice] = useState<"MARKET" | "LIMIT" | null>(null);
  const base = quote?.price || 50000;
  const currency = quote?.currency || "KRW";
  const tickSize = currency === "KRW" ? Math.max(1, Math.round(base * 0.0005)) : 0.01;
  const mid = base * (1 + seededOffset(tick + round * 13));
  const ask = mid + tickSize;
  const bid = mid - tickSize;
  const missionFast = round % 2 === 0;
  const correctChoice = missionFast ? "MARKET" : "LIMIT";

  useEffect(() => {
    if (choice) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 850);
    return () => window.clearInterval(timer);
  }, [choice]);

  function choose(value: "MARKET" | "LIMIT") {
    if (choice) return;
    setChoice(value);
    onReward(value === correctChoice ? 20 : 4, value === correctChoice);
  }

  return (
    <div className="order-game">
      <div className="order-mission"><Target size={18} /><div><small>이번 미션</small><b>{missionFast ? "가격보다 빠른 체결이 중요해요" : `${money(bid, currency)} 이하에서만 사고 싶어요`}</b></div><span>5주 매수</span></div>
      <div className="order-book-live">
        <div className="book-label"><span>매도 호가</span><b>수량</b></div>
        {[3, 2, 1].map((level) => <div className="ask-row" key={`ask-${level}`}><span style={{ width: `${48 + level * 11}%` }} /><b>{money(ask + tickSize * (level - 1), currency)}</b><small>{24 + ((tick + level * 7) % 60)}</small></div>)}
        <div className="book-mid"><Activity size={14} /><span>{quote?.name || "연습 종목"}</span><strong>{money(mid, currency)}</strong><i /></div>
        {[1, 2, 3].map((level) => <div className="bid-row" key={`bid-${level}`}><span style={{ width: `${52 + level * 9}%` }} /><b>{money(bid - tickSize * (level - 1), currency)}</b><small>{18 + ((tick + level * 11) % 70)}</small></div>)}
      </div>
      <div className="order-choice-grid">
        <button type="button" className={choice === "MARKET" ? (correctChoice === "MARKET" ? "correct" : "wrong") : ""} disabled={Boolean(choice)} onClick={() => choose("MARKET")}><Zap size={18} /><span><b>시장가</b><small>현재 가능한 호가에 빠르게 체결</small></span></button>
        <button type="button" className={choice === "LIMIT" ? (correctChoice === "LIMIT" ? "correct" : "wrong") : ""} disabled={Boolean(choice)} onClick={() => choose("LIMIT")}><Target size={18} /><span><b>지정가</b><small>가격을 통제하지만 미체결 가능</small></span></button>
      </div>
      {choice && <div className="game-feedback"><b>{choice === correctChoice ? "미션에 맞는 주문이에요!" : "주문의 우선순위를 바꿔 보세요"}</b><span>{missionFast ? "시장가는 가격보다 체결 가능성을 우선합니다. 호가가 움직이면 예상가와 달라질 수 있어요." : "지정가는 원하는 가격을 통제하지만 시장이 멀어지면 체결되지 않을 수 있어요."}</span><button type="button" onClick={() => { setRound((value) => value + 1); setChoice(null); }}>새 미션 <RefreshCw size={14} /></button></div>}
    </div>
  );
}

function RiskGame({ onReward }: { onReward: (xp: number, correct: boolean) => void }) {
  const [allocation, setAllocation] = useState({ first: 45, second: 35, cash: 20 });
  const [checked, setChecked] = useState(false);
  const valid = allocation.first <= 40 && allocation.second <= 40 && allocation.cash >= 25;

  function update(key: keyof typeof allocation, value: number) {
    const others = (Object.keys(allocation) as (keyof typeof allocation)[]).filter((item) => item !== key);
    const clamped = Math.min(80, Math.max(0, value));
    const rest = 100 - clamped;
    const otherTotal = allocation[others[0]] + allocation[others[1]];
    const firstOther = otherTotal ? Math.round((allocation[others[0]] / otherTotal) * rest) : Math.round(rest / 2);
    setAllocation({ ...allocation, [key]: clamped, [others[0]]: firstOther, [others[1]]: rest - firstOther });
    setChecked(false);
  }

  function check() {
    setChecked(true);
    onReward(valid ? 30 : 3, valid);
  }

  const risk = allocation.first * 1.2 + allocation.second * 0.9 + allocation.cash * 0.1;
  return (
    <div className="risk-game">
      <div className="risk-mission"><span><Gauge size={19} /></span><div><small>균형 미션</small><b>한 종목 40% 이하 · 현금 25% 이상</b><p>버튼이나 슬라이더를 움직여 총 100%를 맞춰 보세요.</p></div></div>
      <div className="allocation-orbit" aria-label="현재 자산 배분">
        <div className="allocation-donut" style={{ background: `conic-gradient(#10a36d 0 ${allocation.first}%, #4b7bec ${allocation.first}% ${allocation.first + allocation.second}%, #f0b449 ${allocation.first + allocation.second}% 100%)` }}><span><small>위험 온도</small><b>{Math.round(risk)}</b></span></div>
        <div className="allocation-bars">
          {([['first', '성장주 A', '#10a36d'], ['second', '가치주 B', '#4b7bec'], ['cash', '현금', '#f0b449']] as const).map(([key, label, color]) => <label key={key}><span><i style={{ background: color }} />{label}<b>{allocation[key]}%</b></span><input type="range" min="0" max="80" step="5" value={allocation[key]} onChange={(event) => update(key, Number(event.target.value))} /></label>)}
        </div>
      </div>
      <button type="button" className="risk-check-button" disabled={checked} onClick={check}><Target size={16} /> {checked ? "점검 완료" : "균형 점검"}</button>
      {checked && <div className="game-feedback"><b>{valid ? "안전 조건을 모두 맞췄어요!" : "아직 비중을 조절해야 해요"}</b><span>{valid ? "집중 비중을 낮추고 현금 여유를 확보했습니다. 분산도 손실을 완전히 없애지는 않아요." : `현재 최대 종목 ${Math.max(allocation.first, allocation.second)}%, 현금 ${allocation.cash}%예요.`}</span></div>}
    </div>
  );
}

function WordGame({ onReward }: { onReward: (xp: number, correct: boolean) => void }) {
  const [playing, setPlaying] = useState(false);
  const [timeLeft, setTimeLeft] = useState(20);
  const [round, setRound] = useState(0);
  const [score, setScore] = useState(0);
  const [flash, setFlash] = useState<"correct" | "wrong" | null>(null);
  const question = glossary[round % glossary.length];
  const choices = useMemo(() => {
    const items = [question];
    for (let offset = 5; items.length < 4; offset += 7) {
      const candidate = glossary[(round + offset) % glossary.length];
      if (!items.some((item) => item.term === candidate.term)) items.push(candidate);
    }
    return items.toSorted((a, b) => ((a.term.charCodeAt(0) + round) % 7) - ((b.term.charCodeAt(0) + round) % 7));
  }, [question, round]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setTimeLeft((value) => {
        if (value <= 1) {
          window.clearInterval(timer);
          setPlaying(false);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [playing]);

  function start() {
    setPlaying(true);
    setTimeLeft(20);
    setRound(0);
    setScore(0);
    setFlash(null);
  }

  function choose(term: string) {
    if (!playing || flash) return;
    const correct = term === question.term;
    setFlash(correct ? "correct" : "wrong");
    if (correct) setScore((value) => value + 1);
    onReward(correct ? 8 : 0, correct);
    window.setTimeout(() => {
      setRound((value) => value + 1);
      setFlash(null);
    }, 360);
  }

  if (!playing && timeLeft === 20) return <div className="word-start"><span><Zap size={30} /></span><h3>20초 용어 스프린트</h3><p>설명에 맞는 용어를 빠르게 선택하세요. 틀려도 점수만 오르지 않을 뿐 계속 진행돼요.</p><button type="button" onClick={start}>게임 시작 <ArrowRight size={15} /></button></div>;
  if (!playing) return <div className="word-result"><span><Trophy size={30} /></span><small>최종 기록</small><h3>{score}개</h3><p>{score >= 8 ? "용어 감각이 아주 빨라요!" : score >= 4 ? "좋아요. 한 번 더 하면 기록이 오르겠어요." : "용어사전을 둘러본 뒤 다시 도전해 보세요."}</p><button type="button" onClick={start}><RefreshCw size={15} /> 다시 도전</button></div>;

  return (
    <div className={`word-game ${flash || ""}`}>
      <div className="word-timer"><Clock3 size={15} /><b>{timeLeft}</b><span><i style={{ width: `${(timeLeft / 20) * 100}%` }} /></span><small>{score}점</small></div>
      <small>이 설명에 맞는 용어는?</small><h3>{question.short}</h3><div className="word-choices">{choices.map((item) => <button type="button" disabled={Boolean(flash)} onClick={() => choose(item.term)} key={item.term}>{item.term}</button>)}</div>
    </div>
  );
}

export default function LearningArcade({ quotes }: { quotes: ArcadeQuote[] }) {
  const [activeGame, setActiveGame] = useState<GameId>("pulse");
  const [progress, setProgress] = useState<ArcadeProgress>(emptyProgress);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const saved = localStorage.getItem(ARCADE_STORAGE_KEY);
        if (saved) setProgress({ ...emptyProgress, ...(JSON.parse(saved) as Partial<ArcadeProgress>) });
      } catch {
        // 저장이 제한되어도 게임은 계속 이용할 수 있어요.
      } finally {
        setLoaded(true);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(ARCADE_STORAGE_KEY, JSON.stringify(progress));
    } catch {
      // 기록 저장 실패는 게임 진행을 막지 않아요.
    }
  }, [loaded, progress]);

  const reward = useCallback((xp: number, correct: boolean) => {
    setProgress((current) => ({ ...current, xp: current.xp + xp, plays: current.plays + 1, streak: correct ? current.streak + 1 : 0 }));
  }, []);

  const level = Math.floor(progress.xp / 100) + 1;
  const levelProgress = progress.xp % 100;
  return (
    <section className="learning-arcade">
      <header className="arcade-header">
        <div><p><Gamepad2 size={15} /> LIVE LEARNING ARCADE</p><h2>움직이는 시장에서 직접 판단해요</h2><span>읽는 학습을 넘어, 시세·호가·비중을 움직이며 결과를 바로 확인합니다.</span></div>
        <div className="arcade-level"><span>LV.{level}</span><div><b>{progress.xp.toLocaleString("ko-KR")} XP</b><i><em style={{ width: `${levelProgress}%` }} /></i></div><small><Zap size={12} /> 연속 {progress.streak}</small></div>
      </header>
      <div className="arcade-game-tabs" role="tablist" aria-label="학습 게임 선택">
        {games.map(({ id, label, icon: Icon, color, description }) => <button type="button" role="tab" aria-selected={activeGame === id} className={`${color}${activeGame === id ? " active" : ""}`} onClick={() => setActiveGame(id)} key={id}><span><Icon size={19} /></span><div><b>{label}</b><small>{description}</small></div><ArrowRight size={14} /></button>)}
      </div>
      <div className="arcade-stage" key={activeGame}>
        <div className="arcade-stage-head"><span><CircleDollarSign size={15} /> 실제 돈이 아닌 학습 게임</span><small>{progress.plays}번 판단 · 서버 추가 연산 없음</small></div>
        {activeGame === "pulse" ? <PulseGame quotes={quotes} onReward={reward} /> : null}
        {activeGame === "order" ? <OrderGame quote={quotes[0]} onReward={reward} /> : null}
        {activeGame === "risk" ? <RiskGame onReward={reward} /> : null}
        {activeGame === "words" ? <WordGame onReward={reward} /> : null}
      </div>
      <footer className="arcade-footer"><Sparkles size={15} /><p><b>게임 결과는 투자 실력을 보장하지 않아요.</b><span>빠른 판단보다 근거를 확인하고 위험을 관리하는 습관을 만드는 것이 목표입니다.</span></p></footer>
    </section>
  );
}
