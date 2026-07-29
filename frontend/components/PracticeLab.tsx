"use client";

import {
  ArrowLeft,
  ArrowRight,
  BrainCircuit,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Currency = "KRW" | "USD";
type Preset = {
  symbol: string;
  name: string;
  market: "KR" | "US";
  currency: Currency;
  exchange: string;
};
type Candle = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};
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

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          symbol: preset.symbol,
          market: preset.market,
          exchange: preset.exchange,
        });
        const response = await fetch(`/api/features/history?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const body = response.ok ? await response.json() : { items: [] };
        if (controller.signal.aborted) return;
        setItems(body.items);
        setIndex(Math.min(9, Math.max(body.items.length - 1, 0)));
        setCash(preset.currency === "KRW" ? 10_000_000 : 10_000);
        setPosition(0);
        setAveragePrice(0);
        setTrades([]);
        setNotice("");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 0);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [preset]);

  const current = items[index];
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
    if (!current) return;
    const count = Math.max(1, Number(quantity) || 1);
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
        <Link className="practice-brand" href="/"><span><Sparkles size={18} /></span>StockPilot</Link>
        <nav><Link href="/"><ArrowLeft size={14} /> 가상투자</Link><b><BrainCircuit size={14} /> 시세 연습</b></nav>
      </header>

      <section className="practice-hero">
        <div><p>MARKET REPLAY</p><h1>미래를 가리고<br />투자를 연습해요</h1><span>과거 KIS 일별 시세를 하루씩 열어 보며 판단하는 학습 모드입니다.</span></div>
        <BrainCircuit size={68} />
      </section>

      <section className="practice-presets">
        {presets.map((item) => <button className={preset.symbol === item.symbol ? "active" : ""} key={item.symbol} onClick={() => setPreset(item)}><b>{item.name}</b><small>{item.symbol} · {item.market}</small></button>)}
      </section>

      {loading ? (
        <div className="practice-loading"><RefreshCw className="spin" size={20} /> 과거 시세를 준비하고 있어요</div>
      ) : !current ? (
        <div className="practice-loading">KIS에서 연습용 과거 시세를 불러오지 못했어요.</div>
      ) : (
        <section className="practice-grid">
          <div className="replay-market">
            <div className="replay-head">
              <span><small>현재 공개된 날짜</small><b>{current.date.slice(0, 4)}.{current.date.slice(4, 6)}.{current.date.slice(6, 8)}</b></span>
              <span><small>종가</small><strong>{money(current.close, preset.currency)}</strong></span>
            </div>
            <div className="replay-chart">
              <svg viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points={chartPoints} /></svg>
              <span>이후 가격은 아직 공개되지 않았어요</span>
            </div>
            <div className="ohlc">
              <span>시가 <b>{money(current.open, preset.currency)}</b></span>
              <span>고가 <b>{money(current.high, preset.currency)}</b></span>
              <span>저가 <b>{money(current.low, preset.currency)}</b></span>
              <span>거래량 <b>{new Intl.NumberFormat("ko-KR", { notation: "compact" }).format(current.volume)}</b></span>
            </div>
            <button className="next-day" disabled={finished} onClick={nextDay}>{finished ? "연습 종료" : "다음 거래일 공개"} <ArrowRight size={15} /></button>
          </div>

          <aside className="replay-account">
            <div className="replay-result">
              <small>연습 계좌 수익률</small>
              <strong className={returnRate >= 0 ? "positive" : "negative"}>{returnRate >= 0 ? "+" : ""}{returnRate.toFixed(2)}%</strong>
              <span>총자산 {money(equity, preset.currency)}</span>
            </div>
            <div className="replay-balance">
              <span><small>예수금</small><b>{money(cash, preset.currency)}</b></span>
              <span><small>보유 수량</small><b>{position}주</b></span>
              <span><small>평균 단가</small><b>{position ? money(averagePrice, preset.currency) : "—"}</b></span>
            </div>
            <label>연습 주문 수량<input type="number" min="1" max="10000" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
            <div className="replay-actions"><button onClick={() => trade("BUY")}>가상매수</button><button onClick={() => trade("SELL")}>가상매도</button></div>
            {notice && <p className="replay-notice">{notice}</p>}
            <button className="reset-replay" onClick={reset}><RotateCcw size={13} /> 처음부터 다시</button>
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
