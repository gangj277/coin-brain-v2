// Hyperliquid API Types

export interface Position {
  coin: string;
  entryPx: string;
  leverage: {
    type: "isolated" | "cross";
    value: number;
    rawUsd: string;
  };
  liquidationPx: string | null;
  marginUsed: string;
  maxLeverage: number;
  positionValue: string;
  returnOnEquity: string;
  szi: string; // signed size (negative = short)
  unrealizedPnl: string;
  cumFunding: {
    allTime: string;
    sinceChange: string;
    sinceOpen: string;
  };
}

export interface AssetPosition {
  position: Position;
  type: "oneWay";
}

export interface MarginSummary {
  accountValue: string;
  totalMarginUsed: string;
  totalNtlPos: string;
  totalRawUsd: string;
}

export interface ClearinghouseState {
  assetPositions: AssetPosition[];
  marginSummary: MarginSummary;
  withdrawable: string;
  time: number;
}

export interface Fill {
  coin: string;
  px: string;
  sz: string;
  side: "A" | "B"; // A = buy, B = sell
  time: number;
  startPosition: string;
  dir: string;
  closedPnl: string;
  hash: string;
  oid: number;
  crossed: boolean;
  fee: string;
  tid: number;
  feeToken: string;
}

export interface FundingDelta {
  coin: string;
  fundingRate: string;
  szi: string;
  type: "funding";
  usdc: string;
  nSamples: number | null;
}

export interface FundingEntry {
  delta: FundingDelta;
  hash: string;
  time: number;
}

export interface CoinMeta {
  name: string;
  szDecimals: number;
  maxLeverage: number;
}

export interface Meta {
  universe: CoinMeta[];
}

export interface PortfolioData {
  accountValueHistory: [number, string][];
  pnlHistory: [number, string][];
  vlm: string;
}

export type PortfolioTimeframe =
  | "day"
  | "week"
  | "month"
  | "allTime"
  | "perpDay"
  | "perpWeek"
  | "perpMonth"
  | "perpAllTime";

export type PortfolioResponse = [PortfolioTimeframe, PortfolioData][];

export interface OpenOrder {
  coin: string;
  limitPx: string;
  oid: number;
  side: "A" | "B";
  sz: string;
  timestamp: number;
}

export interface FrontendOpenOrder extends OpenOrder {
  orderType: string;
  origSz: string;
  isTrigger: boolean;
  triggerPx: string;
  triggerCondition: string;
  reduceOnly: boolean;
  cloid: string | null;
}

// Trader analysis types

export interface TraderStats {
  address: string;
  totalPnl: number;
  winRate: number;
  totalTrades: number;
  avgLeverage: number;
  maxDrawdown: number;
  profitFactor: number;
  accountValue: number;
  positions: AssetPosition[];
  recentFills: Fill[];
}
