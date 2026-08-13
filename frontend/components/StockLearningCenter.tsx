"use client";

import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  BookOpen,
  Calculator,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clock3,
  Gamepad2,
  GraduationCap,
  Landmark,
  Lightbulb,
  ListChecks,
  LockKeyhole,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Star,
  Target,
  TrendingUp,
  Trophy,
  WalletCards,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  glossary,
  learningChecklist,
  lessons,
  quizQuestions,
  type LearningLesson,
} from "@/lib/learning-content";
import LearningArcade from "./LearningArcade";

type Tab = "home" | "arcade" | "course" | "glossary" | "quiz" | "tools";
type Quote = {
  id: string;
  symbol: string;
  name: string;
  market: "KR" | "US";
  currency: "KRW" | "USD";
  exchange: string;
  price: number;
  change: number;
  changePercent: number;
  asOf: string;
  source: string;
};

type SavedProgress = {
  completed: string[];
  favorites: string[];
  checklist: boolean[];
};

const STORAGE_KEY = "stockpilot_learning_v1";
const emptyProgress: SavedProgress = {
  completed: [],
  favorites: [],
  checklist: learningChecklist.map(() => false),
};
const glossaryCategories = ["전체", "시장", "가격", "기업", "주문", "위험"] as const;
const tabs: { id: Tab; label: string; icon: typeof BookOpen }[] = [
  { id: "home", label: "학습 홈", icon: GraduationCap },
  { id: "arcade", label: "라이브 게임", icon: Gamepad2 },
  { id: "course", label: "12개 코스", icon: BookOpen },
  { id: "glossary", label: "용어사전", icon: Search },
  { id: "quiz", label: "실력 퀴즈", icon: CircleHelp },
  { id: "tools", label: "연습 도구", icon: Calculator },
];

function formatMoney(value: number, currency: Quote["currency"]) {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "KRW" ? 0 : 2,
  }).format(value);
}

function LessonCard({
  lesson,
  completed,
  favorite,
  onOpen,
  onFavorite,
}: {
  lesson: LearningLesson;
  completed: boolean;
  favorite: boolean;
  onOpen: () => void;
  onFavorite: () => void;
}) {
  return (
    <article className={`learn-lesson-card${completed ? " completed" : ""}`}>
      <div className="lesson-card-meta">
        <span>{lesson.level}</span>
        <small><Clock3 size={12} /> {lesson.minutes}분</small>
        <button
          type="button"
          className={favorite ? "favorite active" : "favorite"}
          aria-label={favorite ? `${lesson.title} 즐겨찾기 해제` : `${lesson.title} 즐겨찾기`}
          onClick={onFavorite}
        >
          <Star size={16} fill={favorite ? "currentColor" : "none"} />
        </button>
      </div>
      <small className="lesson-category">{lesson.category}</small>
      <h3>{lesson.title}</h3>
      <p>{lesson.summary}</p>
      <button type="button" className="lesson-open" onClick={onOpen}>
        {completed ? <><CheckCircle2 size={15} /> 다시 보기</> : <>학습 시작 <ChevronRight size={15} /></>}
      </button>
    </article>
  );
}

export default function StockLearningCenter() {
  const [activeTab, setActiveTab] = useState<Tab>("home");
  const [progress, setProgress] = useState<SavedProgress>(emptyProgress);
  const [loaded, setLoaded] = useState(false);
  const [selectedLesson, setSelectedLesson] = useState<LearningLesson | null>(null);
  const [levelFilter, setLevelFilter] = useState("전체");
  const [glossaryQuery, setGlossaryQuery] = useState("");
  const [glossaryCategory, setGlossaryCategory] = useState("전체");
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [quoteIndex, setQuoteIndex] = useState(0);
  const [quoteLoading, setQuoteLoading] = useState(true);
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, number>>({});
  const [showQuizResult, setShowQuizResult] = useState(false);
  const [shares, setShares] = useState("10");
  const [buyPrice, setBuyPrice] = useState("50000");
  const [sellPrice, setSellPrice] = useState("55000");

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved) as Partial<SavedProgress>;
          setProgress({
            completed: Array.isArray(parsed.completed) ? parsed.completed : [],
            favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
            checklist:
              Array.isArray(parsed.checklist) && parsed.checklist.length === learningChecklist.length
                ? parsed.checklist
                : learningChecklist.map(() => false),
          });
        }
      } catch {
        // 학습은 저장소 접근이 제한된 환경에서도 계속 이용할 수 있어요.
      } finally {
        setLoaded(true);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    } catch {
      // 저장 실패는 학습 기능 자체를 막지 않아요.
    }
  }, [loaded, progress]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadQuotes() {
      setQuoteLoading(true);
      try {
        const response = await fetch("/api/trading/quotes", { signal: controller.signal });
        if (!response.ok) throw new Error("시세를 불러오지 못했어요.");
        const data = (await response.json()) as Quote[];
        setQuotes(data.filter((item) => item.price > 0).slice(0, 20));
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setQuotes([]);
      } finally {
        if (!controller.signal.aborted) setQuoteLoading(false);
      }
    }
    void loadQuotes();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!selectedLesson) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedLesson(null);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [selectedLesson]);

  const completedCount = progress.completed.length;
  const completionRate = Math.round((completedCount / lessons.length) * 100);
  const currentQuote = quotes[quoteIndex % Math.max(quotes.length, 1)];
  const answeredCount = Object.keys(quizAnswers).length;
  const quizScore = quizQuestions.reduce(
    (score, question) => score + (quizAnswers[question.id] === question.answer ? 1 : 0),
    0,
  );
  const filteredLessons = useMemo(
    () => lessons.filter((lesson) => levelFilter === "전체" || lesson.level === levelFilter),
    [levelFilter],
  );
  const filteredGlossary = useMemo(() => {
    const query = glossaryQuery.trim().toLowerCase();
    return glossary.filter(
      (item) =>
        (glossaryCategory === "전체" || item.category === glossaryCategory) &&
        (!query || `${item.term} ${item.short} ${item.example}`.toLowerCase().includes(query)),
    );
  }, [glossaryCategory, glossaryQuery]);

  const calculator = useMemo(() => {
    const quantity = Math.max(0, Number(shares) || 0);
    const buy = Math.max(0, Number(buyPrice) || 0);
    const sell = Math.max(0, Number(sellPrice) || 0);
    const principal = quantity * buy;
    const result = quantity * (sell - buy);
    const rate = principal > 0 ? (result / principal) * 100 : 0;
    return { principal, result, rate };
  }, [buyPrice, sellPrice, shares]);

  function toggleFavorite(id: string) {
    setProgress((current) => ({
      ...current,
      favorites: current.favorites.includes(id)
        ? current.favorites.filter((item) => item !== id)
        : [...current.favorites, id],
    }));
  }

  function completeLesson(id: string) {
    setProgress((current) => ({
      ...current,
      completed: current.completed.includes(id) ? current.completed : [...current.completed, id],
    }));
    setSelectedLesson(null);
  }

  function resetQuiz() {
    setQuizAnswers({});
    setQuizIndex(0);
    setShowQuizResult(false);
  }

  function goToTab(tab: Tab) {
    setActiveTab(tab);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const quiz = quizQuestions[quizIndex];
  const selectedAnswer = quizAnswers[quiz.id];
  const checklistDone = progress.checklist.filter(Boolean).length;

  return (
    <main className="learn-page">
      <header className="learn-topbar">
        <Link className="learn-brand" href="/"><span><TrendingUp size={18} /></span>StockPilot</Link>
        <nav aria-label="학습센터 바로가기">
          <Link href="/guide">이용 가이드</Link>
          <Link href="/practice">시세 연습</Link>
          <Link className="market-link" href="/">시장 보기 <ArrowRight size={14} /></Link>
        </nav>
      </header>

      <section className="learn-hero">
        <div className="learn-hero-copy">
          <p><Sparkles size={14} /> STOCKPILOT ACADEMY</p>
          <h1>주식이 뭔지부터<br /><em>내 판단을 만드는 법</em>까지</h1>
          <span>어려운 용어를 외우는 대신, 실제 시세를 읽고 가상투자로 확인하면서 배워요.</span>
          <div className="learn-hero-actions">
            <button type="button" onClick={() => goToTab("course")}><BookOpen size={17} /> 첫 코스 시작</button>
            <button type="button" className="secondary" onClick={() => goToTab("arcade")}><Gamepad2 size={17} /> 라이브 게임</button>
          </div>
          <small><ShieldAlert size={14} /> 투자 권유가 아닌 교육용 콘텐츠이며 실제 수익을 보장하지 않습니다.</small>
        </div>
        <div className="learn-progress-card">
          <div className="progress-ring" style={{ "--progress": `${completionRate * 3.6}deg` } as React.CSSProperties}>
            <span><b>{completionRate}%</b><small>학습 완료</small></span>
          </div>
          <div>
            <p>나의 학습 여정</p>
            <h2>{completedCount ? `${completedCount}개 코스를 끝냈어요` : "첫 번째 개념부터 시작해요"}</h2>
            <span>{lessons.length - completedCount}개 코스가 남아 있어요</span>
          </div>
          <div className="learn-streak"><Trophy size={16} /><span><b>{quizScore * 10 + completedCount * 20}</b> 학습 포인트</span></div>
        </div>
      </section>

      {quotes.length > 0 && (
        <div className="learn-live-ribbon" aria-label="실시간 학습 시세">
          <span className="ribbon-live"><i /> LIVE</span>
          <div>
            {[...quotes.slice(0, 8), ...quotes.slice(0, 8)].map((item, index) => (
              <span key={`${item.id}-${index}`}><b>{item.name}</b><em>{formatMoney(item.price, item.currency)}</em><small className={item.changePercent >= 0 ? "up" : "down"}>{item.changePercent >= 0 ? "+" : ""}{item.changePercent.toFixed(2)}%</small></span>
            ))}
          </div>
        </div>
      )}

      <nav className="learn-tabs" aria-label="학습센터 메뉴">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button type="button" className={activeTab === id ? "active" : ""} onClick={() => goToTab(id)} aria-current={activeTab === id ? "page" : undefined} key={id}>
            <Icon size={17} /> {label}
          </button>
        ))}
      </nav>

      <div className="learn-content">
        {activeTab === "home" && (
          <>
            <section className="learn-section">
              <div className="section-heading"><div><p>START HERE</p><h2>처음이라면 이 순서가 좋아요</h2></div><button type="button" onClick={() => goToTab("course")}>전체 코스 <ChevronRight size={16} /></button></div>
              <div className="learning-path">
                {[
                  [Landmark, "1", "주식의 정체", "회사의 조각과 시장 구조 이해"],
                  [BarChart3, "2", "숫자 읽기", "가격·차트·기업 실적 구분"],
                  [WalletCards, "3", "주문 연습", "시장가·지정가와 체결비용"],
                  [Target, "4", "위험 관리", "비중·손실 한도·투자 기록"],
                ].map(([Icon, step, title, text]) => (
                  <article key={String(step)}><span><Icon size={21} /></span><small>STEP {String(step)}</small><h3>{String(title)}</h3><p>{String(text)}</p></article>
                ))}
              </div>
            </section>

            <section className="arcade-preview-card">
              <div className="arcade-preview-visual" aria-hidden>
                <span><Gamepad2 size={26} /></span>
                <i /><i /><i /><i /><i />
              </div>
              <div><p>LIVE LEARNING GAME</p><h2>읽지만 말고, 움직이는 시장에서 판단해요</h2><span>실제 시세 판독, 움직이는 호가, 포트폴리오 비중과 시간제한 용어 게임을 플레이하세요.</span></div>
              <button type="button" onClick={() => goToTab("arcade")}>게임 시작 <ArrowRight size={16} /></button>
            </section>

            <section className="learn-section live-anatomy">
              <div className="section-heading"><div><p>LIVE EXPLAINER</p><h2>실제 시세 한 줄을 같이 읽어봐요</h2></div>{quotes.length > 1 && <button type="button" onClick={() => setQuoteIndex((value) => (value + 1) % quotes.length)}><RefreshCw size={15} /> 다른 종목</button>}</div>
              {quoteLoading ? (
                <div className="quote-learning-skeleton" aria-label="시세 학습 자료 불러오는 중" />
              ) : currentQuote ? (
                <div className="quote-anatomy-grid">
                  <article className="live-quote-card">
                    <div><span>{currentQuote.market === "KR" ? "한국" : "미국"} · {currentQuote.exchange}</span><small>{currentQuote.source}</small></div>
                    <h3>{currentQuote.name}</h3><p>{currentQuote.symbol}</p>
                    <strong>{formatMoney(currentQuote.price, currentQuote.currency)}</strong>
                    <em className={currentQuote.changePercent >= 0 ? "up" : "down"}>{currentQuote.changePercent >= 0 ? "+" : ""}{currentQuote.changePercent.toFixed(2)}%</em>
                  </article>
                  <div className="quote-explanations">
                    <article><span>01</span><div><b>현재가</b><p>가장 최근 거래가 성사된 가격이에요. 다음 주문 가격을 보장하지는 않아요.</p></div></article>
                    <article><span>02</span><div><b>등락률</b><p>전 거래일 기준 가격과 비교한 변화율이에요. 기업 가치 전체가 그만큼 변했다는 뜻은 아니에요.</p></div></article>
                    <article><span>03</span><div><b>거래소·통화</b><p>{currentQuote.market === "KR" ? "원화로 거래하며 KRX·NXT 세션과 가격을 확인해요." : "달러로 거래하며 환율에 따라 원화 수익이 달라질 수 있어요."}</p></div></article>
                    <article><span>04</span><div><b>데이터 시각</b><p>{new Date(currentQuote.asOf).toLocaleString("ko-KR")} 기준이에요. 투자 전 최신 여부를 확인해요.</p></div></article>
                  </div>
                </div>
              ) : (
                <div className="learn-empty"><BarChart3 size={24} /><b>시세 연결을 기다리고 있어요</b><p>코스와 용어사전은 시세 없이도 계속 학습할 수 있습니다.</p></div>
              )}
            </section>

            <section className="learn-section">
              <div className="section-heading"><div><p>QUICK COURSE</p><h2>지금 시작하기 좋은 코스</h2></div></div>
              <div className="lesson-grid featured">
                {lessons.slice(0, 3).map((lesson) => <LessonCard lesson={lesson} completed={progress.completed.includes(lesson.id)} favorite={progress.favorites.includes(lesson.id)} onOpen={() => setSelectedLesson(lesson)} onFavorite={() => toggleFavorite(lesson.id)} key={lesson.id} />)}
              </div>
            </section>

            <section className="misconception-section">
              <div><ShieldAlert size={22} /><p>초보자가 자주 오해해요</p><h2>“주가가 싸다”와 “가격 숫자가 작다”는 달라요.</h2><span>1주 가격만 보지 말고 시가총액, 이익, 주식 수와 사업의 질을 함께 비교해야 합니다.</span></div>
              <button type="button" onClick={() => { setGlossaryQuery("시가총액"); goToTab("glossary"); }}>시가총액 알아보기 <ArrowRight size={15} /></button>
            </section>
          </>
        )}

        {activeTab === "arcade" && <LearningArcade quotes={quotes} />}

        {activeTab === "course" && (
          <section className="learn-section course-section">
            <div className="section-heading"><div><p>12 MICRO COURSES</p><h2>하루 5분, 주식 기초 완성</h2><span>완료한 코스는 이 기기에 자동 저장돼요.</span></div></div>
            <div className="level-filter" role="group" aria-label="난이도 선택">
              {["전체", "입문", "기초", "실전"].map((level) => <button type="button" className={levelFilter === level ? "active" : ""} onClick={() => setLevelFilter(level)} key={level}>{level}</button>)}
            </div>
            <div className="lesson-grid">
              {filteredLessons.map((lesson) => <LessonCard lesson={lesson} completed={progress.completed.includes(lesson.id)} favorite={progress.favorites.includes(lesson.id)} onOpen={() => setSelectedLesson(lesson)} onFavorite={() => toggleFavorite(lesson.id)} key={lesson.id} />)}
            </div>
          </section>
        )}

        {activeTab === "glossary" && (
          <section className="learn-section glossary-section">
            <div className="section-heading"><div><p>PLAIN KOREAN</p><h2>어려운 주식 용어를 쉽게</h2><span>{glossary.length}개 핵심 용어를 예시와 함께 정리했어요.</span></div></div>
            <label className="glossary-search"><Search size={18} /><input value={glossaryQuery} onChange={(event) => setGlossaryQuery(event.target.value)} placeholder="PER, 시장가, 평가손익처럼 검색해 보세요" /><kbd>{filteredGlossary.length}개</kbd></label>
            <div className="glossary-filters" role="group" aria-label="용어 분류">
              {glossaryCategories.map((category) => <button type="button" className={glossaryCategory === category ? "active" : ""} onClick={() => setGlossaryCategory(category)} key={category}>{category}</button>)}
            </div>
            <div className="glossary-grid">
              {filteredGlossary.map((item) => <article key={item.term}><div><b>{item.term}</b><span>{item.category}</span></div><p>{item.short}</p><small><Lightbulb size={13} /> {item.example}</small></article>)}
            </div>
            {!filteredGlossary.length && <div className="learn-empty"><Search size={24} /><b>일치하는 용어가 없어요</b><p>검색어를 짧게 입력하거나 분류를 ‘전체’로 바꿔 보세요.</p></div>}
          </section>
        )}

        {activeTab === "quiz" && (
          <section className="learn-section quiz-section">
            <div className="section-heading"><div><p>KNOWLEDGE CHECK</p><h2>10문제로 확인하는 주식 기초</h2><span>틀려도 괜찮아요. 답을 고르면 바로 이유를 알려드려요.</span></div><small>{answeredCount}/{quizQuestions.length} 완료</small></div>
            <div className="quiz-progress"><span style={{ width: `${(answeredCount / quizQuestions.length) * 100}%` }} /></div>
            {showQuizResult ? (
              <div className="quiz-result">
                <span><Trophy size={31} /></span><p>학습 결과</p><h3>{quizScore * 10}점</h3>
                <b>{quizScore >= 8 ? "기초가 탄탄해요!" : quizScore >= 5 ? "좋은 출발이에요." : "코스를 한 번 둘러보면 더 쉬워져요."}</b>
                <div><button type="button" onClick={resetQuiz}><RefreshCw size={15} /> 다시 풀기</button><button type="button" className="primary" onClick={() => goToTab("course")}><BookOpen size={15} /> 코스로 복습</button></div>
              </div>
            ) : (
              <div className="quiz-card">
                <div className="quiz-number"><span>QUESTION {quizIndex + 1}</span><small>{quiz.question.includes("StockPilot") ? "서비스 안전" : "주식 기초"}</small></div>
                <h3>{quiz.question}</h3>
                <div className="quiz-choices">
                  {quiz.choices.map((choice, index) => {
                    const answered = selectedAnswer !== undefined;
                    const correct = answered && index === quiz.answer;
                    const wrong = answered && index === selectedAnswer && index !== quiz.answer;
                    return <button type="button" className={correct ? "correct" : wrong ? "wrong" : ""} disabled={answered} onClick={() => setQuizAnswers((current) => ({ ...current, [quiz.id]: index }))} key={choice}><span>{String.fromCharCode(65 + index)}</span>{choice}{correct && <Check size={16} />}{wrong && <X size={16} />}</button>;
                  })}
                </div>
                {selectedAnswer !== undefined && <div className={selectedAnswer === quiz.answer ? "quiz-feedback correct" : "quiz-feedback wrong"}><BadgeCheck size={19} /><div><b>{selectedAnswer === quiz.answer ? "정답이에요" : "여기서 많이 헷갈려요"}</b><p>{quiz.explanation}</p></div></div>}
                <footer><button type="button" disabled={quizIndex === 0} onClick={() => setQuizIndex((value) => Math.max(0, value - 1))}>이전</button><button type="button" className="primary" disabled={selectedAnswer === undefined} onClick={() => quizIndex === quizQuestions.length - 1 ? setShowQuizResult(true) : setQuizIndex((value) => value + 1)}>{quizIndex === quizQuestions.length - 1 ? "결과 보기" : "다음 문제"} <ChevronRight size={15} /></button></footer>
              </div>
            )}
          </section>
        )}

        {activeTab === "tools" && (
          <section className="learn-section tools-section">
            <div className="section-heading"><div><p>PRACTICE TOOLS</p><h2>숫자로 확인하고, 질문으로 점검해요</h2><span>계산 결과는 비용과 세금을 제외한 단순 교육용 예시입니다.</span></div></div>
            <div className="learning-tools-grid">
              <article className="return-calculator">
                <div className="tool-title"><span><Calculator size={20} /></span><div><h3>수익·손실 계산기</h3><p>가격과 수량이 결과에 어떻게 연결되는지 확인해요.</p></div></div>
                <div className="calculator-inputs">
                  <label>수량<input type="number" min="0" value={shares} onChange={(event) => setShares(event.target.value)} /><small>주</small></label>
                  <label>매수가<input type="number" min="0" value={buyPrice} onChange={(event) => setBuyPrice(event.target.value)} /><small>원</small></label>
                  <label>예상 매도가<input type="number" min="0" value={sellPrice} onChange={(event) => setSellPrice(event.target.value)} /><small>원</small></label>
                </div>
                <div className="calculator-result"><span><small>투입 금액</small><b>{calculator.principal.toLocaleString("ko-KR")}원</b></span><span><small>단순 손익</small><b className={calculator.result >= 0 ? "up" : "down"}>{calculator.result >= 0 ? "+" : ""}{calculator.result.toLocaleString("ko-KR")}원</b></span><span><small>수익률</small><b className={calculator.rate >= 0 ? "up" : "down"}>{calculator.rate >= 0 ? "+" : ""}{calculator.rate.toFixed(2)}%</b></span></div>
                <small className="tool-caution"><ShieldAlert size={13} /> 실제 결과에는 수수료·세금·환율·슬리피지가 반영될 수 있어요.</small>
              </article>
              <article className="buy-checklist">
                <div className="tool-title"><span><ListChecks size={20} /></span><div><h3>매수 전 6문장</h3><p>체크 수보다 답하지 못한 항목을 찾는 것이 중요해요.</p></div></div>
                <div className="checklist-score"><b>{checklistDone}/6</b><span><i style={{ width: `${(checklistDone / learningChecklist.length) * 100}%` }} /></span><small>{checklistDone === 6 ? "계획을 잘 정리했어요" : "천천히 근거를 채워 보세요"}</small></div>
                <div className="checklist-items">
                  {learningChecklist.map((item, index) => <label key={item}><input type="checkbox" checked={progress.checklist[index]} onChange={() => setProgress((current) => ({ ...current, checklist: current.checklist.map((checked, itemIndex) => itemIndex === index ? !checked : checked) }))} /><span><Check size={13} /></span>{item}</label>)}
                </div>
              </article>
            </div>
            <div className="safety-strip"><LockKeyhole size={22} /><div><b>비밀번호·인증번호·실제 투자금을 요구하지 않아요.</b><p>고수익 보장, 입금 재촉, 출처 불명 비밀 정보는 투자 기회가 아니라 위험 신호일 수 있습니다.</p></div><Link href="/practice">가상으로 연습하기 <ArrowRight size={15} /></Link></div>
          </section>
        )}
      </div>

      <section className="learn-bottom-cta">
        <div><p>배웠다면 작은 가상주문으로 확인해 보세요.</p><h2>실제 돈 없이, 실제 시세로 연습합니다.</h2></div>
        <Link href="/">가상투자 시작 <ArrowRight size={16} /></Link>
      </section>

      <footer className="learn-footer"><b>StockPilot Academy</b><span>교육용 정보이며 특정 종목의 매수·매도를 권유하지 않습니다.</span><div><Link href="/privacy">개인정보처리방침</Link><Link href="/terms">이용약관</Link></div></footer>

      {selectedLesson && (
        <div className="lesson-modal-layer" role="presentation">
          <button className="lesson-modal-backdrop" type="button" aria-label="학습 내용 닫기" onClick={() => setSelectedLesson(null)} />
          <section className="lesson-modal" role="dialog" aria-modal="true" aria-labelledby="lesson-modal-title">
            <header><div><span>{selectedLesson.level} · {selectedLesson.minutes}분</span><h2 id="lesson-modal-title">{selectedLesson.title}</h2></div><button type="button" aria-label="학습 내용 닫기" onClick={() => setSelectedLesson(null)}><X size={20} /></button></header>
            <div className="lesson-modal-body"><p className="lesson-lead">{selectedLesson.summary}</p><h3>이것만은 기억해요</h3><ul>{selectedLesson.takeaways.map((item) => <li key={item}><CheckCircle2 size={17} /><span>{item}</span></li>)}</ul><div className="lesson-warning"><ShieldAlert size={18} /><div><b>판단 전 잠깐</b><p>{selectedLesson.caution}</p></div></div></div>
            <footer><button type="button" onClick={() => setSelectedLesson(null)}>나중에 볼게요</button><button type="button" className="primary" onClick={() => completeLesson(selectedLesson.id)}><Check size={16} /> 학습 완료</button></footer>
          </section>
        </div>
      )}
    </main>
  );
}
