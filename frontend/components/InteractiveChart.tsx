"use client";

import { useEffect, useRef, useState } from "react";
import type { IChartApi, ISeriesApi, MouseEventParams, Time } from "lightweight-charts";
import { RefreshCw } from "lucide-react";
import { explorerSeriesData, zoomExplorerRange } from "@/lib/chart-explorer";
import { chartPrice, type StockHistoryPoint, type StockChartMode } from "@/lib/stock-chart";

type Props = { points: StockHistoryPoint[]; days: number; mode: StockChartMode; average: boolean; currency: "KRW" | "USD"; name: string; selectedDate: string; onInspect: (date: string) => void; zoom: { revision: number; action: "in" | "out" | "fit" } };

export default function InteractiveChart(props: Props) {
  const host = useRef<HTMLDivElement>(null), chart = useRef<IChartApi | null>(null);
  const series = useRef<{ line: ISeriesApi<"Area">; candles: ISeriesApi<"Candlestick">; average: ISeriesApi<"Line">; volume: ISeriesApi<"Histogram"> } | null>(null);
  const latest = useRef(props), inspected = useRef("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { latest.current = props; });
  useEffect(() => {
    let disposed = false, resize: ResizeObserver | null = null, theme: MutationObserver | null = null;
    let onCrosshair: ((event: MouseEventParams<Time>) => void) | null = null;
    const node = host.current;
    if (!node) return;
    void import("lightweight-charts").then(lib => {
      if (disposed) return;
      const colors = () => {
        const css = getComputedStyle(node), read = (name: string) => css.getPropertyValue(name).trim();
        return { text: read("--ws-muted"), line: read("--ws-line"), up: read("--ws-up"), down: read("--ws-down"), brand: read("--ws-brand") };
      };
      const palette = colors();
      const api = lib.createChart(node, {
        autoSize: false, width: Math.max(1, node.clientWidth), height: Math.max(240, node.clientHeight),
        layout: { background: { type: lib.ColorType.Solid, color: "transparent" }, textColor: palette.text, fontSize: 12, fontFamily: '"StockPilot Pretendard", Pretendard, sans-serif', attributionLogo: true },
        grid: { vertLines: { visible: false }, horzLines: { color: palette.line, style: lib.LineStyle.Dotted } },
        rightPriceScale: { borderVisible: false, minimumWidth: 68 },
        timeScale: { borderVisible: false, rightOffset: 1, timeVisible: false, fixLeftEdge: true, fixRightEdge: true },
        crosshair: { mode: lib.CrosshairMode.Normal, vertLine: { color: palette.brand, labelBackgroundColor: "#5262db" }, horzLine: { color: palette.brand, labelBackgroundColor: "#5262db" } },
        handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
        handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true, axisDoubleClickReset: true },
        localization: { locale: "ko-KR", priceFormatter: (value: number) => chartPrice(value, latest.current.currency) },
      });
      chart.current = api;
      // The exact inspected price stays above the chart. Avoid a low-contrast
      // duplicate price badge on the bright Korean movement colors.
      const common = { priceLineVisible: false, lastValueVisible: false };
      const line = api.addSeries(lib.AreaSeries, { ...common, lineColor: palette.up, topColor: "rgba(207,53,83,.16)", bottomColor: "rgba(207,53,83,0)", lineWidth: 2 });
      const candles = api.addSeries(lib.CandlestickSeries, { ...common, upColor: palette.up, downColor: palette.down, borderVisible: false, wickUpColor: palette.up, wickDownColor: palette.down, visible: false });
      const average = api.addSeries(lib.LineSeries, { ...common, color: palette.brand, lineWidth: 1, lineStyle: lib.LineStyle.Dashed, lastValueVisible: false, visible: false });
      const volume = api.addSeries(lib.HistogramSeries, { priceFormat: { type: "custom", minMove: 1, formatter: (value: number) => `${value.toLocaleString("ko-KR", { maximumFractionDigits: 0 })}주` }, priceLineVisible: false, lastValueVisible: false }, 1);
      series.current = { line, candles, average, volume };
      api.panes()[1]?.setHeight(84);
      const draw = (fit: boolean) => {
        const current = latest.current, data = explorerSeriesData(current.points, current.days);
        if (!data) return;
        const p = colors(), positive = data.points.at(-1)!.close >= data.points[0].close;
        line.applyOptions({ visible: current.mode !== "candle" || !data.canCandle, lineColor: positive ? p.up : p.down, topColor: positive ? "rgba(207,53,83,.16)" : "rgba(39,99,206,.16)", bottomColor: "rgba(0,0,0,0)" });
        candles.applyOptions({ visible: current.mode === "candle" && data.canCandle, upColor: p.up, downColor: p.down, wickUpColor: p.up, wickDownColor: p.down });
        average.applyOptions({ visible: current.average, color: p.brand });
        line.setData(data.line); candles.setData(data.candles); average.setData(data.average);
        volume.setData(data.volume.map(point => "value" in point ? { time: point.time, value: point.value!, color: point.up ? p.up + "70" : p.down + "70" } : { time: point.time }));
        if (fit) api.timeScale().fitContent();
      };
      draw(true);
      // Keep the chart instance/inspection stable across mode and theme changes.
      onCrosshair = event => {
        const time = event.time;
        const date = typeof time === "string" ? time : time && typeof time === "object" ? `${time.year}-${String(time.month).padStart(2,"0")}-${String(time.day).padStart(2,"0")}` : "";
        if (date && date !== inspected.current && latest.current.points.some(point => point.date === date)) { inspected.current = date; latest.current.onInspect(date); }
      };
      api.subscribeCrosshairMove(onCrosshair);
      resize = new ResizeObserver(() => { if (!disposed) api.resize(Math.max(1, node.clientWidth), Math.max(240, node.clientHeight)); });
      resize.observe(node);
      theme = new MutationObserver(() => { const p = colors(); api.applyOptions({ layout: { textColor: p.text }, grid: { horzLines: { color: p.line } } }); draw(false); });
      theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      setState("ready");
    }).catch(() => { if (!disposed) setState("error"); });
    return () => {
      disposed = true; resize?.disconnect(); theme?.disconnect();
      if (chart.current && onCrosshair) chart.current.unsubscribeCrosshairMove(onCrosshair);
      chart.current?.remove(); chart.current = null; series.current = null;
    };
  }, [attempt]);
  useEffect(() => {
    const api = chart.current, s = series.current, data = explorerSeriesData(props.points, props.days);
    if (!api || !s || !data || state !== "ready") return;
    const css = getComputedStyle(host.current!), up = css.getPropertyValue("--ws-up").trim(), down = css.getPropertyValue("--ws-down").trim();
    const positive = data.points.at(-1)!.close >= data.points[0].close;
    s.line.applyOptions({ visible: props.mode !== "candle" || !data.canCandle, lineColor: positive ? up : down, topColor: positive ? "rgba(207,53,83,.16)" : "rgba(39,99,206,.16)" });
    s.candles.applyOptions({ visible: props.mode === "candle" && data.canCandle });
    s.average.applyOptions({ visible: props.average });
    s.line.setData(data.line); s.candles.setData(data.candles); s.average.setData(data.average);
    s.volume.setData(data.volume.map(point => "value" in point ? { time: point.time, value: point.value!, color: point.up ? up + "70" : down + "70" } : { time: point.time }));
  }, [props.points, props.days, props.mode, props.average, state]);
  useEffect(() => { if (state === "ready") chart.current?.timeScale().fitContent(); }, [props.points, props.days, state]);
  useEffect(() => {
    const api = chart.current, data = explorerSeriesData(latest.current.points, latest.current.days);
    if (!api || !data) return;
    if (props.zoom.action === "fit") api.timeScale().fitContent();
    else { const range = zoomExplorerRange(api.timeScale().getVisibleLogicalRange(), data.calendar.length, props.zoom.action); if (range) api.timeScale().setVisibleLogicalRange(range); }
  }, [props.zoom]);
  useEffect(() => {
    const point = props.points.find(item => item.date === props.selectedDate), s = series.current;
    if (point && s && chart.current && inspected.current !== point.date) {
      inspected.current = point.date;
      chart.current.setCrosshairPosition(point.close, point.date, props.mode === "candle" ? s.candles : s.line);
    }
  }, [props.selectedDate, props.points, props.mode]);
  return <div className="interactive-chart-area">
    <div className="interactive-chart-host" ref={host} role="img" aria-label={`${props.name} 확대 차트. 날짜 조절과 표는 기본 차트에서도 이용할 수 있어요.`}/>
    {state === "loading" ? <div className="interactive-chart-status" role="status"><RefreshCw className="spin" size={20}/>차트를 준비하고 있어요.</div> : state === "error" ? <div className="interactive-chart-status" role="alert"><p>확대 차트를 불러오지 못했어요. 창을 닫아 기본 차트와 표를 이용할 수 있어요.</p><button type="button" onClick={() => { setState("loading"); setAttempt(value => value + 1); }}>다시 불러오기</button></div> : null}
  </div>;
}
