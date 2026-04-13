/**
 * Signal Aggregator — clusters raw positions into actionable trading signals.
 *
 * The v2 engine keeps legacy scoring nested for compatibility, but the live
 * top-level fields now come from the v2 scoring layer.
 */

import type { PositionChange } from "@/lib/hyperliquid/tracker/types";
import type { PositionStore } from "../hyperliquid/tracker/store";
import { getPositionTimingKey } from "../hyperliquid/timing/state";
import type {
  PositionTimingConfidence,
  PositionTimingRecord,
  PositionTimingSource,
} from "../hyperliquid/timing/types";
import {
  appendSmiHistory,
  buildSignalSmi,
  type SignalSmiState,
  type SMIHistoryEntry,
} from "./smi";
import {
  buildLegacyScore,
  buildPositionWeight,
  classifyStrength,
  computeAlignmentBand,
  computeDominantSide,
  computeMarketAdjustment,
  computeScaleBonus,
  computeVelocityScore,
  mapAlignmentBandToLegacyType,
  roundTo,
  TIER_WEIGHT,
  type AlignmentBand,
  type SignalMarketContext,
  type SignalScoring,
  type SignalStrength,
  type SignalType,
} from "./v2";

export { appendSmiHistory };
export type { SignalSmiState };

export interface TraderPosition {
  address: string;
  tier: keyof typeof TIER_WEIGHT;
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
  accountValue?: number;
  openedAt: number | null;
  lastAddedAt: number | null;
  observedAt: number | null;
  timingSource: PositionTimingSource;
  timingConfidence: PositionTimingConfidence;
  preexisting: boolean;
}

export interface Signal {
  coin: string;
  type: SignalType;
  strength: SignalStrength;
  dominantSide: "LONG" | "SHORT" | "SPLIT";
  conviction: number;
  totalTraders: number;
  longTraders: number;
  shortTraders: number;
  totalValueUsd: number;
  longValueUsd: number;
  shortValueUsd: number;
  avgLeverage: number;
  avgEntryPx: number;
  totalUnrealizedPnl: number;
  sTierCount: number;
  aTierCount: number;
  positions: TraderPosition[];
  scoring?: SignalScoring;
  smi?: SignalSmiState;
  timestamp: number;
}

export interface AggregateSignalsOptions {
  marketByCoin?: Record<string, SignalMarketContext>;
  recentEvents?: PositionChange[];
  smiHistoryByCoin?: Record<string, SMIHistoryEntry[]>;
  now?: number;
}

interface GroupMetrics {
  longTraders: number;
  shortTraders: number;
  longValueUsd: number;
  shortValueUsd: number;
  totalValueUsd: number;
  sTierCount: number;
  aTierCount: number;
}

function toTraderPositions(
  store: PositionStore,
  timingRecords: Record<string, PositionTimingRecord>
) {
  const coinGroups = new Map<string, TraderPosition[]>();

  for (const trader of store.getAllPositions()) {
    for (const pos of trader.positions) {
      if (!coinGroups.has(pos.coin)) coinGroups.set(pos.coin, []);
      const timing = timingRecords[getPositionTimingKey(trader.address, pos.coin)];
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
        accountValue: trader.accountValue,
        openedAt: timing?.openedAt ?? null,
        lastAddedAt: timing?.lastAddedAt ?? null,
        observedAt: timing?.observedAt ?? null,
        timingSource: timing?.timingSource ?? "bootstrap",
        timingConfidence: timing?.timingConfidence ?? "low",
        preexisting: timing?.preexisting ?? true,
      });
    }
  }

  return coinGroups;
}

function computeGroupMetrics(positions: TraderPosition[]): GroupMetrics {
  const longs = positions.filter((position) => position.side === "LONG");
  const shorts = positions.filter((position) => position.side === "SHORT");
  const longValueUsd = longs.reduce((sum, position) => sum + position.sizeUsd, 0);
  const shortValueUsd = shorts.reduce((sum, position) => sum + position.sizeUsd, 0);
  return {
    longTraders: longs.length,
    shortTraders: shorts.length,
    longValueUsd,
    shortValueUsd,
    totalValueUsd: longValueUsd + shortValueUsd,
    sTierCount: positions.filter((position) => position.tier === "S").length,
    aTierCount: positions.filter((position) => position.tier === "A").length,
  };
}

function computeV2Scoring(params: {
  positions: TraderPosition[];
  metrics: GroupMetrics;
  market: SignalMarketContext | null | undefined;
  recentEvents: PositionChange[];
  now: number;
  coin: string;
}) {
  let weightedLongCounts = 0;
  let weightedShortCounts = 0;
  let weightedLongValue = 0;
  let weightedShortValue = 0;
  let sTierLongCount = 0;
  let sTierShortCount = 0;
  let sTierLongValue = 0;
  let sTierShortValue = 0;
  let weightedParticipation = 0;
  const concentrationValues: number[] = [];

  for (const position of params.positions) {
    const weights = buildPositionWeight(position, params.now);
    if (position.side === "LONG") {
      weightedLongCounts += weights.countWeight;
      weightedLongValue += weights.valueWeight;
      if (position.tier === "S") {
        sTierLongCount += 1;
        sTierLongValue += weights.sTierValueWeight;
      }
    } else {
      weightedShortCounts += weights.countWeight;
      weightedShortValue += weights.valueWeight;
      if (position.tier === "S") {
        sTierShortCount += 1;
        sTierShortValue += weights.sTierValueWeight;
      }
    }

    weightedParticipation += weights.tier * weights.freshness * weights.confidence;
    concentrationValues.push(
      (position.accountValue ?? 0) > 0
        ? position.marginUsed / (position.accountValue ?? 0)
        : 0
    );
  }

  const countTotal = weightedLongCounts + weightedShortCounts;
  const valueTotal = weightedLongValue + weightedShortValue;
  const countAlignment =
    countTotal > 0 ? Math.max(weightedLongCounts, weightedShortCounts) / countTotal : 0.5;
  const valueAlignment =
    valueTotal > 0 ? Math.max(weightedLongValue, weightedShortValue) / valueTotal : 0.5;
  const sTierCount = sTierLongCount + sTierShortCount;
  const sTierCountAlignment =
    sTierCount > 0 ? Math.max(sTierLongCount, sTierShortCount) / sTierCount : 0.5;
  const sTierValueTotal = sTierLongValue + sTierShortValue;
  const sTierValueAlignment =
    sTierValueTotal > 0
      ? Math.max(sTierLongValue, sTierShortValue) / sTierValueTotal
      : 0.5;
  const sTierAlignment = 0.4 * sTierCountAlignment + 0.6 * sTierValueAlignment;
  const rawConviction = Math.round(
    countAlignment * 40 + valueAlignment * 30 + sTierAlignment * 30
  );

  const alignmentBand = computeAlignmentBand(countAlignment);
  const dominantSide = computeDominantSide(
    weightedLongValue,
    weightedShortValue,
    alignmentBand
  );
  const marketAdjustment = computeMarketAdjustment({
    market: params.market,
    dominantSide,
  });
  const conviction = Math.round(
    Math.max(0, Math.min(100, rawConviction + marketAdjustment.score))
  );
  const velocity = computeVelocityScore({
    recentEvents: params.recentEvents,
    coin: params.coin,
    now: params.now,
  });

  const scaleScore =
    params.metrics.totalValueUsd >= 10_000_000
      ? 30
      : params.metrics.totalValueUsd >= 1_000_000
        ? 20
        : params.metrics.totalValueUsd >= 100_000
          ? 10
          : 5;
  const tierScore =
    params.metrics.sTierCount >= 5
      ? 30
      : params.metrics.sTierCount >= 3
        ? 25
        : params.metrics.sTierCount >= 1
          ? 15
          : params.metrics.aTierCount >= 3
            ? 10
            : 5;
  const convictionScore =
    conviction >= 80 ? 40 : conviction >= 65 ? 30 : conviction >= 50 ? 20 : 10;
  const velocityScore =
    velocity.score >= 80
      ? 20
      : velocity.score >= 60
        ? 15
        : velocity.score >= 40
          ? 10
          : velocity.eventCount > 0
            ? 5
            : 0;

  const totalScore =
    scaleScore + tierScore + convictionScore + velocityScore + marketAdjustment.score;
  return {
    conviction,
    rawConviction,
    type: mapAlignmentBandToLegacyType(alignmentBand),
    strength: classifyStrength(totalScore),
    dominantSide,
    alignmentBand,
    countAlignment: roundTo(countAlignment),
    valueAlignment: roundTo(valueAlignment),
    sTierAlignment: roundTo(sTierAlignment),
    freshnessWeightedLongs: roundTo(weightedLongCounts),
    freshnessWeightedShorts: roundTo(weightedShortCounts),
    effectiveTraders: roundTo(weightedParticipation / 5, 1),
    marketAdjustment: marketAdjustment.score,
    velocity,
    concentration: {
      average: roundTo(
        concentrationValues.length > 0
          ? concentrationValues.reduce((sum, value) => sum + value, 0) /
              concentrationValues.length
          : 0,
        4
      ),
      maximum: roundTo(Math.max(0, ...concentrationValues), 4),
      dominantAverage: roundTo(
        params.positions
          .filter((position) => position.side === dominantSide)
          .reduce(
            (sum, position, _, positions) =>
              positions.length === 0
                ? 0
                : sum +
                  ((position.accountValue ?? 0) > 0
                    ? position.marginUsed / ((position.accountValue ?? 0) || 1) / positions.length
                    : 0),
            0
          ),
        4
      ),
    },
    totalScore: Math.round(totalScore),
  };
}

export function aggregateSignals(
  store: PositionStore,
  timingRecords: Record<string, PositionTimingRecord> = {},
  options: AggregateSignalsOptions = {}
): Signal[] {
  const now = options.now ?? Date.now();
  const signals: Signal[] = [];
  const coinGroups = toTraderPositions(store, timingRecords);

  for (const [coin, positions] of coinGroups) {
    if (positions.length < 2) continue;

    const metrics = computeGroupMetrics(positions);
    const longRatio = metrics.longTraders / positions.length;
    const legacySCount = positions.filter((position) => position.tier === "S").length;
    const legacySTierAlignment =
      legacySCount > 0
        ? Math.max(
            positions.filter(
              (position) => position.tier === "S" && position.side === "LONG"
            ).length,
            positions.filter(
              (position) => position.tier === "S" && position.side === "SHORT"
            ).length
          ) / legacySCount
        : 0.5;

    const legacy = buildLegacyScore({
      countAlignment: Math.max(longRatio, metrics.shortTraders / positions.length),
      valueAlignment:
        metrics.totalValueUsd > 0
          ? Math.max(metrics.longValueUsd, metrics.shortValueUsd) /
            metrics.totalValueUsd
          : 0.5,
      sTierAlignment: legacySTierAlignment,
      totalValueUsd: metrics.totalValueUsd,
      sTierCount: metrics.sTierCount,
      aTierCount: metrics.aTierCount,
      longRatio,
      longValueUsd: metrics.longValueUsd,
      shortValueUsd: metrics.shortValueUsd,
    });

    const v2 = computeV2Scoring({
      positions,
      metrics,
      market: options.marketByCoin?.[coin] ?? null,
      recentEvents: options.recentEvents ?? [],
      now,
      coin,
    });

    const smi = buildSignalSmi({
      positions,
      market: options.marketByCoin?.[coin] ?? null,
      history: options.smiHistoryByCoin?.[coin] ?? [],
      timestamp: now,
    });

    const avgLeverage =
      positions.reduce((sum, position) => sum + position.leverage, 0) / positions.length;
    const dominantPositions =
      v2.dominantSide === "SPLIT"
        ? positions
        : positions.filter((position) => position.side === v2.dominantSide);
    const totalDominantSize = dominantPositions.reduce(
      (sum, position) => sum + position.sizeUsd,
      0
    );
    const avgEntryPx =
      totalDominantSize > 0
        ? dominantPositions.reduce(
            (sum, position) =>
              sum + position.entryPx * (position.sizeUsd / totalDominantSize),
            0
          )
        : 0;
    const totalPnl = positions.reduce(
      (sum, position) => sum + position.unrealizedPnl,
      0
    );

    positions.sort((left, right) => {
      const tierDiff = TIER_WEIGHT[right.tier] - TIER_WEIGHT[left.tier];
      if (tierDiff !== 0) return tierDiff;
      return right.sizeUsd - left.sizeUsd;
    });

    signals.push({
      coin,
      type: v2.type,
      strength: v2.strength,
      dominantSide: v2.dominantSide,
      conviction: v2.conviction,
      totalTraders: positions.length,
      longTraders: metrics.longTraders,
      shortTraders: metrics.shortTraders,
      totalValueUsd: metrics.totalValueUsd,
      longValueUsd: metrics.longValueUsd,
      shortValueUsd: metrics.shortValueUsd,
      avgLeverage: roundTo(avgLeverage, 1),
      avgEntryPx,
      totalUnrealizedPnl: totalPnl,
      sTierCount: metrics.sTierCount,
      aTierCount: metrics.aTierCount,
      positions,
      scoring: {
        legacy,
        v2,
      },
      smi,
      timestamp: now,
    });
  }

  signals.sort((left, right) => {
    const strengthOrder = { strong: 3, moderate: 2, weak: 1 };
    const strengthDiff = strengthOrder[right.strength] - strengthOrder[left.strength];
    if (strengthDiff !== 0) return strengthDiff;

    const leftScore =
      left.conviction +
      computeScaleBonus(left.totalValueUsd) +
      (left.scoring?.v2.velocity.score ?? 0) / 10;
    const rightScore =
      right.conviction +
      computeScaleBonus(right.totalValueUsd) +
      (right.scoring?.v2.velocity.score ?? 0) / 10;
    if (rightScore !== leftScore) return rightScore - leftScore;

    return right.totalValueUsd - left.totalValueUsd;
  });

  return signals;
}
