import type { ClearinghouseState } from "../types";
import type {
  TrackedTrader,
  TraderTier,
  TrackingMethod,
  PositionChange,
  PositionStoreStats,
} from "./types";
import { diffPositions } from "./differ";

export class PositionStore {
  // Primary index: address → trader state
  private traders = new Map<string, TrackedTrader>();
  // Secondary index: coin → set of trader addresses holding that coin
  private coinIndex = new Map<string, Set<string>>();
  // Recent changes ring buffer
  private recentChanges: PositionChange[] = [];
  private maxRecentChanges = 1000;

  // ─── Trader Management ──────────────────────────────

  addTrader(
    address: string,
    tier: TraderTier,
    score: number,
    method: TrackingMethod
  ) {
    const key = address.toLowerCase();
    if (!this.traders.has(key)) {
      this.traders.set(key, {
        address: key,
        tier,
        score,
        method,
        lastUpdated: 0,
        state: null,
        previousState: null,
      });
    }
  }

  removeTrader(address: string) {
    const key = address.toLowerCase();
    const trader = this.traders.get(key);
    if (!trader) return;

    // Remove from coin index
    if (trader.state) {
      for (const ap of trader.state.assetPositions) {
        const coin = ap.position.coin;
        this.coinIndex.get(coin)?.delete(key);
      }
    }
    this.traders.delete(key);
  }

  // ─── State Updates ──────────────────────────────────

  updateState(address: string, newState: ClearinghouseState): PositionChange[] {
    const key = address.toLowerCase();
    const trader = this.traders.get(key);
    if (!trader) return [];

    const prevState = trader.state;
    const changes = diffPositions(key, trader.tier, prevState, newState);

    // Update coin index
    if (prevState) {
      for (const ap of prevState.assetPositions) {
        this.coinIndex.get(ap.position.coin)?.delete(key);
      }
    }
    for (const ap of newState.assetPositions) {
      const coin = ap.position.coin;
      if (!this.coinIndex.has(coin)) this.coinIndex.set(coin, new Set());
      this.coinIndex.get(coin)!.add(key);
    }

    // Update trader state
    trader.previousState = prevState;
    trader.state = newState;
    trader.lastUpdated = Date.now();

    // Store recent changes
    for (const change of changes) {
      this.recentChanges.push(change);
      if (this.recentChanges.length > this.maxRecentChanges) {
        this.recentChanges.shift();
      }
    }

    return changes;
  }

  // ─── Queries ────────────────────────────────────────

  getTrader(address: string): TrackedTrader | undefined {
    return this.traders.get(address.toLowerCase());
  }

  getTradersByMethod(method: TrackingMethod): TrackedTrader[] {
    return [...this.traders.values()].filter((t) => t.method === method);
  }

  getTradersByCoin(coin: string): TrackedTrader[] {
    const addrs = this.coinIndex.get(coin);
    if (!addrs) return [];
    return [...addrs]
      .map((a) => this.traders.get(a)!)
      .filter(Boolean);
  }

  getRecentChanges(limit = 100): PositionChange[] {
    return this.recentChanges.slice(-limit);
  }

  getAllPositions(): {
    address: string;
    tier: TraderTier;
    positions: {
      coin: string;
      side: "LONG" | "SHORT";
      size: number;
      sizeUsd: number;
      leverage: number;
      leverageType: string;
      entryPx: number;
      liquidationPx: number | null;
      unrealizedPnl: number;
      returnOnEquity: number;
      marginUsed: number;
    }[];
  }[] {
    const result = [];
    for (const trader of this.traders.values()) {
      if (!trader.state || trader.state.assetPositions.length === 0) continue;
      result.push({
        address: trader.address,
        tier: trader.tier,
        positions: trader.state.assetPositions.map((ap) => {
          const p = ap.position;
          return {
            coin: p.coin,
            side: (parseFloat(p.szi) > 0 ? "LONG" : "SHORT") as "LONG" | "SHORT",
            size: Math.abs(parseFloat(p.szi)),
            sizeUsd: parseFloat(p.positionValue),
            leverage: p.leverage.value,
            leverageType: p.leverage.type,
            entryPx: parseFloat(p.entryPx),
            liquidationPx: p.liquidationPx ? parseFloat(p.liquidationPx) : null,
            unrealizedPnl: parseFloat(p.unrealizedPnl),
            returnOnEquity: parseFloat(p.returnOnEquity),
            marginUsed: parseFloat(p.marginUsed),
          };
        }),
      });
    }
    return result;
  }

  // ─── Stats ──────────────────────────────────────────

  getStats(): PositionStoreStats {
    let totalPositions = 0;
    let tradersWithPositions = 0;
    let wsTraders = 0;
    let pollTraders = 0;

    for (const t of this.traders.values()) {
      if (t.method === "websocket") wsTraders++;
      else pollTraders++;
      const posCount = t.state?.assetPositions.length ?? 0;
      totalPositions += posCount;
      if (posCount > 0) tradersWithPositions++;
    }

    return {
      totalTraders: this.traders.size,
      wsTraders,
      pollTraders,
      tradersWithPositions,
      totalPositions,
      uniqueCoins: this.coinIndex.size,
      recentChanges: this.recentChanges.length,
    };
  }
}
