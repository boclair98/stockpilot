export type HistoryOrder = {
  id: string; symbol: string; name: string | null; exchange: string;
  market: "KR" | "US" | null; currency: "KRW" | "USD" | null;
  side: string; orderType: string; quantity: number; status: string;
  fillPrice: number | null; grossAmount: number | null;
  fee: number | null; tax: number | null; realizedPnl: number | null; createdAt: string;
  executionAt?: string | null;
  executionTimeEstimated?: boolean;
};
export type HistoryPage = { items: HistoryOrder[]; hasMore: boolean; nextCursor: string | null; asOf: string };
export const orderStatusLabels: Record<string, string> = {
  FILLED: "체결", OPEN: "조건 대기", TRIGGERED: "조건 충족",
  CANCELED: "취소", CANCELLED: "취소", REJECTED: "거절",
};
export const sideLabel = (side: string) => side === "BUY" ? "매수" : side === "SELL" ? "매도" : "방향 확인 중";
export const orderMoney = (value: number | null, currency: HistoryOrder["currency"], precision = 4) =>
  value !== null && Number.isFinite(value) && currency
    ? new Intl.NumberFormat("ko-KR", {style:"currency",currency,minimumFractionDigits:currency==="USD"?2:0,maximumFractionDigits:precision}).format(value)
    : "—";
export function seoulDate(value: string) {
  return new Intl.DateTimeFormat("sv-SE", {timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(value));
}
export function validHistoryPage(value: unknown): value is HistoryPage {
  if (!value || typeof value !== "object") return false;
  const page = value as HistoryPage;
  return Array.isArray(page.items) && page.items.length <= 50 && typeof page.hasMore === "boolean"
    && (page.hasMore ? page.items.length > 0 && typeof page.nextCursor === "string" && page.nextCursor.length > 0 : page.nextCursor === null)
    && typeof page.asOf === "string" && Number.isFinite(Date.parse(page.asOf))
    && page.items.every(row => row && typeof row === "object"
      && [row.id,row.symbol,row.exchange,row.side,row.orderType,row.status].every(v=>typeof v==="string"&&v.length>0)
      && (row.name === null || typeof row.name === "string")
      && [null,"KR","US"].includes(row.market) && [null,"KRW","USD"].includes(row.currency)
      && (row.market === "KR" ? row.currency === "KRW" : row.market === "US" ? row.currency === "USD" : row.currency === null)
      && Number.isFinite(row.quantity) && row.quantity > 0
      && [row.fillPrice,row.grossAmount,row.fee,row.tax,row.realizedPnl].every(v=>v===null||typeof v==="number"&&Number.isFinite(v))
      && (row.fillPrice === null || row.fillPrice > 0)
      && (row.grossAmount === null || row.grossAmount >= 0)
      && typeof row.createdAt==="string" && Number.isFinite(Date.parse(row.createdAt))
      && (row.executionAt === undefined || row.executionAt === null || typeof row.executionAt === "string" && Number.isFinite(Date.parse(row.executionAt)))
      && (row.executionTimeEstimated === undefined || typeof row.executionTimeEstimated === "boolean"));
}
export function appendHistory(previous: HistoryOrder[], incoming: HistoryOrder[]) {
  const seen = new Set(previous.map(row=>row.id));
  return [...previous, ...incoming.filter(row => { if(seen.has(row.id)) return false; seen.add(row.id); return true; })];
}
// User-initiated, local-only export. Escape formulas and preserve identifier zeros.
function csvCell(value: string | number | null, identifier = false) {
  let text = value === null ? "" : String(value);
  if (identifier || typeof value === "string" && /^[\s]*[=+\-@\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"','""') + '"';
}
export function historyCsv(rows: HistoryOrder[]) {
  const header = ["주문 ID","종목명","종목 코드","거래소","통화","매매","상태","수량","체결가","체결금액(비용 제외)","수수료","세금","실현손익","주문시각(서울)","체결시각(서울)","체결시각 기준"];
  return "\uFEFF" + [header.map(v=>csvCell(v)).join(","), ...rows.map(row => [
    csvCell(row.id,true),csvCell(row.name),csvCell(row.symbol,true),csvCell(row.exchange),csvCell(row.currency),
    csvCell(sideLabel(row.side)),csvCell(orderStatusLabels[row.status]||row.status),csvCell(row.quantity),
    csvCell(row.status==="FILLED"?row.fillPrice:null),csvCell(row.status==="FILLED"?row.grossAmount:null),
    csvCell(row.fee),csvCell(row.tax),csvCell(row.realizedPnl),
    csvCell(new Date(row.createdAt).toLocaleString("ko-KR",{timeZone:"Asia/Seoul",hour12:false})),
    csvCell(row.status==="FILLED" && row.executionAt ? new Date(row.executionAt).toLocaleString("ko-KR",{timeZone:"Asia/Seoul",hour12:false}) : null),
    csvCell(row.status==="FILLED" && row.executionAt ? row.executionTimeEstimated ? "주문시각 대체" : "체결시각" : null),
  ].join(","))].join("\r\n");
}
