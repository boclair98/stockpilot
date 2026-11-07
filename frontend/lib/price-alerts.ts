export type PriceAlert = {
  id: string; symbol: string; name: string; currency: "KRW" | "USD" | null;
  market?: "KR" | "US" | null; exchange?: string;
  direction: "ABOVE" | "BELOW"; targetPrice: number; currentPrice: number | null;
  status: "ACTIVE" | "TRIGGERED"; read: boolean; triggeredAt: string | null;
};
export type AlertScope = {
  activeLimit: number; recentTriggeredLimit: number; activeCount: number; triggeredCount: number;
  activeHasMore: boolean; triggeredHasMore: boolean;
};
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

export function validPriceAlerts(value: unknown): value is PriceAlert[] {
  return Array.isArray(value) && value.length <= 50 && new Set(value.map(item => object(item) ? item.id : null)).size === value.length
    && value.every(item => object(item) && [item.id,item.symbol,item.name].every(field=>typeof field==="string"&&field.length>0)
      && (item.currency===null||item.currency==="KRW"||item.currency==="USD")
      && (item.market===undefined||item.market===null||item.market==="KR"||item.market==="US")
      && (item.exchange===undefined||typeof item.exchange==="string"&&item.exchange.length>0)
      && (item.direction==="ABOVE"||item.direction==="BELOW") && positive(item.targetPrice)
      && (item.currentPrice===null||positive(item.currentPrice)) && (item.status==="ACTIVE"||item.status==="TRIGGERED")
      && typeof item.read==="boolean" && (item.triggeredAt===null||typeof item.triggeredAt==="string"&&Number.isFinite(Date.parse(item.triggeredAt))));
}

export function validAlertScope(value: unknown): value is AlertScope | undefined {
  return value===undefined || object(value)
    && [value.activeLimit,value.recentTriggeredLimit,value.activeCount,value.triggeredCount].every(count)
    && value.activeLimit===20 && value.recentTriggeredLimit===30
    && typeof value.activeHasMore==="boolean" && typeof value.triggeredHasMore==="boolean";
}

export function validAlertReadReceipt(value: unknown): value is {read: number} {
  return object(value) && count(value.read);
}

export function filterPriceAlerts(items: PriceAlert[], query: string, status: string) {
  const normalize=(value:string)=>value.trim().toLocaleLowerCase().replace(/\s+/g,"");
  const needle=normalize(query);
  return items.filter(item=>(status==="ALL"||status===item.status||status==="UNREAD"&&item.status==="TRIGGERED"&&!item.read)
    && (!needle||[item.name,item.symbol,item.exchange||""].some(value=>normalize(value).includes(needle))));
}

export function alertPrice(value: number, currency: PriceAlert["currency"]): string {
  return currency ? new Intl.NumberFormat("ko-KR",{style:"currency",currency,minimumFractionDigits:currency==="USD"?2:0,maximumFractionDigits:4}).format(value)
    : `${value.toLocaleString("ko-KR",{maximumFractionDigits:4})} (통화 미확인)`;
}
