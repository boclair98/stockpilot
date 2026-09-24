export type Market = "KR" | "US";
export type Exchange = "KRX" | "NXT" | "NAS" | "NYS" | "AMS" | string;

export interface Quote {
  id?: string;
  symbol: string;
  name: string;
  englishName?: string;
  market: Market;
  currency: "KRW" | "USD";
  exchange: Exchange;
  price: number;
  change?: number;
  changePercent?: number;
  volume?: number;
  logoUrl?: string | null;
  isTop?: boolean;
  asOf?: string;
}

export interface KospiPoint { date: string; close: number }

export interface Kospi {
  name: string;
  value: number;
  change: number;
  changePercent: number;
  points: KospiPoint[];
  asOf?: string;
  stale?: boolean;
}

export interface Position {
  symbol: string;
  name: string;
  market: Market;
  currency: "KRW" | "USD";
  exchange: Exchange;
  logoUrl?: string | null;
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  marketValue: number;
  profit: number;
  returnRate: number;
}

export interface Order {
  id: string;
  symbol: string;
  exchange: string;
  side: "BUY" | "SELL";
  orderType: string;
  quantity: number;
  fillPrice?: number | null;
  status: string;
  createdAt: string;
}

export interface Portfolio {
  authenticated: boolean;
  cash: { KRW: number; USD: number };
  positions: Position[];
  orders: Order[];
}

export interface Ranking {
  rank: number;
  nickname: string;
  returnRate: number;
  rankChange: number;
  isMe?: boolean;
}

export interface League {
  title: string;
  participantCount: number;
  rankings: Ranking[];
  me: { joined: boolean; nickname?: string; rank?: number; returnRate?: number };
}

export interface Bootstrap {
  quotes: Quote[];
  kospi: Kospi | null;
  asOf: string;
  status?: Record<string, unknown>;
}

export type AppTab = "home" | "market" | "portfolio" | "league" | "more";
