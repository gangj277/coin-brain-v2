import type { TraderSnapshot } from "./client";

export interface AnalyzedPosition {
  coin: string;
  side: "LONG" | "SHORT";
  size: number;
  sizeUsd: number;
  entryPrice: number;
  leverage: number;
  unrealizedPnl: number;
  roe: number;
  liquidationPrice: number | null;
}

export interface TraderAnalysis {
  address: string;
  accountValue: number;
  totalPositionValue: number;
  positions: AnalyzedPosition[];
  stats: {
    perpAllTimePnl: number;
    perpAllTimeVolume: number;
    perpMonthPnl: number;
    perpMonthVolume: number;
    perpWeekPnl: number;
    perpWeekVolume: number;
  };
  metrics: {
    winRate: number;
    profitFactor: number;
    avgLeverage: number;
    closedTradesCount: number;
  };
  recentTrades: {
    coin: string;
    side: "BUY" | "SELL";
    size: string;
    price: string;
    closedPnl: number;
    time: string;
  }[];
}

function getTimeframeData(
  portfolio: TraderSnapshot["portfolio"],
  timeframe: string
): { pnl: number; vol: number } {
  const entry = portfolio.find(([name]) => name === timeframe);
  if (!entry) return { pnl: 0, vol: 0 };
  const pnlHist = entry[1].pnlHistory;
  return {
    pnl:
      pnlHist.length > 0
        ? parseFloat(pnlHist[pnlHist.length - 1][1])
        : 0,
    vol: parseFloat(entry[1].vlm),
  };
}

export function analyzeTrader(snapshot: TraderSnapshot): TraderAnalysis {
  const { state, portfolio, recentFills } = snapshot;

  // Parse positions
  const positions: AnalyzedPosition[] = state.assetPositions.map((ap) => {
    const p = ap.position;
    const szi = parseFloat(p.szi);
    return {
      coin: p.coin,
      side: szi > 0 ? "LONG" : "SHORT",
      size: Math.abs(szi),
      sizeUsd: parseFloat(p.positionValue),
      entryPrice: parseFloat(p.entryPx),
      leverage: p.leverage.value,
      unrealizedPnl: parseFloat(p.unrealizedPnl),
      roe: parseFloat(p.returnOnEquity),
      liquidationPrice: p.liquidationPx ? parseFloat(p.liquidationPx) : null,
    };
  });

  // Portfolio stats
  const allTime = getTimeframeData(portfolio, "perpAllTime");
  const month = getTimeframeData(portfolio, "perpMonth");
  const week = getTimeframeData(portfolio, "perpWeek");

  // Win rate & profit factor from recent fills
  const closedTrades = recentFills.filter(
    (f) => parseFloat(f.closedPnl) !== 0
  );
  const wins = closedTrades.filter((f) => parseFloat(f.closedPnl) > 0).length;
  const winRate =
    closedTrades.length > 0 ? wins / closedTrades.length : 0;

  const grossProfit = closedTrades
    .filter((f) => parseFloat(f.closedPnl) > 0)
    .reduce((s, f) => s + parseFloat(f.closedPnl), 0);
  const grossLoss = Math.abs(
    closedTrades
      .filter((f) => parseFloat(f.closedPnl) < 0)
      .reduce((s, f) => s + parseFloat(f.closedPnl), 0)
  );
  const profitFactor =
    grossLoss > 0
      ? grossProfit / grossLoss
      : grossProfit > 0
        ? Infinity
        : 0;

  const avgLeverage =
    positions.length > 0
      ? positions.reduce((s, p) => s + p.leverage, 0) / positions.length
      : 0;

  const totalPositionValue = positions.reduce((s, p) => s + p.sizeUsd, 0);

  const recentTrades = recentFills.slice(0, 30).map((f) => ({
    coin: f.coin,
    side: (f.side === "A" ? "BUY" : "SELL") as "BUY" | "SELL",
    size: f.sz,
    price: f.px,
    closedPnl: parseFloat(f.closedPnl),
    time: new Date(f.time).toISOString(),
  }));

  return {
    address: snapshot.address,
    accountValue: parseFloat(state.marginSummary.accountValue),
    totalPositionValue,
    positions,
    stats: {
      perpAllTimePnl: allTime.pnl,
      perpAllTimeVolume: allTime.vol,
      perpMonthPnl: month.pnl,
      perpMonthVolume: month.vol,
      perpWeekPnl: week.pnl,
      perpWeekVolume: week.vol,
    },
    metrics: {
      winRate,
      profitFactor: profitFactor === Infinity ? 999 : profitFactor,
      avgLeverage,
      closedTradesCount: closedTrades.length,
    },
    recentTrades,
  };
}
