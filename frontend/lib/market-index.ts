import { normalizeChartDate } from "./stock-chart";

export type IndexPoint = { date: string; close: number; open?: number; high?: number; low?: number; volume?: number };
export type IndexData = { name: string; value: number; change: number; changePercent: number; asOf: string; source: string; stale?: boolean; points: IndexPoint[] };
export function parseIndexData(raw: unknown): IndexData {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("지수 자료를 확인하지 못했어요.");
  const data = raw as IndexData;
  if (data.name !== "KOSPI" || typeof data.value !== "number" || !Number.isFinite(data.value) || data.value <= 0 ||
    ![data.change,data.changePercent].every(value => typeof value === "number" && Number.isFinite(value)) ||
    typeof data.asOf !== "string" || !Number.isFinite(Date.parse(data.asOf)) || typeof data.source !== "string" ||
    !Array.isArray(data.points) || data.points.length > 366) throw new Error("지수 자료의 형식을 확인하지 못했어요.");
  const seen = new Set<string>();
  const points = data.points.map(point => {
    const date = normalizeChartDate(point?.date);
    if (!point || !date || seen.has(date) || typeof point.close !== "number" || !Number.isFinite(point.close) || point.close <= 0) throw new Error("지수의 날짜나 종가를 확인하지 못했어요.");
    seen.add(date);
    return { ...point, date };
  }).sort((a,b) => a.date.localeCompare(b.date));
  return { ...data, points };
}
export function indexSnapshot(raw: unknown): IndexData | null { try { return parseIndexData(raw); } catch { return null; } }
