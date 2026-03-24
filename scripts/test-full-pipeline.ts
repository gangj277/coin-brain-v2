/**
 * Full pipeline test: Hyperliquid data fetching infrastructure
 * Run: npx tsx scripts/test-full-pipeline.ts
 */

const INFO_URL = "https://api.hyperliquid.xyz/info";

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch(INFO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

// ─── Step 1: Discover active traders from HLP vault followers ───

async function discoverTraders(): Promise<string[]> {
  console.log("STEP 1: Discovering traders from HLP vault...\n");

  const hlpVault = "0xdfc24b077bc1425ad1dea75bcb6f8158e10df303";
  const vaultDetails = await post<{
    followers: { user: string; vaultEquity: string; allTimePnl: string }[];
  }>({ type: "vaultDetails", vaultAddress: hlpVault });

  // Sort by equity and take top 30 as candidates
  const candidates = vaultDetails.followers
    .sort((a, b) => parseFloat(b.vaultEquity) - parseFloat(a.vaultEquity))
    .slice(0, 30)
    .map((f) => f.user);

  console.log(`  Found ${vaultDetails.followers.length} HLP depositors`);
  console.log(`  Checking top ${candidates.length} by equity for active trading...\n`);

  // Check which ones are actively trading
  const activeTraders: string[] = [];
  for (const addr of candidates) {
    try {
      const state = await post<{
        assetPositions: unknown[];
        marginSummary: { accountValue: string };
      }>({ type: "clearinghouseState", user: addr });

      if (state.assetPositions.length > 0) {
        activeTraders.push(addr);
        console.log(
          `  ACTIVE: ${addr.slice(0, 12)}... | AcctValue: $${parseFloat(state.marginSummary.accountValue).toLocaleString()} | Positions: ${state.assetPositions.length}`
        );
      }
    } catch {
      // skip
    }
  }

  console.log(`\n  Active traders found: ${activeTraders.length}\n`);
  return activeTraders;
}

// ─── Step 2: Fetch full trader snapshot ───

interface TraderSnapshot {
  address: string;
  accountValue: number;
  positions: {
    coin: string;
    side: "LONG" | "SHORT";
    size: number;
    sizeUsd: number;
    entryPrice: number;
    leverage: number;
    unrealizedPnl: number;
    roe: number;
    liquidationPrice: number | null;
  }[];
  stats: {
    perpAllTimePnl: number;
    perpAllTimeVolume: number;
    perpMonthPnl: number;
    perpMonthVolume: number;
    perpWeekPnl: number;
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

async function fetchTraderSnapshot(address: string): Promise<TraderSnapshot> {
  const [state, portfolio, fills] = await Promise.all([
    post<{
      assetPositions: {
        position: {
          coin: string;
          szi: string;
          entryPx: string;
          leverage: { value: number };
          unrealizedPnl: string;
          returnOnEquity: string;
          positionValue: string;
          liquidationPx: string | null;
        };
      }[];
      marginSummary: { accountValue: string };
    }>({ type: "clearinghouseState", user: address }),

    post<
      [
        string,
        {
          pnlHistory: [number, string][];
          vlm: string;
        },
      ][]
    >({ type: "portfolio", user: address }),

    post<
      {
        coin: string;
        side: string;
        sz: string;
        px: string;
        closedPnl: string;
        time: number;
      }[]
    >({ type: "userFills", user: address }),
  ]);

  const positions = state.assetPositions.map((ap) => {
    const p = ap.position;
    const szi = parseFloat(p.szi);
    return {
      coin: p.coin,
      side: (szi > 0 ? "LONG" : "SHORT") as "LONG" | "SHORT",
      size: Math.abs(szi),
      sizeUsd: parseFloat(p.positionValue),
      entryPrice: parseFloat(p.entryPx),
      leverage: p.leverage.value,
      unrealizedPnl: parseFloat(p.unrealizedPnl),
      roe: parseFloat(p.returnOnEquity),
      liquidationPrice: p.liquidationPx ? parseFloat(p.liquidationPx) : null,
    };
  });

  const getTimeframeData = (tf: string) => {
    const entry = portfolio.find(([name]) => name === tf);
    if (!entry) return { pnl: 0, vol: 0 };
    const pnlHist = entry[1].pnlHistory;
    return {
      pnl: pnlHist.length > 0 ? parseFloat(pnlHist[pnlHist.length - 1][1]) : 0,
      vol: parseFloat(entry[1].vlm),
    };
  };

  const allTime = getTimeframeData("perpAllTime");
  const month = getTimeframeData("perpMonth");
  const week = getTimeframeData("perpWeek");

  const recentTrades = fills.slice(0, 20).map((f) => ({
    coin: f.coin,
    side: (f.side === "A" ? "BUY" : "SELL") as "BUY" | "SELL",
    size: f.sz,
    price: f.px,
    closedPnl: parseFloat(f.closedPnl),
    time: new Date(f.time).toISOString(),
  }));

  return {
    address,
    accountValue: parseFloat(state.marginSummary.accountValue),
    positions,
    stats: {
      perpAllTimePnl: allTime.pnl,
      perpAllTimeVolume: allTime.vol,
      perpMonthPnl: month.pnl,
      perpMonthVolume: month.vol,
      perpWeekPnl: week.pnl,
    },
    recentTrades,
  };
}

// ─── Step 3: Analyze and rank traders ───

function analyzeTrader(snapshot: TraderSnapshot) {
  const { stats, recentTrades } = snapshot;

  // Calculate win rate from recent trades
  const closedTrades = recentTrades.filter((t) => t.closedPnl !== 0);
  const wins = closedTrades.filter((t) => t.closedPnl > 0).length;
  const winRate = closedTrades.length > 0 ? wins / closedTrades.length : 0;

  // Profit factor
  const grossProfit = closedTrades
    .filter((t) => t.closedPnl > 0)
    .reduce((sum, t) => sum + t.closedPnl, 0);
  const grossLoss = Math.abs(
    closedTrades
      .filter((t) => t.closedPnl < 0)
      .reduce((sum, t) => sum + t.closedPnl, 0)
  );
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  // Average leverage
  const avgLeverage =
    snapshot.positions.length > 0
      ? snapshot.positions.reduce((s, p) => s + p.leverage, 0) / snapshot.positions.length
      : 0;

  // Total position value
  const totalPositionValue = snapshot.positions.reduce((s, p) => s + p.sizeUsd, 0);

  return {
    ...snapshot,
    analysis: {
      winRate,
      profitFactor,
      avgLeverage,
      totalPositionValue,
      closedTradesCount: closedTrades.length,
    },
  };
}

// ─── Main ───

async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║   Hyperliquid Trader Discovery & Analysis       ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  // Step 1: Discover
  const activeAddresses = await discoverTraders();

  if (activeAddresses.length === 0) {
    // Fallback to known active address
    console.log("  Using fallback known active trader address\n");
    activeAddresses.push("0x6417da1d2452a4b4a81aa151b7235ffec865082f");
  }

  // Step 2: Fetch full snapshots
  console.log("STEP 2: Fetching full trader snapshots...\n");
  const snapshots: TraderSnapshot[] = [];
  for (const addr of activeAddresses) {
    try {
      const snapshot = await fetchTraderSnapshot(addr);
      snapshots.push(snapshot);
      console.log(`  Fetched: ${addr.slice(0, 12)}... | $${snapshot.accountValue.toLocaleString()} | ${snapshot.positions.length} positions | ${snapshot.recentTrades.length} recent trades`);
    } catch (e) {
      console.log(`  Failed: ${addr.slice(0, 12)}... - ${(e as Error).message.slice(0, 50)}`);
    }
  }

  // Step 3: Analyze
  console.log("\n\nSTEP 3: Trader Analysis\n");
  console.log("═".repeat(90));

  const analyzed = snapshots.map(analyzeTrader);

  for (const trader of analyzed) {
    const a = trader.analysis;
    console.log(`\nTrader: ${trader.address}`);
    console.log(`  Account Value:     $${trader.accountValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
    console.log(`  Total Position:    $${a.totalPositionValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
    console.log(`  AllTime Perp PnL:  $${trader.stats.perpAllTimePnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
    console.log(`  Month Perp PnL:    $${trader.stats.perpMonthPnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
    console.log(`  Week Perp PnL:     $${trader.stats.perpWeekPnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
    console.log(`  Month Volume:      $${trader.stats.perpMonthVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    console.log(`  Win Rate:          ${(a.winRate * 100).toFixed(1)}% (${a.closedTradesCount} trades)`);
    console.log(`  Profit Factor:     ${a.profitFactor === Infinity ? "∞" : a.profitFactor.toFixed(2)}`);
    console.log(`  Avg Leverage:      ${a.avgLeverage.toFixed(1)}x`);

    if (trader.positions.length > 0) {
      console.log(`  Open Positions:`);
      for (const p of trader.positions) {
        const liqStr = p.liquidationPrice ? `$${p.liquidationPrice.toLocaleString()}` : "N/A";
        console.log(
          `    ${p.coin.padEnd(8)} ${p.side.padEnd(5)} | $${p.sizeUsd.toLocaleString(undefined, { maximumFractionDigits: 0 }).padStart(12)} | ` +
          `${p.leverage}x | Entry: $${p.entryPrice.toLocaleString()} | uPnL: $${p.unrealizedPnl.toLocaleString(undefined, { maximumFractionDigits: 2 })} | ` +
          `ROE: ${(p.roe * 100).toFixed(1)}% | Liq: ${liqStr}`
        );
      }
    }

    if (trader.recentTrades.length > 0) {
      console.log(`  Last 5 Trades:`);
      for (const t of trader.recentTrades.slice(0, 5)) {
        console.log(
          `    ${t.time} | ${t.coin.padEnd(6)} ${t.side.padEnd(4)} ${t.size} @ $${t.price} | PnL: $${t.closedPnl.toFixed(2)}`
        );
      }
    }
  }

  console.log("\n" + "═".repeat(90));
  console.log(`\nTotal active traders analyzed: ${analyzed.length}`);
  console.log("Pipeline test complete.");
}

main().catch(console.error);
