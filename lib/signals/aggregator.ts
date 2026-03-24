/**
 * Signal Aggregator — clusters raw positions into actionable trading signals.
 *
 * Takes 600+ raw positions from 60+ traders and produces ~10-20 meaningful
 * signals like "BTC LONG consensus (12 S-tier traders, $45M combined)".
 */

import type { PositionStore } from "../hyperliquid/tracker/store";
import type { TraderTier } from "../hyperliquid/tracker/types";

// ─── Types ───────────────────────────────────────────────

export type SignalStrength = "strong" | "moderate" | "weak";
export type SignalType = "consensus" | "divergence" | "emerging";

export interface TraderPosition {
  address: string;
  tier: TraderTier;
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
}

export interface Signal {
  coin: string;
  type: SignalType;
  strength: SignalStrength;
  dominantSide: "LONG" | "SHORT" | "SPLIT";
  conviction: number; // 0-100: how aligned are traders? 100 = everyone agrees
  // Aggregated stats
  totalTraders: number;
  longTraders: number;
  shortTraders: number;
  totalValueUsd: number;
  longValueUsd: number;
  shortValueUsd: number;
  avgLeverage: number;
  avgEntryPx: number;
  totalUnrealizedPnl: number;
  // Tier breakdown
  sTierCount: number;
  aTierCount: number;
  // All individual positions (for drill-down)
  positions: TraderPosition[];
  // Metadata
  timestamp: number;
}

// ─── Aggregation Logic ───────────────────────────────────

const TIER_WEIGHT: Record<TraderTier, number> = {
  S: 5, A: 3, B: 1.5, C: 1, D: 0.5,
};

export function aggregateSignals(store: PositionStore): Signal[] {
  const allPositions = store.getAllPositions();

  // Group by coin
  const coinGroups = new Map<string, TraderPosition[]>();

  for (const trader of allPositions) {
    for (const pos of trader.positions) {
      if (!coinGroups.has(pos.coin)) coinGroups.set(pos.coin, []);
      coinGroups.get(pos.coin)!.push({
        address: trader.address,
        tier: trader.tier,
        side: pos.side,
        size: pos.size,
        sizeUsd: pos.sizeUsd,
        leverage: pos.leverage,
        leverageType: pos.leverageType,
        entryPx: pos.entryPx,
        liquidationPx: pos.liquidationPx,
        unrealizedPnl: pos.unrealizedPnl,
        returnOnEquity: pos.returnOnEquity,
        marginUsed: pos.marginUsed,
      });
    }
  }

  // Build signals for each coin
  const signals: Signal[] = [];

  for (const [coin, positions] of coinGroups) {
    if (positions.length < 2) continue; // skip single-trader coins

    const longs = positions.filter((p) => p.side === "LONG");
    const shorts = positions.filter((p) => p.side === "SHORT");
    const longValue = longs.reduce((s, p) => s + p.sizeUsd, 0);
    const shortValue = shorts.reduce((s, p) => s + p.sizeUsd, 0);
    const totalValue = longValue + shortValue;

    // ── Conviction: how aligned are traders? ──
    // Count-based alignment (what % of traders agree)
    const longRatio = longs.length / positions.length;
    const shortRatio = shorts.length / positions.length;
    const countAlignment = Math.max(longRatio, shortRatio); // 0.5 = split, 1.0 = unanimous

    // Value-based alignment (what % of capital agrees)
    const valueAlignment = totalValue > 0
      ? Math.max(longValue, shortValue) / totalValue
      : 0.5;

    // Tier-weighted alignment: do the BEST traders agree?
    const sTierLongs = positions.filter((p) => p.tier === "S" && p.side === "LONG").length;
    const sTierShorts = positions.filter((p) => p.tier === "S" && p.side === "SHORT").length;
    const sTierCount = sTierLongs + sTierShorts;
    const aTierCount = positions.filter((p) => p.tier === "A").length;
    const sTierAlignment = sTierCount > 0
      ? Math.max(sTierLongs, sTierShorts) / sTierCount
      : 0.5;

    // Conviction score (0-100)
    // Weighted: 40% count alignment + 30% value alignment + 30% S-tier alignment
    const conviction = Math.round(
      (countAlignment * 40 + valueAlignment * 30 + sTierAlignment * 30) * 100 / 100
    );

    // Determine signal type
    let type: SignalType;
    let dominantSide: "LONG" | "SHORT" | "SPLIT";

    if (countAlignment >= 0.7) {
      type = "consensus";
      dominantSide = longRatio >= 0.7 ? "LONG" : "SHORT";
    } else if (countAlignment <= 0.65 && countAlignment >= 0.35) {
      type = "divergence";
      dominantSide = "SPLIT";
    } else {
      type = "emerging";
      dominantSide = longValue > shortValue ? "LONG" : "SHORT";
    }

    // ── Strength: combines conviction + scale + tier quality ──
    // Scale factor: how much capital is involved
    const scaleScore = totalValue >= 10_000_000 ? 30
      : totalValue >= 1_000_000 ? 20
      : totalValue >= 100_000 ? 10 : 5;

    // Tier quality: S-tier presence matters
    const tierScore = sTierCount >= 5 ? 30
      : sTierCount >= 3 ? 25
      : sTierCount >= 1 ? 15
      : aTierCount >= 3 ? 10 : 5;

    // Conviction contribution (most important factor)
    const convictionScore = conviction >= 80 ? 40
      : conviction >= 65 ? 30
      : conviction >= 50 ? 20 : 10;

    const totalScore = scaleScore + tierScore + convictionScore;

    let strength: SignalStrength;
    if (totalScore >= 75) {
      strength = "strong";
    } else if (totalScore >= 50) {
      strength = "moderate";
    } else {
      strength = "weak";
    }

    const avgLeverage =
      positions.reduce((s, p) => s + p.leverage, 0) / positions.length;

    // Weighted average entry price (by dominant side)
    const dominantPositions =
      dominantSide === "SPLIT"
        ? positions
        : positions.filter((p) => p.side === dominantSide);
    const totalDominantSize = dominantPositions.reduce((s, p) => s + p.sizeUsd, 0);
    const avgEntryPx =
      totalDominantSize > 0
        ? dominantPositions.reduce(
            (s, p) => s + p.entryPx * (p.sizeUsd / totalDominantSize),
            0
          )
        : 0;

    const totalPnl = positions.reduce((s, p) => s + p.unrealizedPnl, 0);

    // Sort positions: S-tier first, then by size
    positions.sort((a, b) => {
      const tierDiff = TIER_WEIGHT[b.tier] - TIER_WEIGHT[a.tier];
      if (tierDiff !== 0) return tierDiff;
      return b.sizeUsd - a.sizeUsd;
    });

    signals.push({
      coin,
      type,
      strength,
      dominantSide,
      conviction,
      totalTraders: positions.length,
      longTraders: longs.length,
      shortTraders: shorts.length,
      totalValueUsd: totalValue,
      longValueUsd: longValue,
      shortValueUsd: shortValue,
      avgLeverage: Math.round(avgLeverage * 10) / 10,
      avgEntryPx,
      totalUnrealizedPnl: totalPnl,
      sTierCount,
      aTierCount,
      positions,
      timestamp: Date.now(),
    });
  }

  // Sort: strength first, then conviction, then value
  signals.sort((a, b) => {
    const strengthOrder = { strong: 3, moderate: 2, weak: 1 };
    const sDiff = strengthOrder[b.strength] - strengthOrder[a.strength];
    if (sDiff !== 0) return sDiff;
    const cDiff = b.conviction - a.conviction;
    if (cDiff !== 0) return cDiff;
    return b.totalValueUsd - a.totalValueUsd;
  });

  return signals;
}
