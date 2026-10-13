export type DailyClose = { date: string; close: number };
export type ComparisonSeries = { points: Array<DailyClose & { change: number }>; returnRate: number; maxDrawdown: number };

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
    if (market === 'KR' && ['KRX','NXT'].includes(exchange) && /^\d{6}$/.test(symbol)) return [{market,symbol,exchange} as const];
    if (market === 'US' && ['NAS','NYS','AMS'].includes(exchange) && /^[A-Z0-9.\-]{1,16}$/.test(symbol)) return [{market,symbol,exchange} as const];
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
