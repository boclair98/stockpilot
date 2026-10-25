/** Guards the shapes used by the personal workspace before rendering private data. */
type Row = Record<string, unknown>;
const record = (value: unknown): value is Row => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string";
const nonempty = (value: unknown) => text(value) && value.trim().length > 0;
const strings = (row: Row, keys: string[]) => keys.every(key => text(row[key]));
const list = (value: unknown, valid: (row: Row) => boolean) => Array.isArray(value) && value.every(row => record(row) && valid(row));
const date = (value: unknown) => text(value) && Number.isFinite(Date.parse(value));
const nullableDate = (value: unknown) => value === null || date(value);
const numeric = (value: unknown) => (typeof value === "number" || text(value) && value.trim() !== "") && Number.isFinite(Number(value));
const currency = (value: unknown) => value === "KRW" || value === "USD";
const link = (value: unknown) => text(value) && /^https?:\/\//.test(value);
const ticket = (row: Row) => strings(row, ["id", "category", "subject", "body", "status"]) && (row.reply === null || text(row.reply)) && date(row.createdAt) && date(row.updatedAt);
const action = (row: Row) => strings(row, ["id", "symbol", "kind"]) && currency(row.currency) && date(row.cutoffAt) && date(row.payAt) && link(row.sourceUrl)
  && (row.kind === "DIVIDEND" ? numeric(row.perShare) && Number(row.perShare) > 0 : row.kind === "SPLIT" && numeric(row.ratio) && Number(row.ratio) > 0);

export function validPersonalRead(url: string, value: unknown): boolean {
  if (!record(value)) return false;
  const path = url.split("?")[0];
  switch (path) {
    case "/api/personal/notices":
      return list(value.items, row => strings(row, ["id", "title", "body", "severity"]) && date(row.createdAt));
    case "/api/personal/inbox":
      return list(value.items, row => strings(row, ["key", "title", "body"]) && date(row.at) && typeof row.read === "boolean" && text(row.href) && /^\/(?!\/)/.test(row.href))
        && typeof value.hasMore === "boolean" && (value.nextCursor === null || nonempty(value.nextCursor))
        && (!value.hasMore || nonempty(value.nextCursor) && value.nextCursor !== new URLSearchParams(url.split("?")[1] || "").get("cursor"));
    case "/api/personal/support":
      return list(value.items, ticket) && typeof value.hasMore === "boolean";
    case "/api/personal/disclosures":
      return list(value.groups, row => record(row.instrument) && strings(row.instrument, ["id", "name"]) && text(row.source) && nullableDate(row.asOf)
        && list(row.items, item => ["title", "date", "receiptNo"].every(key => item[key] === null || text(item[key])) && link(item.url)))
        && Array.isArray(value.failed) && value.failed.every(text) && typeof value.hasMore === "boolean";
    case "/api/personal/recurring":
      return list(value.items, row => strings(row, ["id", "name", "localTime", "timezone"]) && currency(row.currency) && numeric(row.amount) && Number(row.amount) > 0
        && Number.isInteger(row.weekday) && Number(row.weekday) >= 0 && Number(row.weekday) <= 4 && typeof row.active === "boolean" && date(row.nextAt))
        && list(value.runs, row => strings(row, ["id", "planId", "status", "reason"]) && date(row.dueAt) && (row.orderId === null || text(row.orderId)))
        && (value.worker === null || record(value.worker) && date(value.worker.at) && text(value.worker.status));
    case "/api/personal/fx/rate":
      return numeric(value.rate) && Number(value.rate) > 0 && date(value.date) && text(value.source) && link(value.sourceUrl);
    case "/api/trading/portfolio":
      return value.authenticated !== false && record(value.cash) && [value.cash.KRW, value.cash.USD].every(item => typeof item === "number" && Number.isFinite(item) && item >= 0);
    case "/api/personal/money":
      return list(value.items, row => strings(row, ["id", "kind", "status"]) && date(row.createdAt) && nullableDate(row.expiresAt) && record(row.data)
        && (row.data.message === undefined || text(row.data.message)) && (row.data.sourceUrl === undefined || link(row.data.sourceUrl))) && typeof value.hasMore === "boolean";
    case "/api/personal/corporate":
      return list(value.items, row => ["type", "kind", "recordDate", "payDate", "perShare", "ratio", "symbol"].every(key => row[key] === undefined || row[key] === null || text(row[key])))
        && list(value.verified, action) && (value.note === undefined || text(value.note)) && (value.partial === undefined || typeof value.partial === "boolean");
    case "/api/personal/operations":
      return list(value.tickets, ticket) && list(value.actions, action) && list(value.notices, row => strings(row, ["id", "title"]) && typeof row.active === "boolean") && typeof value.hasMore === "boolean";
    default:
      return false;
  }
}

/** Matches the server's existing recurring budget/session limits; no trading-rule changes. */
export function recurringDraftError(market: "KR" | "US", amount: string, weekday: string, time: string) {
  const budget = Number(amount), dollars = market === "US";
  if (!amount.trim() || !Number.isFinite(budget) || budget < (dollars ? .01 : 1) || budget > (dollars ? 50_000 : 50_000_000))
    return dollars ? "주간 예산은 0.01~50,000달러로 입력해 주세요." : "주간 예산은 1~50,000,000원으로 입력해 주세요.";
  // Reject exponent notation and excess decimals before Number rounding hides them.
  if (!(dollars ? /^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/ : /^\d+(?:\.0+)?$/).test(amount))
    return dollars ? "달러 예산은 소수 둘째 자리까지 입력해 주세요." : "원화 예산은 1원 단위로 입력해 주세요.";
  if (!/^[0-4]$/.test(weekday)) return "월요일부터 금요일 중에 골라주세요.";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || time < (dollars ? "09:30" : "09:00") || time > (dollars ? "15:50" : "15:00"))
    return dollars ? "뉴욕 시간 09:30~15:50 안에서 골라주세요." : "한국 시간 09:00~15:00 안에서 골라주세요.";
  return "";
}
