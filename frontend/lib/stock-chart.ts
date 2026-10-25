export type ChartIdentity = { symbol: string; market: "KR" | "US"; exchange: string; currency: "KRW" | "USD" };
export type StockHistoryPoint = { date: string; close: number; open: number | null; high: number | null; low: number | null; volume: number | null; candleValid: boolean };
export type StockHistory = { points: StockHistoryPoint[]; source: string | null };
export type StockChartMode = "line" | "candle";
const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER;
export function normalizeChartDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const date = new Date(`${normalized}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === normalized ? normalized : null;
}
export function parseStockHistory(value: unknown, identity: ChartIdentity): StockHistory {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("가격 기록 응답을 확인하지 못했어요.");
  const body = value as Record<string, unknown>;
  if (!Object.entries(identity).every(([key, expected]) => body[key] === expected) || !Array.isArray(body.items) || body.items.length > 80) throw new Error("선택한 종목의 가격 기록을 확인하지 못했어요.");
  const dates = new Set<string>();
  const points = body.items.map((raw: unknown): StockHistoryPoint => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("가격 기록의 형식이 올바르지 않아요.");
    const item = raw as Record<string, unknown>, date = normalizeChartDate(item.date);
    if (!date || dates.has(date) || !positive(item.close)) throw new Error("가격 기록의 날짜나 종가를 확인하지 못했어요.");
    dates.add(date);
    const valid = positive(item.open) && positive(item.high) && positive(item.low) && item.high >= Math.max(item.open, item.close) && item.low <= Math.min(item.open, item.close) && item.low <= item.high;
    return { date, close: item.close, open: valid ? item.open as number : null, high: valid ? item.high as number : null, low: valid ? item.low as number : null, candleValid: valid,
      volume: typeof item.volume === "number" && Number.isSafeInteger(item.volume) && item.volume >= 0 ? item.volume : null };
  }).sort((a, b) => a.date.localeCompare(b.date));
  return { points, source: typeof body.source === "string" && body.source.length <= 200 ? body.source : null };
}
export const chartPrice = (value: number | null, currency: ChartIdentity["currency"]) => value === null ? "—" : new Intl.NumberFormat("ko-KR", { style: "currency", currency, maximumFractionDigits: 4 }).format(value);
export const chartDate = (date: string) => `${Number(date.slice(5, 7))}.${Number(date.slice(8, 10))}`;
export function buildStockChart(history: StockHistoryPoint[], days: number, mode: StockChartMode, showAverage: boolean) {
  const points = history.slice(-days);
  if (!points.length) return null;
  const width = 820, height = 284, priceTop = 10, priceBottom = 202, volumeTop = 226, volumeBottom = 274, pad = 10;
  const canCandle = points.every(point => point.candleValid);
  const effectiveMode: StockChartMode = mode === "candle" && canCandle ? "candle" : "line";
  const averages = points.map(point => {
    const index = history.findIndex(item => item.date === point.date);
    return index < 19 ? null : history.slice(index - 19, index + 1).reduce((sum, item) => sum + item.close, 0) / 20;
  });
  const allHighs = points.map(point => effectiveMode === "candle" ? point.high! : point.close);
  const allLows = points.map(point => effectiveMode === "candle" ? point.low! : point.close);
  const scaleValues = [...allHighs, ...allLows, ...(showAverage ? averages.filter((value): value is number => value !== null) : [])];
  const low = Math.min(...scaleValues), high = Math.max(...scaleValues), margin = (high - low || high * .01) * .12;
  const scaleMin = Math.max(0, low - margin), scaleMax = high + margin, span = scaleMax - scaleMin || 1;
  const timestamps = points.map(point => Date.parse(`${point.date}T00:00:00Z`));
  const first = timestamps[0], elapsed = timestamps.at(-1)! - first;
  const coords = points.map((point, index) => ({ x: elapsed ? pad + (timestamps[index] - first) / elapsed * (width - pad * 2) : width / 2, y: priceTop + (scaleMax - point.close) / span * (priceBottom - priceTop) }));
  const y = (value: number) => priceTop + (scaleMax - value) / span * (priceBottom - priceTop);
  const line = coords.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
  let drawing = false;
  const averagePath = averages.map((value, index) => { if (value === null) { drawing = false; return ""; } const command = drawing ? "L" : "M"; drawing = true; return `${command}${coords[index].x.toFixed(2)} ${y(value).toFixed(2)}`; }).join(" ");
  const minGap = coords.length > 1 ? Math.min(...coords.slice(1).map((point, index) => point.x - coords[index].x)) : 24;
  const barWidth = Math.max(2, Math.min(18, minGap * .6));
  const maxVolume = Math.max(0, ...points.map(point => point.volume ?? 0));
  const candles = points.map((point, index) => point.candleValid ? { x: coords[index].x, top: y(Math.max(point.open!, point.close)), bottom: y(Math.min(point.open!, point.close)), high: y(point.high!), low: y(point.low!), sign: point.close === point.open ? "flat" : point.close > point.open! ? "up" : "down" } : null);
  const change = points.length > 1 ? (points.at(-1)!.close - points[0].close) / points[0].close * 100 : null;
  return { points, coords, candles, barWidth, width, height, priceTop, priceBottom, volumeTop, volumeBottom, maxVolume, scaleMin, scaleMax, line, averagePath, canCandle, mode: effectiveMode,
    averageAvailable: averages.some(value => value !== null), changePercent: change !== null && Number.isFinite(change) ? change : null };
}
export function nearestChartPoint(coords: { x: number }[], x: number): number {
  return coords.reduce((best, point, index) => Math.abs(point.x - x) < Math.abs(coords[best].x - x) ? index : best, 0);
}
