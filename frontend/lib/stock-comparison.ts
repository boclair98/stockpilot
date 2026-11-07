import type { InstrumentIdentity } from "./instrument-identity";

export type DailyClose = { date: string; close: number };
export type ComparisonSeries = { points: Array<DailyClose & { change: number }>; returnRate: number; maxDrawdown: number };
export type ComparisonDays = 5 | 20 | 60;
export type ComparisonInstrument = InstrumentIdentity & { logoUrl?: string | null };
export type SavedComparison = { id: string; name: string; instruments: ComparisonInstrument[]; note: string; days: ComparisonDays };

export function comparisonDays(value: unknown): ComparisonDays {
  return value === 5 || value === "5" ? 5 : value === 60 || value === "60" ? 60 : 20;
}

/** A shared identity remains selected even when its quote is temporarily unavailable. */
export function comparisonInstruments(value: string): ComparisonInstrument[] {
  return parseComparisonIds(value).map(({market, exchange, symbol}) => ({
    id: `${market}:${exchange}:${symbol}`, market, exchange, symbol,
    currency: market === "KR" ? "KRW" : "USD", name: symbol,
  }));
}

export function comparisonInstrument(value: unknown): ComparisonInstrument | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.name !== "string" || !row.name.trim()) return null;
  const identity = comparisonInstruments(row.id)[0];
  if (!identity || identity.id !== row.id || identity.market !== row.market || identity.symbol !== row.symbol || identity.exchange !== row.exchange || identity.currency !== row.currency) return null;
  return {...identity, name: row.name, logoUrl: typeof row.logoUrl === "string" ? row.logoUrl : null};
}

/** Only public symbols and the selected period enter a comparison URL. */
export function comparisonHref(ids: string, days: unknown): string {
  const safe = comparisonInstruments(ids).map(item => item.id).join(",");
  const params = new URLSearchParams({days: String(comparisonDays(days))});
  if (safe) params.set("items", safe);
  return `/compare?${params}`;
}

/** Older browser/account records have no days field and retain the old 20-day default. */
export function savedComparison(value: unknown): SavedComparison | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  if (typeof entry.id !== "string" || typeof entry.name !== "string" || typeof entry.note !== "string" || entry.note.length > 2400 || [...entry.note].length > 1200 ||
      !Array.isArray(entry.instruments) || entry.instruments.length < 2 || entry.instruments.length > 3 ||
      (entry.days !== undefined && ![5,20,60].includes(entry.days as number))) return null;
  const instruments = entry.instruments.map(comparisonInstrument);
  if (instruments.some(item => !item) || new Set(instruments.map(item => item!.id)).size !== instruments.length || instruments.map(item => item!.id).join(",") !== entry.id) return null;
  return {id: entry.id, name: entry.name, instruments: instruments as ComparisonInstrument[], note: entry.note, days: comparisonDays(entry.days)};
}

export function normalizeHistory(input: unknown): DailyClose[] {
  if (!Array.isArray(input)) return [];
  const dates = new Map<string, number>();
  for (const row of input) {
    if (!row || typeof row.date !== "string" || !Number.isFinite(row.close) || row.close <= 0) continue;
    const date = /^\d{8}$/.test(row.date) ? `${row.date.slice(0,4)}-${row.date.slice(4,6)}-${row.date.slice(6,8)}` : row.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const timestamp = Date.parse(`${date}T00:00:00Z`);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0,10) !== date) continue;
    dates.set(date, row.close);
  }
  return [...dates].sort(([a],[b]) => a.localeCompare(b)).map(([date,close]) => ({date,close}));
}

export function compareHistories(histories: DailyClose[][], days: number): { dates: string[]; series: ComparisonSeries[] } | null {
  if (histories.length < 2 || histories.some(history => history.length < 2)) return null;
  const maps = histories.map(history => new Map(history.map(point => [point.date, point.close])));
  const dates = histories[0].map(point => point.date).filter(date => maps.every(map => map.has(date))).sort().slice(-days);
  if (dates.length < 2) return null;
  return {
    dates,
    series: maps.map((map,index) => {
      const base = map.get(dates[0])!;
      let peak = base, maxDrawdown = 0;
      for (const point of histories[index].filter(point=>point.date>=dates[0] && point.date<=dates.at(-1)!).sort((a,b)=>a.date.localeCompare(b.date))) {
        peak=Math.max(peak,point.close);
        maxDrawdown=Math.min(maxDrawdown,(point.close/peak-1)*100);
      }
      const points = dates.map(date => {
        const close = map.get(date)!;
        return {date, close, change:(close / base - 1) * 100};
      });
      return {points,returnRate:points.at(-1)!.change,maxDrawdown};
    }),
  };
}

export function parseComparisonIds(value: string): Array<{symbol:string;market:"KR"|"US";exchange:string}> {
  const seen = new Set<string>();
  return value.slice(0,200).split(',').flatMap<{symbol:string;market:"KR"|"US";exchange:string}>(id => {
    if (seen.has(id)) return [];
    seen.add(id);
    const [market,exchange,symbol,...rest] = id.split(':');
    if (rest.length || !symbol) return [];
    if (market === 'KR' && ['KRX','NXT'].includes(exchange) && /^[0-9A-Z]{6}$/.test(symbol)) return [{market,symbol,exchange} as const];
    if (market === 'US' && ['NAS','NYS','AMS'].includes(exchange) && /^[A-Z0-9][A-Z0-9.\/\-]{0,11}$/.test(symbol)) return [{market,symbol,exchange} as const];
    return [];
  }).slice(0,3);
}

export function practiceInvestment(amount: number, firstPrice: number, lastPrice: number, currency: "KRW" | "USD") {
  const precision = currency === "KRW" ? 1 : 100;
  const cash = Math.round(amount * precision);
  const first = Math.round(firstPrice * precision), last = Math.round(lastPrice * precision);
  if (![cash,first,last].every(value => Number.isSafeInteger(value) && value > 0)) return null;
  const quantity = Math.floor(cash / first);
  const remaining = cash - quantity * first;
  const final = remaining + quantity * last;
  if (!Number.isSafeInteger(final)) return null;
  return {quantity,remaining:remaining/precision,final:final/precision,profit:(final-cash)/precision,returnRate:(final/cash-1)*100};
}
