import { isInstrument, type InstrumentIdentity } from "./instrument-identity";

export type RankedStock = InstrumentIdentity & {
  englishName: string;
  price: number;
  changePercent: number | null;
  marketCapEok: number | null;
  marketCapUsd: number | null;
  volume: number | null;
  logoUrl?: string | null;
};
export type RankingPage = {
  items: RankedStock[];
  asOf: string;
  hasMore: boolean;
  nextOffset: number | null;
  partial: boolean;
};
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const nonnegative = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const positive = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;

/** Only public instrument fields may enter a comparison URL or selection. */
export function comparisonIdentity(value: unknown): InstrumentIdentity | null {
  if (!isInstrument(value)) return null;
  const { symbol, market, exchange, currency, name } = value;
  if (market === "KR" ? !/^\d{6}$/.test(symbol) || !["KRX", "NXT"].includes(exchange)
    : !/^[A-Z0-9.\-]{1,16}$/.test(symbol) || !["NAS", "NYS", "AMS"].includes(exchange)) return null;
  const id = `${market}:${exchange}:${symbol}`;
  if (value.id !== id) return null;
  return { id, symbol, market, exchange, currency, name };
}

export function normalizeRankingPage(value: unknown, market: "KR" | "US", offset: number): RankingPage {
  if (!record(value) || !Array.isArray(value.items) || typeof value.asOf !== "string" || !Number.isFinite(Date.parse(value.asOf))) {
    throw new Error("확인 가능한 목록이 없어요. 다시 조회해 주세요.");
  }
  const seen = new Set<string>();
  const items: RankedStock[] = [];
  for (const row of value.items) {
    const identity = comparisonIdentity(row);
    if (!identity || identity.market !== market || !record(row) || positive(row.price) === null || seen.has(identity.id)) continue;
    seen.add(identity.id);
    items.push({
      ...identity,
      englishName: typeof row.englishName === "string" ? row.englishName : "",
      price: row.price as number,
      changePercent: typeof row.changePercent === "number" && Number.isFinite(row.changePercent) ? row.changePercent : null,
      marketCapEok: market === "KR" ? positive(row.marketCapEok) : null,
      marketCapUsd: market === "US" ? positive(row.marketCapUsd) : null,
      volume: nonnegative(row.volume),
      logoUrl: typeof row.logoUrl === "string" ? row.logoUrl : null,
    });
  }
  const hasMore = value.hasMore === true && items.length > 0 && typeof value.nextOffset === "number" && Number.isSafeInteger(value.nextOffset) && value.nextOffset > offset;
  return { items, asOf: value.asOf, hasMore, nextOffset: hasMore ? value.nextOffset as number : null, partial: value.partial === true || items.length !== value.items.length };
}

export function toggleComparison(current: InstrumentIdentity[], value: unknown): { items: InstrumentIdentity[]; message: string } {
  const item = comparisonIdentity(value);
  if (!item) return { items: current, message: "종목 정보를 확인하지 못했어요. 다시 조회해 주세요." };
  if (current.some(entry => entry.id === item.id)) return { items: current.filter(entry => entry.id !== item.id), message: `${item.name}을 비교에서 제외했어요.` };
  if (current.length >= 3) return { items: current, message: "최대 3개까지 비교할 수 있어요. 선택한 종목을 먼저 제외해 주세요." };
  return { items: [...current, item], message: `${item.name}을 비교에 추가했어요.` };
}

export function rankingComparisonHref(items: InstrumentIdentity[]): string | null {
  if (items.length < 2 || items.length > 3) return null;
  const identities = items.map(comparisonIdentity);
  if (identities.some(item => !item) || new Set(identities.map(item => item!.id)).size !== items.length) return null;
  return `/compare?${new URLSearchParams({ items: identities.map(item => item!.id).join(",") })}`;
}
