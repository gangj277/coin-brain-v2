/**
 * Signal Aggregator — clusters raw positions into actionable trading signals.
 *
 * Two-pass pipeline:
 *  1) Per-coin v2 scoring (conviction, strength, velocity, market adjustment, concentration)
 *  2) Cross-sectional normalization (subtract market beta) + viability floors + trade-trigger composite
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
  applyViabilityFloor,
  buildLegacyScore,
  buildPositionWeight,
  classifyStrength,
  computeAlignmentBand,
  computeCrossSectionalAdjustment,
  computeDominantSide,
  computeMarketAdjustment,
  computeMarketBaseline,
  computeScaleBonus,
  computeTradeTriggerScore,
  computeVelocityScore,
  mapAlignmentBandToLegacyType,
  roundTo,
  TIER_WEIGHT,
  type AlignmentBand,
  type CrossSectionalAdjustmentSummary,
  type MarketBaseline,
  type SignalMarketContext,
  type SignalScoring,
  type SignalScoringV2,
  type SignalStrength,
  type SignalType,
  type TradeTriggerBreakdown,
  type ViabilityAdjustmentSummary,
  type VelocitySummary,
  type ConcentrationSummary,
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
  sTierLongCount: number;
  sTierShortCount: number;
}

interface Pass1Result {
  coin: string;
  positions: TraderPosition[];
  metrics: GroupMetrics;
  legacy: ReturnType<typeof buildLegacyScore>;
  /** Intermediate v2 — not final (cross-sectional + viability + tradeTrigger applied in pass 2) */
  v2Draft: {
    rawConviction: number;
    alignmentBand: AlignmentBand;
    countAlignment: number;
    valueAlignment: number;
    sTierAlignment: number;
    freshnessWeightedLongs: number;
    freshnessWeightedShorts: number;
    effectiveTraders: number;
    marketAdjustment: number;
    velocity: VelocitySummary;
    concentration: ConcentrationSummary;
    dominantSide: "LONG" | "SHORT" | "SPLIT";
    weightedLongValue: number;
    weightedShortValue: number;
    scaleScore: number;
    tierScore: number;
    convictionScoreSub: number;
    velocityScoreSub: number;
  };
  smi: SignalSmiState;
  avgLeverage: number;
  avgEntryPx: number;
  totalPnl: number;
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
    sTierLongCount: positions.filter(
      (position) => position.tier === "S" && position.side === "LONG"
    ).length,
    sTierShortCount: positions.filter(
      (position) => position.tier === "S" && position.side === "SHORT"
    ).length,
  };
}

function computePass1(params: {
  positions: TraderPosition[];
  metrics: GroupMetrics;
  market: SignalMarketContext | null | undefined;
  recentEvents: PositionChange[];
  now: number;
  coin: string;
}): Pass1Result["v2Draft"] {
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

  const provisionalConviction = Math.max(
    0,
    Math.min(100, rawConviction + marketAdjustment.score)
  );
  const convictionScoreSub =
    provisionalConviction >= 80
      ? 40
      : provisionalConviction >= 65
        ? 30
        : provisionalConviction >= 50
          ? 20
          : 10;
  const velocityScoreSub =
    velocity.score >= 80
      ? 20
      : velocity.score >= 60
        ? 15
        : velocity.score >= 40
          ? 10
          : velocity.eventCount > 0
            ? 5
            : 0;

  return {
    rawConviction,
    alignmentBand,
    countAlignment,
    valueAlignment,
    sTierAlignment,
    freshnessWeightedLongs: weightedLongCounts,
    freshnessWeightedShorts: weightedShortCounts,
    effectiveTraders: weightedParticipation / 5,
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
        (() => {
          const dominants = params.positions.filter(
            (position) => position.side === dominantSide
          );
          if (dominants.length === 0) return 0;
          return (
            dominants.reduce(
              (sum, position) =>
                sum +
                ((position.accountValue ?? 0) > 0
                  ? position.marginUsed / (position.accountValue ?? 0)
                  : 0),
              0
            ) / dominants.length
          );
        })(),
        4
      ),
    },
    dominantSide,
    weightedLongValue,
    weightedShortValue,
    scaleScore,
    tierScore,
    convictionScoreSub,
    velocityScoreSub,
  };
}

function finalizeV2(params: {
  pass1: Pass1Result["v2Draft"];
  metrics: GroupMetrics;
  baseline: MarketBaseline;
  smi: SignalSmiState | null;
}): SignalScoringV2 {
  const {
    pass1,
    metrics,
    baseline,
    smi,
  } = params;

  // Cross-sectional adjustment — subtract market beta from conviction
  const crossSectional = computeCrossSectionalAdjustment({
    dominantSide: pass1.dominantSide,
    baseline,
  });

  // Final conviction: raw + market regime + cross-sectional beta normalization
  const conviction = Math.round(
    Math.max(
      0,
      Math.min(
        100,
        pass1.rawConviction + pass1.marketAdjustment + crossSectional.score
      )
    )
  );

  // Recompute conviction sub-score after adjustments
  const adjustedConvictionScore =
    conviction >= 80 ? 40 : conviction >= 65 ? 30 : conviction >= 50 ? 20 : 10;

  const rawTotalScore =
    pass1.scaleScore +
    pass1.tierScore +
    adjustedConvictionScore +
    pass1.velocityScoreSub +
    pass1.marketAdjustment +
    crossSectional.score;

  const provisionalStrength = classifyStrength(rawTotalScore);

  // Viability floor
  const viability = applyViabilityFloor({
    strength: provisionalStrength,
    totalTraders: metrics.longTraders + metrics.shortTraders,
    sTierCount: metrics.sTierCount,
    totalValueUsd: metrics.totalValueUsd,
  });

  // Trade-trigger composite
  const tradeTrigger: TradeTriggerBreakdown = computeTradeTriggerScore({
    v2TotalScore: rawTotalScore,
    strength: viability.strength,
    alignmentBand: pass1.alignmentBand,
    dominantSide: pass1.dominantSide,
    conviction,
    velocity: pass1.velocity,
    crossSectional,
    viability: viability.summary,
    smi: smi
      ? {
          signal: smi.signal,
          confirmed: smi.confirmed,
          confidence: smi.confidence,
        }
      : null,
    marketAdjustment: pass1.marketAdjustment,
    totalValueUsd: metrics.totalValueUsd,
    sTierCount: metrics.sTierCount,
  });

  return {
    conviction,
    rawConviction: pass1.rawConviction,
    type: mapAlignmentBandToLegacyType(pass1.alignmentBand),
    strength: viability.strength,
    dominantSide: pass1.dominantSide,
    alignmentBand: pass1.alignmentBand,
    countAlignment: roundTo(pass1.countAlignment),
    valueAlignment: roundTo(pass1.valueAlignment),
    sTierAlignment: roundTo(pass1.sTierAlignment),
    freshnessWeightedLongs: roundTo(pass1.freshnessWeightedLongs),
    freshnessWeightedShorts: roundTo(pass1.freshnessWeightedShorts),
    effectiveTraders: roundTo(pass1.effectiveTraders, 1),
    marketAdjustment: pass1.marketAdjustment,
    velocity: pass1.velocity,
    concentration: pass1.concentration,
    crossSectional,
    viability: viability.summary,
    tradeTrigger,
    totalScore: Math.round(rawTotalScore),
  };
}

export function aggregateSignals(
  store: PositionStore,
  timingRecords: Record<string, PositionTimingRecord> = {},
  options: AggregateSignalsOptions = {}
): Signal[] {
  const now = options.now ?? Date.now();
  const coinGroups = toTraderPositions(store, timingRecords);

  // ── PASS 1: per-coin scoring ──────────────────────────────
  const pass1Results: Pass1Result[] = [];
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

    const v2Draft = computePass1({
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
      v2Draft.dominantSide === "SPLIT"
        ? positions
        : positions.filter((position) => position.side === v2Draft.dominantSide);
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

    pass1Results.push({
      coin,
      positions,
      metrics,
      legacy,
      v2Draft,
      smi,
      avgLeverage,
      avgEntryPx,
      totalPnl,
    });
  }

  // ── Compute market baseline for cross-sectional normalization ────
  const baseline = computeMarketBaseline(
    pass1Results.map((result) => ({
      coin: result.coin,
      dominantSide: result.v2Draft.dominantSide,
      sTierCount: result.metrics.sTierCount,
      sTierDominantCount:
        result.v2Draft.dominantSide === "LONG"
          ? result.metrics.sTierLongCount
          : result.v2Draft.dominantSide === "SHORT"
            ? result.metrics.sTierShortCount
            : 0,
      totalValueUsd: result.metrics.totalValueUsd,
      dominantValueUsd:
        result.v2Draft.dominantSide === "LONG"
          ? result.metrics.longValueUsd
          : result.v2Draft.dominantSide === "SHORT"
            ? result.metrics.shortValueUsd
            : 0,
    }))
  );

  // ── PASS 2: finalize with cross-sectional + viability + trade trigger ────
  const signals: Signal[] = [];
  for (const result of pass1Results) {
    const v2 = finalizeV2({
      pass1: result.v2Draft,
      metrics: result.metrics,
      baseline,
      smi: result.smi,
    });

    result.positions.sort((left, right) => {
      const tierDiff = TIER_WEIGHT[right.tier] - TIER_WEIGHT[left.tier];
      if (tierDiff !== 0) return tierDiff;
      return right.sizeUsd - left.sizeUsd;
    });

    signals.push({
      coin: result.coin,
      type: v2.type,
      strength: v2.strength,
      dominantSide: v2.dominantSide,
      conviction: v2.conviction,
      totalTraders: result.positions.length,
      longTraders: result.metrics.longTraders,
      shortTraders: result.metrics.shortTraders,
      totalValueUsd: result.metrics.totalValueUsd,
      longValueUsd: result.metrics.longValueUsd,
      shortValueUsd: result.metrics.shortValueUsd,
      avgLeverage: roundTo(result.avgLeverage, 1),
      avgEntryPx: result.avgEntryPx,
      totalUnrealizedPnl: result.totalPnl,
      sTierCount: result.metrics.sTierCount,
      aTierCount: result.metrics.aTierCount,
      positions: result.positions,
      scoring: {
        legacy: result.legacy,
        v2,
      },
      smi: result.smi,
      timestamp: now,
    });
  }

  signals.sort((left, right) => {
    const strengthOrder = { strong: 3, moderate: 2, weak: 1 };
    const strengthDiff = strengthOrder[right.strength] - strengthOrder[left.strength];
    if (strengthDiff !== 0) return strengthDiff;

    // Primary sort: trade trigger score
    const leftTrig = left.scoring?.v2.tradeTrigger.score ?? 0;
    const rightTrig = right.scoring?.v2.tradeTrigger.score ?? 0;
    if (rightTrig !== leftTrig) return rightTrig - leftTrig;

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
