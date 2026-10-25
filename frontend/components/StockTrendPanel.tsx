"use client";

import { BarChart3, CandlestickChart, LineChart, RefreshCw } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { requestJson } from "@/lib/reliable-request";
import { buildStockChart, chartDate, chartPrice, nearestChartPoint, parseStockHistory, type ChartIdentity, type StockChartMode, type StockHistory } from "@/lib/stock-chart";

const PERIODS = [{ label: "1주", days: 5 }, { label: "1개월", days: 20 }, { label: "3개월", days: 60 }] as const;
export default function StockTrendPanel({ symbol, name, market, exchange, currency }: ChartIdentity & { name: string }) {
  const unique = useId(), titleId = `${unique}-title`, helpId = `${unique}-help`;
  const identityKey = `${market}:${exchange}:${symbol}:${currency}`;
  const [state, setState] = useState<{ key: string; history: StockHistory | null; error: string; pending: boolean }>({ key: "", history: null, error: "", pending: true });
  const [days, setDays] = useState<number>(20);
  const [mode, setMode] = useState<StockChartMode>("line");
  const [inspected, setInspected] = useState<{ key: string; date: string } | null>(null);
  const [showAverage, setShowAverage] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    // Reset the read state for this exact instrument; never show another symbol's chart.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ key: identityKey, history: null, error: "", pending: true });
    const query = new URLSearchParams({ symbol, market, exchange });
    void requestJson<unknown>(`/api/features/history?${query}`, { cache: "no-store", signal: controller.signal })
      .then(body => {
        const history = parseStockHistory(body, { symbol, market, exchange, currency });
        if (!controller.signal.aborted) setState({ key: identityKey, history, error: "", pending: false });
      }).catch(reason => {
        if (!controller.signal.aborted) setState({ key: identityKey, history: null, error: reason instanceof Error ? reason.message : "가격 흐름을 불러오지 못했어요.", pending: false });
      });
    return () => controller.abort();
  }, [identityKey, symbol, market, exchange, currency, revision]);
  const history = state.key === identityKey ? state.history : null;
  const chart = useMemo(() => buildStockChart(history?.points ?? [], days, mode, showAverage), [history, days, mode, showAverage]);
  const selectedIndex = chart ? Math.max(0, chart.points.findIndex(point => inspected?.key === identityKey && point.date === inspected.date)) : 0;
  const hasInspected = chart?.points.some(point => inspected?.key === identityKey && point.date === inspected.date);
  const activeIndex = chart ? hasInspected ? selectedIndex : chart.points.length - 1 : 0;
  const active = chart?.points[activeIndex];
  const pending = state.key !== identityKey || state.pending;
  const retry = () => setRevision(value => value + 1);
  function inspect(index: number) {
    if (!chart) return;
    const date = chart.points[Math.max(0, Math.min(chart.points.length - 1, index))].date;
    setInspected(previous => previous?.key === identityKey && previous.date === date ? previous : { key: identityKey, date });
  }
  return <section className="stock-trend-panel broker-chart" aria-labelledby={titleId}>
    <div className="stock-trend-head"><div><h2 id={titleId}><BarChart3 size={19} aria-hidden="true"/>{name} 차트</h2><p>일별 시세 · {currency === "USD" ? "미국 달러" : "원화"}</p></div>
      <div className="trend-periods" aria-label="차트 조회 기간">{PERIODS.map(period => <button key={period.days} type="button" className={days === period.days ? "active" : ""} aria-pressed={days === period.days} onClick={() => setDays(period.days)}>{period.label}</button>)}</div>
    </div>
    {pending ? <div className="broker-chart-state" role="status"><RefreshCw size={19} aria-hidden="true"/><p>가격 흐름을 불러오고 있어요.</p></div> : state.error ? <div className="broker-chart-state" role="alert"><p>{state.error}</p><button type="button" onClick={retry}><RefreshCw size={16} aria-hidden="true"/>다시 조회</button></div> : !chart || !active ? <div className="broker-chart-state"><p>아직 표시할 일별 시세가 없어요.</p><button type="button" onClick={retry}>다시 조회</button></div> : <div className="stock-trend-body">
      <div className="broker-chart-toolbar"><div className="broker-chart-modes" aria-label="차트 형태">
        <button type="button" aria-pressed={chart.mode === "line"} onClick={() => setMode("line")}><LineChart size={16} aria-hidden="true"/>선</button>
        <button type="button" aria-pressed={chart.mode === "candle"} disabled={!chart.canCandle} onClick={() => setMode("candle")}><CandlestickChart size={16} aria-hidden="true"/>일봉</button>
        <button type="button" aria-pressed={showAverage} disabled={!chart.averageAvailable} onClick={() => setShowAverage(value => !value)}>MA20</button>
      </div><button type="button" className="broker-chart-reload" aria-label="일별 시세 새로고침" onClick={retry}><RefreshCw size={17} aria-hidden="true"/></button></div>
      <div className="broker-chart-period"><span>{chart.points[0].date} — {chart.points.at(-1)!.date} · {chart.points.length}개 일별 기록</span><b data-sign={chart.changePercent === null || chart.changePercent === 0 ? "flat" : chart.changePercent > 0 ? "up" : "down"}>{chart.changePercent === null ? "기간 비교 준비 중" : `${chart.changePercent > 0 ? "+" : ""}${chart.changePercent.toFixed(2)}%`}<small> 첫날 종가 대비</small></b></div>
      {!chart.canCandle && <p className="broker-chart-note">일부 시가·고가·저가를 확인할 수 없어 종가 선으로 표시해요.</p>}
      {chart.points.some(point => point.volume === null) && <p className="broker-chart-note">거래량 자료가 없는 날은 막대를 그리지 않아요. 확인된 거래량 0과는 달라요.</p>}
      <div className="broker-chart-inspection"><time dateTime={active.date}>{active.date}</time><dl>
        {([['시가',active.open],['고가',active.high],['저가',active.low],['종가',active.close]] as const).map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{chartPrice(value,currency)}</dd></div>)}
        <div><dt>거래량</dt><dd>{active.volume === null ? "자료 없음" : `${active.volume.toLocaleString("ko-KR")}주`}</dd></div>
      </dl></div>
      <div className="broker-chart-canvas">
        <svg className="broker-chart-svg" viewBox={`0 0 ${chart.width} ${chart.height}`} preserveAspectRatio="none" role="img" aria-label={`${name} ${chart.mode === "candle" ? "일봉" : "종가 선"}과 거래량 그래프. ${chart.points[0].date}부터 ${chart.points.at(-1)!.date}까지.`} aria-describedby={helpId}
          onPointerMove={event => { if (event.pointerType !== "mouse") return; const rect = event.currentTarget.getBoundingClientRect(); if(rect.width) inspect(nearestChartPoint(chart.coords, (event.clientX - rect.left) / rect.width * chart.width)); }}
          onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); if(rect.width) inspect(nearestChartPoint(chart.coords, (event.clientX - rect.left) / rect.width * chart.width)); }}>
          {[0,.5,1].map(ratio => <line key={ratio} x1={0} x2={chart.width} y1={chart.priceTop+(chart.priceBottom-chart.priceTop)*ratio} y2={chart.priceTop+(chart.priceBottom-chart.priceTop)*ratio} className="broker-chart-grid"/>)}
          {chart.mode === "line" ? <><path d={chart.line} className="broker-chart-line" data-sign={chart.changePercent === null || chart.changePercent === 0 ? "flat" : chart.changePercent > 0 ? "up" : "down"}/>{chart.points.length === 1 && <circle cx={chart.coords[0].x} cy={chart.coords[0].y} r={3} fill="var(--ws-brand)"/>}</> : chart.candles.map((candle,index) => candle && <g key={chart.points[index].date} data-sign={candle.sign} className="broker-chart-candle"><line x1={candle.x} x2={candle.x} y1={candle.high} y2={candle.low}/><rect x={candle.x-chart.barWidth/2} y={candle.top} width={chart.barWidth} height={Math.max(1,candle.bottom-candle.top)}/></g>)}
          {showAverage && chart.averageAvailable && <path d={chart.averagePath} className="broker-chart-average"/>}
          <line x1={0} x2={chart.width} y1={chart.volumeTop-8} y2={chart.volumeTop-8} className="broker-chart-grid"/>
          {chart.points.map((point,index) => point.volume !== null && point.volume > 0 && <rect key={point.date} className="broker-chart-volume" data-selected={index === activeIndex} x={chart.coords[index].x-chart.barWidth/2} y={chart.volumeBottom-point.volume/(chart.maxVolume||1)*(chart.volumeBottom-chart.volumeTop)} width={chart.barWidth} height={point.volume/(chart.maxVolume||1)*(chart.volumeBottom-chart.volumeTop)}/>)}
          <line x1={chart.coords[activeIndex].x} x2={chart.coords[activeIndex].x} y1={chart.priceTop} y2={chart.volumeBottom} className="broker-chart-crosshair"/>
          {chart.mode === "line" && <circle cx={chart.coords[activeIndex].x} cy={chart.coords[activeIndex].y} r={3} fill="var(--ws-brand)"/>}
        </svg>
        <div className="broker-chart-scale" aria-hidden="true"><span>{chartPrice(chart.scaleMax,currency)}</span><span>{chartPrice(chart.scaleMin,currency)}</span><small>거래량</small></div>
      </div>
      <div className="broker-chart-axis"><span>{chartDate(chart.points[0].date)}</span><span>{chartDate(chart.points.at(-1)!.date)}</span></div>
      <label className="broker-chart-scrubber">날짜 살펴보기<input type="range" min={0} max={chart.points.length-1} value={activeIndex} aria-label="차트 날짜 선택" aria-valuetext={`${active.date}, 종가 ${chartPrice(active.close,currency)}, 거래량 ${active.volume === null ? "자료 없음" : active.volume.toLocaleString("ko-KR")+"주"}`} onChange={event => inspect(Number(event.target.value))}/></label>
      <p id={helpId} className="broker-chart-note">그래프를 누르거나 날짜 조절 막대의 좌우 키로 살펴보세요. MA20은 일별 종가 20개 평균이에요.{showAverage ? " 점선은 MA20이에요." : ""} 시세는 거래일 기준으로 표시하며 실시간 틱 차트가 아니에요.</p>
      <details className="broker-chart-table"><summary>가격·거래량 표로 보기</summary><div role="region" aria-label="일별 가격과 거래량" tabIndex={0}><table><caption>{name} · {currency} · {chart.points.length}개 일별 기록</caption><thead><tr><th scope="col">거래일</th><th scope="col">시가</th><th scope="col">고가</th><th scope="col">저가</th><th scope="col">종가</th><th scope="col">거래량(주)</th></tr></thead><tbody>{chart.points.map(point => <tr key={point.date}><th scope="row"><time dateTime={point.date}>{point.date}</time></th><td>{chartPrice(point.open,currency)}</td><td>{chartPrice(point.high,currency)}</td><td>{chartPrice(point.low,currency)}</td><td>{chartPrice(point.close,currency)}</td><td>{point.volume === null ? "자료 없음" : point.volume.toLocaleString("ko-KR")}</td></tr>)}</tbody></table></div></details>
    </div>}
  </section>;
}
