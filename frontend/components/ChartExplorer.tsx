"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CandlestickChart, LineChart, Maximize2, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";
import InteractiveChart from "./InteractiveChart";
import { chartPrice, type StockHistoryPoint, type StockChartMode } from "@/lib/stock-chart";
import { explorerSeriesData } from "@/lib/chart-explorer";

export default function ChartExplorer({ points, currency, symbol, name, initialDays, onDismiss }: {
  points: StockHistoryPoint[]; currency: "KRW" | "USD"; symbol: string; name: string; initialDays: number; onDismiss: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), close = useRef<HTMLButtonElement>(null), title = useId();
  const [days, setDays] = useState(initialDays), [mode, setMode] = useState<StockChartMode>("line"), [average, setAverage] = useState(false);
  const [inspected, setInspected] = useState(points.at(-1)?.date ?? "");
  const [zoom, setZoom] = useState<{ revision: number; action: "in" | "out" | "fit" }>({ revision: 0, action: "fit" });
  const data = explorerSeriesData(points, days), selected = data?.points.find(point => point.date === inspected) ?? data?.points.at(-1);
  useEffect(() => {
    const node = dialog.current, previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!node) return;
    const previousOverflow = document.body.style.overflow;
    node.showModal(); close.current?.focus(); document.body.style.overflow = "hidden";
    return () => { if (node.open) node.close(); document.body.style.overflow = previousOverflow; if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  function zoomChart(action: "in" | "out" | "fit") { setZoom(current => ({ revision: current.revision + 1, action })); }
  return <dialog className="chart-explorer" ref={dialog} aria-labelledby={title} onClose={() => { if (!dialog.current?.open) onDismiss(); }}>
    <header className="explorer-heading"><div><span><Maximize2 size={14} aria-hidden="true"/>확대 차트 · {symbol}</span><h2 id={title}>{name}</h2></div><button type="button" ref={close} aria-label="확대 차트 닫기" onClick={() => dialog.current?.close()}><X size={23} aria-hidden="true"/></button></header>
    <div className="explorer-toolbar"><div className="explorer-periods" aria-label="확대 차트 기간">{[[5,"1주"],[20,"1개월"],[60,"3개월"]].map(([value, label]) => <button type="button" key={value} aria-pressed={days === value} onClick={() => setDays(Number(value))}>{label}</button>)}</div><div className="explorer-modes" aria-label="확대 차트 형태"><button type="button" aria-pressed={mode === "line"} onClick={() => setMode("line")}><LineChart size={16}/>선</button><button type="button" disabled={!data?.canCandle} aria-pressed={mode === "candle" && !!data?.canCandle} onClick={() => setMode("candle")}><CandlestickChart size={16}/>일봉</button><button type="button" aria-pressed={average} disabled={points.length < 20} onClick={() => setAverage(value => !value)}>MA20</button></div><div className="explorer-zoom"><button type="button" aria-label="차트 확대" onClick={() => zoomChart("in")}><ZoomIn size={17}/></button><button type="button" aria-label="차트 축소" onClick={() => zoomChart("out")}><ZoomOut size={17}/></button><button type="button" onClick={() => zoomChart("fit")}><RotateCcw size={16}/>전체 기간</button></div></div>
    {data && selected ? <><div className="explorer-quote"><time>{selected.date}</time><strong>{chartPrice(selected.close,currency)}</strong><dl><div><dt>시가</dt><dd>{chartPrice(selected.open,currency)}</dd></div><div><dt>고가</dt><dd>{chartPrice(selected.high,currency)}</dd></div><div><dt>저가</dt><dd>{chartPrice(selected.low,currency)}</dd></div><div><dt>거래량</dt><dd>{selected.volume === null ? "—" : selected.volume.toLocaleString("ko-KR")+"주"}</dd></div></dl></div>
      <InteractiveChart points={points} days={days} mode={mode} average={average} currency={currency} name={name} selectedDate={selected.date} onInspect={setInspected} zoom={zoom}/>
      <label className="explorer-date">날짜 살펴보기<input type="range" aria-label="확대 차트 날짜 선택" min={0} max={data.points.length-1} value={data.points.findIndex(point=>point.date===selected.date)} aria-valuetext={`${selected.date}, 종가 ${chartPrice(selected.close,currency)}`} onChange={event => setInspected(data.points[Number(event.target.value)].date)}/></label>
    </> : <p role="status">이 기간은 기본 차트와 표에서 확인해 주세요.</p>}
    <footer className="explorer-footer"><span>일별 기록 · 드래그로 이동, 휠·두 손가락으로 확대 · 실시간 틱 차트 아님</span><a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">Charts by TradingView</a><a href="/licenses/lightweight-charts.txt" target="_blank" rel="noopener noreferrer">오픈소스 안내</a></footer>
  </dialog>;
}
