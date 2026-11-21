"use client";

import {
  ArrowLeft,
  ArrowRight,
  ChartNoAxesColumnIncreasing,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { requestJson } from "@/lib/reliable-request";
import { parseStockHistory, type StockHistoryPoint } from "@/lib/stock-chart";
import { practiceQuantity } from "@/lib/practice-validation";

type Currency = "KRW" | "USD";
type Preset = {
  symbol: string;
  name: string;
  market: "KR" | "US";
  currency: Currency;
  exchange: string;
};
type Candle = StockHistoryPoint;
type Trade = {
  side: "BUY" | "SELL";
  date: string;
  price: number;
  quantity: number;
};

const presets: Preset[] = [
  { symbol: "005930", name: "삼성전자", market: "KR", currency: "KRW", exchange: "KRX" },
  { symbol: "000660", name: "SK하이닉스", market: "KR", currency: "KRW", exchange: "KRX" },
  { symbol: "AAPL", name: "Apple", market: "US", currency: "USD", exchange: "NAS" },
  { symbol: "TSLA", name: "Tesla", market: "US", currency: "USD", exchange: "NAS" },
];

const money = (value: number, currency: Currency) =>
  new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "KRW" ? 0 : 2,
  }).format(value);

export default function PracticeLab() {
  const [preset, setPreset] = useState(presets[0]);
  const [items, setItems] = useState<Candle[]>([]);
  const [index, setIndex] = useState(9);
  const [cash, setCash] = useState(10_000_000);
  const [position, setPosition] = useState(0);
  const [averagePrice, setAveragePrice] = useState(0);
  const [quantity, setQuantity] = useState("1");
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [loadedPreset, setLoadedPreset] = useState("");
  const presetId = `${preset.market}:${preset.exchange}:${preset.symbol}`;

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setLoadError("");
      try {
        const params = new URLSearchParams({
          symbol: preset.symbol,
          market: preset.market,
          exchange: preset.exchange,
        });
        const body = await requestJson<unknown>(`/api/features/history?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const history = parseStockHistory(body, preset);
        if (controller.signal.aborted) return;
        setItems(history.points);
        setIndex(Math.min(9, Math.max(history.points.length - 1, 0)));
        setCash(preset.currency === "KRW" ? 10_000_000 : 10_000);
        setPosition(0);
        setAveragePrice(0);
        setTrades([]);
        setNotice("");
      } catch (reason) {
        if (!controller.signal.aborted) {
          setItems([]);
          setLoadError(reason instanceof Error ? reason.message : "과거 시세를 불러오지 못했어요.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoadedPreset(presetId);
          setLoading(false);
        }
      }
    }, 0);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [preset, presetId, attempt]);

  const pending = loading || loadedPreset !== presetId;
  const current = pending ? undefined : items[index];
  const visible = useMemo(() => items.slice(0, index + 1), [items, index]);
  const chartPoints = useMemo(() => {
    if (!visible.length) return "";
    const values = visible.map((item) => item.close);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const spread = max - min || 1;
    return values.map((value, pointIndex) => {
      const x = values.length === 1 ? 0 : (pointIndex / (values.length - 1)) * 100;
      const y = 88 - ((value - min) / spread) * 72;
      return `${x},${y}`;
    }).join(" ");
  }, [visible]);
  const initialCash = preset.currency === "KRW" ? 10_000_000 : 10_000;
  const equity = cash + position * (current?.close || 0);
  const returnRate = (equity / initialCash - 1) * 100;
  const finished = Boolean(items.length && index >= items.length - 1);

  function trade(side: "BUY" | "SELL") {
    if (!current || pending) return;
    const count = practiceQuantity(quantity);
    if (count === null) {
      setNotice("수량은 1주부터 10,000주까지 정수로 입력해 주세요.");
      return;
    }
    const total = current.close * count;
    const fee = total * 0.00015;
    const tax = side === "SELL" && preset.currency === "KRW" ? total * 0.002 : 0;
    if (side === "BUY") {
      if (cash < total + fee) {
        setNotice("연습 예수금이 부족해요.");
        return;
      }
      const oldValue = position * averagePrice;
      setCash(cash - total - fee);
      setPosition(position + count);
      setAveragePrice((oldValue + total + fee) / (position + count));
    } else {
      if (position < count) {
        setNotice("보유 수량보다 많이 팔 수 없어요.");
        return;
      }
      setCash(cash + total - fee - tax);
      setPosition(position - count);
      if (position === count) setAveragePrice(0);
    }
    setTrades((currentTrades) => [
      { side, date: current.date, price: current.close, quantity: count },
      ...currentTrades,
    ]);
    setNotice(`${side === "BUY" ? "매수" : "매도"} 연습 주문이 체결됐어요.`);
  }

  function nextDay() {
    if (!finished) {
      setIndex((value) => Math.min(value + 1, items.length - 1));
      setNotice("");
    }
  }

  function reset() {
    setIndex(Math.min(9, Math.max(items.length - 1, 0)));
    setCash(initialCash);
    setPosition(0);
    setAveragePrice(0);
    setTrades([]);
    setNotice("");
  }

  return (
    <main className="practice-app">
      <header className="practice-topbar">
        <Link className="practice-brand" href="/"><span><ChartNoAxesColumnIncreasing size={18} aria-hidden="true" /></span>StockPilot</Link>
        <Link className="practice-market-link" href="/"><ArrowLeft size={16} aria-hidden="true" /> 시장으로</Link>
      </header>

      <section className="practice-hero">
        <div>
          <p>과거 시세 연습</p>
          <h1>하루씩 열어보고<br />내 판단을 확인해요</h1>
          <span>그날의 종가를 보고 매수하거나 기다려 보세요. 다음 거래일 가격은 선택한 뒤 확인할 수 있어요.</span>
          <span className="practice-session-note">로그인 없이 이용해요. 이 화면을 나가면 연습 기록이 저장되지 않아요.</span>
        </div>
      </section>

      <section className="practice-presets" aria-label="연습 종목 선택">
        {presets.map((item) => <button type="button" className={preset.symbol === item.symbol ? "active" : ""} aria-pressed={preset.symbol === item.symbol} key={item.symbol} onClick={() => setPreset(item)}><b>{item.name}</b><small>{item.symbol} · {item.market}</small></button>)}
      </section>

      {pending ? (
        <div className="practice-loading" role="status"><RefreshCw className="spin" size={20} aria-hidden="true" /> 과거 시세를 준비하고 있어요</div>
      ) : !current ? (
        <div className="practice-loading">
          <p role={loadError ? "alert" : "status"}>{loadError || "이 종목의 과거 시세가 아직 없어요."}</p>
          <div className="practice-recovery-actions">
            <button type="button" className="reset-replay" onClick={() => setAttempt(value => value + 1)}>다시 불러오기</button>
            <Link href="/">시장으로 돌아가기</Link>
          </div>
        </div>
      ) : (
        <section className="practice-grid">
          <div className="replay-market">
            <div className="replay-head">
              <span><small>현재 공개된 날짜</small><b><time dateTime={current.date} aria-live="polite">{current.date.replaceAll("-", ".")}</time></b></span>
              <span><small>종가</small><strong>{money(current.close, preset.currency)}</strong></span>
            </div>
            <div className="replay-chart">
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points={chartPoints} /></svg>
              <span>{finished ? "마지막 거래일까지 확인했어요" : "이후 가격은 아직 공개되지 않았어요"}</span>
            </div>
            <div className="ohlc">
              <span>시가 <b>{current.open === null ? "—" : money(current.open, preset.currency)}</b></span>
              <span>고가 <b>{current.high === null ? "—" : money(current.high, preset.currency)}</b></span>
              <span>저가 <b>{current.low === null ? "—" : money(current.low, preset.currency)}</b></span>
              <span>거래량 <b>{current.volume === null ? "—" : new Intl.NumberFormat("ko-KR", { notation: "compact" }).format(current.volume)}</b></span>
            </div>
          </div>

          <aside className="replay-account">
            <div className="replay-result">
              <small>이번 연습의 수익률</small>
              <strong className={returnRate >= 0 ? "positive" : "negative"}>{returnRate >= 0 ? "+" : ""}{returnRate.toFixed(2)}%</strong>
              <span>총자산 {money(equity, preset.currency)}</span>
            </div>
            <div className="replay-balance">
              <span><small>남은 연습 자금</small><b>{money(cash, preset.currency)}</b></span>
              <span><small>보유 수량</small><b>{position}주</b></span>
              <span><small>평균 단가</small><b>{position ? money(averagePrice, preset.currency) : "—"}</b></span>
            </div>
            <label>연습 주문 수량<input type="number" min="1" max="10000" step="1" inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
            <div className="replay-actions"><button type="button" onClick={() => trade("BUY")}>연습 매수</button><button type="button" onClick={() => trade("SELL")}>연습 매도</button></div>
            {notice && <p className="replay-notice" role="status">{notice}</p>}
            <div className="practice-advance">
              {finished ? <p role="status">여기까지가 불러온 과거 시세예요.</p> : <p>거래하지 않고 다음 날을 볼 수도 있어요.</p>}
              <button type="button" className="next-day" disabled={finished} onClick={nextDay}>{finished ? "마지막 거래일" : "다음 거래일 공개"} <ArrowRight size={15} aria-hidden="true" /></button>
            </div>
            <button type="button" className="reset-replay" onClick={reset}><RotateCcw size={13} aria-hidden="true" /> 처음부터 다시</button>
            <div className="replay-trades">
              <b>연습 거래 기록</b>
              {trades.slice(0, 6).map((item, tradeIndex) => <span key={`${item.date}:${tradeIndex}`}><em>{item.side === "BUY" ? "매수" : "매도"}</em>{item.quantity}주<small>{money(item.price, preset.currency)}</small></span>)}
              {!trades.length && <p>아직 거래 기록이 없어요.</p>}
            </div>
          </aside>
        </section>
      )}

      <footer className="practice-footer"><ShieldCheck size={15} /> 과거 시세를 사용하는 학습 기능이며 실제 주문이나 투자 권유가 아닙니다.</footer>
    </main>
  );
}
