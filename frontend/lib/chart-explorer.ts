import type { StockHistoryPoint } from "./stock-chart";

/** Calendar whitespace is intentional: no invented close, candle or volume. */
export function explorerSeriesData(history: StockHistoryPoint[], days: number) {
  const points = history.slice(-days);
  if (!points.length) return null;
  const first = Date.parse(`${points[0].date}T00:00:00Z`), last = Date.parse(`${points.at(-1)!.date}T00:00:00Z`);
  const span = (last - first) / 86_400_000;
  if (!Number.isInteger(span) || span < 0 || span > 366) return null;
  const byDate = new Map(points.map(point => [point.date, point]));
  const calendar = Array.from({ length: span + 1 }, (_, index) => new Date(first + index * 86_400_000).toISOString().slice(0, 10));
  const average = new Map(history.map((point, index) => [point.date, index < 19 ? null : history.slice(index - 19, index + 1).reduce((sum, item) => sum + item.close, 0) / 20]));
  const canCandle = points.every(point => point.candleValid);
  return {
    points, calendar, canCandle,
    line: calendar.map(time => { const point = byDate.get(time); return point ? { time, value: point.close } : { time }; }),
    candles: calendar.map(time => { const point = byDate.get(time); return point?.candleValid ? { time, open: point.open!, high: point.high!, low: point.low!, close: point.close } : { time }; }),
    volume: calendar.map(time => { const point = byDate.get(time); return point?.volume !== null && point?.volume !== undefined ? { time, value: point.volume, up: point.close >= (point.open ?? point.close) } : { time }; }),
    average: calendar.map(time => { const value = average.get(time); return value !== null && value !== undefined ? { time, value } : { time }; }),
  };
}

export function zoomExplorerRange(range: { from: number; to: number } | null, total: number, direction: "in" | "out") {
  if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to) || range.to <= range.from || !Number.isInteger(total) || total < 1) return null;
  const width = Math.max(Math.min(5, total), Math.min(total + 2, (range.to - range.from) * (direction === "in" ? .65 : 1.5)));
  const center = (range.to + range.from) / 2;
  const from = Math.max(-1, Math.min(total + 1 - width, center - width / 2));
  return { from, to: from + width };
}
