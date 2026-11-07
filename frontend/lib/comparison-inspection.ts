import type { InstrumentIdentity } from "./instrument-identity";
import type { ComparisonSeries } from "./stock-comparison";

export type InspectableComparison = { dates: string[]; series: ComparisonSeries[] };

/** Use only aligned observations; never fill a missing trading day or quote. */
export function comparisonInspection(
  comparison: InspectableComparison,
  instruments: InstrumentIdentity[],
  requestedDate: string | null,
) {
  const { dates, series } = comparison;
  if (!dates.length || instruments.length !== series.length) return null;
  if (series.some(item => item.points.length !== dates.length || item.points.some((point, index) =>
    point.date !== dates[index] || !Number.isFinite(point.close) || point.close <= 0 || !Number.isFinite(point.change)))) return null;
  const requestedIndex = requestedDate ? dates.indexOf(requestedDate) : -1;
  const index = requestedIndex >= 0 ? requestedIndex : dates.length - 1;
  const date = dates[index];
  const rows = instruments.map((instrument, position) => {
    const point = series[position]?.points[index];
    if (!point || point.date !== date || !Number.isFinite(point.close) || point.close <= 0 || !Number.isFinite(point.change)) return null;
    return { instrument, close: point.close, change: point.change };
  });
  if (rows.some(row => row === null)) return null;
  return { index, date, rows: rows.filter(row => row !== null) };
}

export function inspectionMoney(value: number, currency: "KRW" | "USD") {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency", currency,
    minimumFractionDigits: currency === "KRW" ? 0 : 2,
    maximumFractionDigits: 8,
  }).format(value);
}
