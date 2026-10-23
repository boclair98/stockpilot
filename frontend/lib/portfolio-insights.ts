export type HoldingRecord = {
  symbol: string; name: string; exchange: string; market: "KR" | "US";
  currency: "KRW" | "USD"; quantity: number; averagePrice: number;
  currentPrice: number; marketValue: number; profit: number; returnRate: number;
  logoUrl?: string | null;
};
type Currency = HoldingRecord["currency"];
type ProtectionRecord = {symbol: string; exchange: string; quantity: number; status: string};

/** Percentages never compare or sum KRW with USD. Protection quantity is capped once per holding. */
export function portfolioRisk(holdings: HoldingRecord[], cash: Record<Currency, number>, protections: ProtectionRecord[]) {
  const invested: Record<Currency, number> = {KRW:0,USD:0};
  const protectedValue: Record<Currency, number> = {KRW:0,USD:0};
  const protectedQuantities = new Map<string,number>();
  for (const plan of protections) {
    if(plan.status!=="ACTIVE") continue;
    const key=plan.exchange+":"+plan.symbol;
    protectedQuantities.set(key,(protectedQuantities.get(key)||0)+Math.max(0,plan.quantity));
  }
  for (const holding of holdings) {
    invested[holding.currency] += Math.max(0,holding.marketValue);
    const quantity = protectedQuantities.get(holding.exchange+":"+holding.symbol)||0;
    if (holding.quantity>0) protectedValue[holding.currency] += Math.max(0,holding.marketValue)*Math.min(holding.quantity,quantity)/holding.quantity;
  }
  const total = {KRW:cash.KRW+invested.KRW,USD:cash.USD+invested.USD};
  let largest: HoldingRecord|null = null;
  let concentration = 0;
  for (const holding of holdings) {
    const share = total[holding.currency]>0 ? holding.marketValue/total[holding.currency]*100 : 0;
    if (share>concentration) {largest=holding;concentration=share;}
  }
  const coverage = (currency: Currency) => invested[currency]>0 ? Math.min(100,protectedValue[currency]/invested[currency]*100) : null;
  const cashShare = (currency: Currency) => total[currency]>0 ? cash[currency]/total[currency]*100 : null;
  return {largest,concentration,protectionCoverage:{KRW:coverage("KRW"),USD:coverage("USD")},cashRatio:{KRW:cashShare("KRW"),USD:cashShare("USD")}};
}

export function findHoldings(holdings: HoldingRecord[], query: string, market: string, sort: string) {
  const normalize = (value: string) => value.toLocaleLowerCase().replace(/\s+/g,"");
  const needle=normalize(query.trim());
  const rows=holdings.filter(item=>(market==="ALL"||item.market===market)&&(!needle||[item.name,item.symbol,item.exchange].some(value=>normalize(value).includes(needle))));
  if(sort==="name") rows.sort((a,b)=>a.name.localeCompare(b.name,"ko"));
  if(sort==="return-high"||sort==="return-low") rows.sort((a,b)=>(sort==="return-high"?-1:1)*(a.returnRate-b.returnRate));
  return rows;
}
