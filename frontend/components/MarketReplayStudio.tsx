"use client";

import {
  CalendarClock,
  ChevronDown,
  CircleHelp,
  Copy,
  LockKeyhole,
  Play,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Target,
  TrendingUp,
  Trophy,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type Currency = "KRW" | "USD";
type Market = "KR" | "US";
type HistoryPoint = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};
type StrategyKey = "LUMP_SUM" | "SPLIT" | "WAIT";
type StrategyResult = {
  key: StrategyKey;
  label: string;
  description: string;
  finalValue: number;
  returnRate: number;
  maxDrawdown: number;
  bestDay: number;
  worstDay: number;
  entries: number;
  path: number[];
  entryIndices: number[];
};

const HORIZON = 10;
const MIN_LOOKBACK = 5;
const STRATEGIES: Array<{
  key: StrategyKey;
  label: string;
  description: string;
  detail: string;
}> = [
  {
    key: "LUMP_SUM",
    label: "한 번에 매수",
    description: "체크포인트의 종가에 전액 진입",
    detail: "결정 속도는 빠르지만 시작 시점의 영향이 커요",
  },
  {
    key: "SPLIT",
    label: "3회 분할",
    description: "체크포인트·3일 후·6일 후에 나누어 진입",
    detail: "진입 시점을 나누어 경로의 흔들림을 확인해요",
  },
  {
    key: "WAIT",
    label: "현금 대기",
    description: "10거래일 동안 가상자금을 그대로 보관",
    detail: "수익 대신 기회비용과 마음의 여유를 비교해요",
  },
];

const money = (value: number, currency: Currency) =>
  new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "KRW" ? 0 : 2,
  }).format(value);

function compactDate(value: string) {
  const normalized =
    value.length === 8
      ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
      : value;
  const date = new Date(`${normalized}T00:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function signedPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function maxDrawdown(path: number[]) {
  let peak = path[0] || 0;
  let drawdown = 0;
  for (const value of path) {
    peak = Math.max(peak, value);
    if (peak > 0) drawdown = Math.min(drawdown, ((value - peak) / peak) * 100);
  }
  return drawdown;
}

function simulate(
  key: StrategyKey,
  points: HistoryPoint[],
  budget: number,
): StrategyResult {
  const prices = points.map((point) => point.close);
  const initial = prices[0] || 0;
  const entryIndices =
    key === "LUMP_SUM" ? [0] : key === "SPLIT" ? [0, 3, 6] : [];
  const tranche = budget / 3;
  const path = prices.map((price, day) => {
    if (key === "WAIT") return budget;
    if (key === "LUMP_SUM") return budget * (price / initial);
    return entryIndices.reduce((value, entryIndex) => {
      if (day < entryIndex) return value + tranche;
      return value + tranche * (price / (prices[entryIndex] || price));
    }, 0);
  });
  const dailyReturns = prices.slice(1).map((price, index) => {
    const previous = prices[index] || price;
    return previous ? ((price - previous) / previous) * 100 : 0;
  });
  const definition = STRATEGIES.find((item) => item.key === key) ?? STRATEGIES[0];
  return {
    key,
    label: definition.label,
    description: definition.description,
    finalValue: path.at(-1) || budget,
    returnRate: budget ? (((path.at(-1) || budget) / budget) - 1) * 100 : 0,
    maxDrawdown: maxDrawdown(path),
    bestDay: dailyReturns.length ? Math.max(...dailyReturns) : 0,
    worstDay: dailyReturns.length ? Math.min(...dailyReturns) : 0,
    entries: entryIndices.length,
    path,
    entryIndices,
  };
}

function MiniPath({
  values,
  positive,
}: {
  values: number[];
  positive: boolean;
}) {
  const points = useMemo(() => {
    if (values.length < 2) return "0,30 100,30";
    const min = Math.min(...values);
    const max = Math.max(...values);
    const spread = max - min || 1;
    return values
      .map((value, index) => {
        const x = (index / (values.length - 1)) * 100;
        const y = 38 - ((value - min) / spread) * 30;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [values]);
  return (
    <svg className="replay-mini-path" viewBox="0 0 100 42" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} className={positive ? "positive" : "negative"} />
    </svg>
  );
}

export default function MarketReplayStudio({
  symbol,
  name,
  market,
  exchange,
  currency,
}: {
  symbol: string;
  name: string;
  market: Market;
  exchange: string;
  currency: Currency;
}) {
  const [expanded, setExpanded] = useState(false);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [checkpointIndex, setCheckpointIndex] = useState(0);
  const [strategy, setStrategy] = useState<StrategyKey | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [budget, setBudget] = useState(currency === "KRW" ? "1000000" : "1000");
  const [challenge, setChallenge] = useState(1);
  const [shareMessage, setShareMessage] = useState("");

  useEffect(() => {
    const resetTimer = window.setTimeout(() => {
      setBudget(currency === "KRW" ? "1000000" : "1000");
      setHistory([]);
      setStrategy(null);
      setRevealed(false);
      setShareMessage("");
    }, 0);
    return () => window.clearTimeout(resetTimer);
  }, [currency, exchange, market, symbol]);

  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setFailed(false);
      try {
        const params = new URLSearchParams({ symbol, market, exchange });
        const response = await fetch(`/api/features/history?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("history unavailable");
        const body = await response.json();
        if (controller.signal.aborted) return;
        const items = Array.isArray(body.items) ? body.items : [];
        setHistory(items);
        const max = items.length - HORIZON - 1;
        if (max >= MIN_LOOKBACK) {
          setCheckpointIndex(Math.min(Math.max(MIN_LOOKBACK, Math.floor(items.length * 0.42)), max));
        }
      } catch {
        if (!controller.signal.aborted) {
          setHistory([]);
          setFailed(true);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [expanded, exchange, market, symbol]);

  const maxCheckpoint = history.length - HORIZON - 1;
  const ready = history.length >= HORIZON + MIN_LOOKBACK + 1 && maxCheckpoint >= MIN_LOOKBACK;
  const checkpoint = ready ? history[checkpointIndex] : null;
  const replayPoints = useMemo(
    () => (ready ? history.slice(checkpointIndex, checkpointIndex + HORIZON + 1) : []),
    [checkpointIndex, history, ready],
  );
  const budgetValue = Number(budget);
  const validBudget = Number.isFinite(budgetValue) && budgetValue > 0;
  const results = useMemo(() => {
    if (!ready || !validBudget) return [];
    return STRATEGIES.map((item) => simulate(item.key, replayPoints, budgetValue));
  }, [budgetValue, ready, replayPoints, validBudget]);
  const selectedResult = results.find((item) => item.key === strategy) ?? null;
  const bestResult = results.reduce<StrategyResult | null>(
    (best, item) => (!best || item.returnRate > best.returnRate ? item : best),
    null,
  );
  const worstResult = results.reduce<StrategyResult | null>(
    (worst, item) => (!worst || item.returnRate < worst.returnRate ? item : worst),
    null,
  );
  const resultSpread = bestResult && worstResult
    ? bestResult.returnRate - worstResult.returnRate
    : 0;
  const score = selectedResult && bestResult && worstResult
    ? resultSpread > 0
      ? Math.round(50 + ((selectedResult.returnRate - worstResult.returnRate) / resultSpread) * 50)
      : 50
    : 0;

  function chooseStrategy(key: StrategyKey) {
    setStrategy(key);
    setRevealed(false);
    setShareMessage("");
  }

  function reveal() {
    if (!strategy || !validBudget) return;
    setRevealed(true);
  }

  function nextChallenge() {
    if (!ready) return;
    const min = MIN_LOOKBACK;
    const span = Math.max(1, maxCheckpoint - min + 1);
    let next = min + Math.floor(Math.random() * span);
    if (span > 1 && next === checkpointIndex) next = min + ((next - min + 1) % span);
    setCheckpointIndex(next);
    setStrategy(null);
    setRevealed(false);
    setShareMessage("");
    setChallenge((value) => value + 1);
  }

  async function shareResult() {
    if (!selectedResult || !checkpoint) return;
    const text = `${name} 시장 타임머신 ${compactDate(checkpoint.date)} 도전\n${selectedResult.label}: ${signedPercent(selectedResult.returnRate)} · 최대낙폭 ${selectedResult.maxDrawdown.toFixed(2)}%\nStockPilot에서 과거 시세로 투자 결정을 연습해 보세요.`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "StockPilot 시장 타임머신", text, url: location.href });
      } else {
        await navigator.clipboard.writeText(text);
        setShareMessage("결과를 클립보드에 복사했어요.");
      }
    } catch {
      setShareMessage("공유를 취소했어요.");
    }
  }

  return (
    <section className={`replay-studio${expanded ? " is-open" : ""}`} aria-labelledby="replay-studio-title">
      <button
        type="button"
        className="replay-studio-head"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        <span className="replay-studio-icon"><RotateCcw size={19} /></span>
        <span className="replay-studio-copy">
          <small>HISTORICAL DECISION LAB</small>
          <b id="replay-studio-title">시장 타임머신</b>
          <em>과거의 한 순간으로 돌아가 내 투자 결정을 시험해 보세요</em>
        </span>
        <span className="replay-new"><Sparkles size={12} /> NEW</span>
        <ChevronDown className={expanded ? "replay-chevron open" : "replay-chevron"} size={18} />
      </button>

      {expanded && (
        <div className="replay-studio-body">
          {loading ? (
            <div className="replay-state"><RefreshCw className="spin" size={17} /> {name}의 과거 시세를 준비하고 있어요</div>
          ) : failed || !ready ? (
            <div className="replay-state">
              <CircleHelp size={18} />
              <span>이 종목은 아직 충분한 일별 시세가 없어 타임머신을 열 수 없어요.<small>KIS 일봉 데이터가 쌓이면 자동으로 다시 사용할 수 있어요.</small></span>
            </div>
          ) : (
            <>
              <div className="replay-meta">
                <span><CalendarClock size={14} /> 도전 #{challenge} · {name} · 최근 {history.length}거래일</span>
                <span className="replay-source">KIS 일별 종가 기반</span>
              </div>

              <div className="replay-checkpoint">
                <div className="replay-checkpoint-copy">
                  <span className="replay-kicker"><LockKeyhole size={13} /> 미래 데이터 잠금</span>
                  <b>{compactDate(checkpoint?.date || "")}의 장 마감</b>
                  <strong>{money(checkpoint?.close || 0, currency)}</strong>
                  <p>이 날 이후 10거래일의 결과를 보지 않고, 어떤 행동을 할지 먼저 선택해 보세요.</p>
                </div>
                <div className="replay-context-chart">
                  <MiniPath values={history.slice(Math.max(0, checkpointIndex - 5), checkpointIndex + 1).map((item) => item.close)} positive={(checkpoint?.close || 0) >= (history[Math.max(0, checkpointIndex - 5)]?.close || checkpoint?.close || 0)} />
                  <span>직전 5거래일 흐름</span>
                </div>
              </div>

              <div className="replay-controls">
                <label className="replay-budget">
                  <span>연습 가상자금</span>
                  <div><b>{currency === "KRW" ? "₩" : "$"}</b><input type="number" min="1" step={currency === "KRW" ? "1000" : "1"} value={budget} onChange={(event) => setBudget(event.target.value)} /></div>
                </label>
                <div className="replay-horizon"><span>검증 구간</span><b>10거래일</b><small>{compactDate(replayPoints[0]?.date || "")} → {compactDate(replayPoints.at(-1)?.date || "")}</small></div>
              </div>

              <div className="replay-strategy-grid" aria-label="투자 행동 선택">
                {STRATEGIES.map((item) => (
                  <button type="button" key={item.key} className={strategy === item.key ? "selected" : ""} onClick={() => chooseStrategy(item.key)} aria-pressed={strategy === item.key}>
                    <span className="replay-strategy-mark">{item.key === "LUMP_SUM" ? <Target size={17} /> : item.key === "SPLIT" ? <TrendingUp size={17} /> : <LockKeyhole size={17} />}</span>
                    <b>{item.label}</b>
                    <small>{item.description}</small>
                    <em>{item.detail}</em>
                  </button>
                ))}
              </div>

              <div className="replay-actions">
                <button type="button" className="replay-primary" disabled={!strategy || !validBudget} onClick={reveal}><Play size={15} /> 선택 확정하고 결과 보기</button>
                <button type="button" className="replay-secondary" onClick={nextChallenge}><RefreshCw size={14} /> 다른 시점</button>
              </div>

              {revealed && selectedResult && (
                <div className="replay-result" aria-live="polite">
                  <div className="replay-result-head">
                    <div><span><Trophy size={15} /> 결과 공개</span><b>{selectedResult.label}</b><small>실제 과거 가격 경로로 계산한 가상 결과</small></div>
                    <div className={`replay-result-rate ${selectedResult.returnRate >= 0 ? "positive" : "negative"}`}><strong>{signedPercent(selectedResult.returnRate)}</strong><small>{money(selectedResult.finalValue, currency)}</small></div>
                  </div>
                  <div className="replay-result-path"><MiniPath values={selectedResult.path} positive={selectedResult.returnRate >= 0} /><div><span>{compactDate(replayPoints[0]?.date || "")}</span><span>{compactDate(replayPoints.at(-1)?.date || "")}</span></div></div>
                  <div className="replay-score-row">
                    <div className="replay-score"><span>학습 점수</span><strong>{score}<small>/100</small></strong><p>수익률 하나만 평가하지 않고, 다른 선택지와의 차이를 함께 보여줘요.</p></div>
                    <div className="replay-result-metrics"><span><small>최대낙폭</small><b>{selectedResult.maxDrawdown.toFixed(2)}%</b></span><span><small>최고 하루</small><b className="positive">+{selectedResult.bestDay.toFixed(2)}%</b></span><span><small>최저 하루</small><b className="negative">{selectedResult.worstDay.toFixed(2)}%</b></span></div>
                  </div>
                  <div className="replay-comparison"><div className="replay-comparison-head"><span>같은 구간 다른 선택지</span><small>실제 과거 결과 비교</small></div>{results.map((item) => <div className={item.key === selectedResult.key ? "active" : ""} key={item.key}><span><b>{item.label}</b>{item.key === bestResult?.key && <em>가장 높음</em>}</span><strong className={item.returnRate >= 0 ? "positive" : "negative"}>{signedPercent(item.returnRate)}</strong><small>{money(item.finalValue, currency)}</small></div>)}</div>
                  <div className="replay-result-foot"><span><CircleHelp size={13} /> 과거 결과는 미래 수익을 예측하지 않아요. 이 기능은 타이밍과 리스크를 체험하기 위한 학습 도구입니다.</span><button type="button" onClick={() => void shareResult()}><Copy size={13} /> 결과 공유</button></div>
                  {shareMessage && <p className="replay-share-message">{shareMessage}</p>}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

