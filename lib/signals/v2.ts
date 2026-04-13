import type { PositionChange, TraderTier } from "@/lib/hyperliquid/tracker/types";

export type SignalStrength = "strong" | "moderate" | "weak";
export type SignalType = "consensus" | "divergence" | "emerging";
export type AlignmentBand =
  | "consensus"
  | "near_consensus"
  | "divergence"
  | "counter_consensus";

export interface SignalMarketContext {
  markPx: number;
  prevDayPx: number;
  dayChange: number;
  funding: number;
  fundingAnnual: number;
  openInterest: number;
  openInterestUsd: number;
  dayVolume: number;
}

export interface SignalPositionInput {
  address: string;
  tier: TraderTier;
  side: "LONG" | "SHORT";
  sizeUsd: number;
  leverage: number;
  marginUsed: number;
  accountValue?: number;
  openedAt: number | null;
  lastAddedAt: number | null;
  timingConfidence: "high" | "medium" | "low";
  preexisting: boolean;
}

export interface VelocitySummary {
  dominantSide: "LONG" | "SHORT" | "SPLIT";
  score: number;
  rawScore: number;
  longScore: number;
  shortScore: number;
  eventCount: number;
}

export interface MarketAdjustmentSummary {
  score: number;
  fundingPenalty: number;
  contrarianBonus: number;
  extensionPenalty: number;
}

export interface ConcentrationSummary {
  average: number;
  maximum: number;
  dominantAverage: number;
}

export interface SignalScoringLegacy {
  conviction: number;
  type: SignalType;
  strength: SignalStrength;
  dominantSide: "LONG" | "SHORT" | "SPLIT";
  countAlignment: number;
  valueAlignment: number;
  sTierAlignment: number;
  totalScore: number;
}

export interface SignalScoringV2 {
  conviction: number;
  rawConviction: number;
  type: SignalType;
  strength: SignalStrength;
  dominantSide: "LONG" | "SHORT" | "SPLIT";
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
  totalScore: number;
}

export interface SignalScoring {
  legacy: SignalScoringLegacy;
  v2: SignalScoringV2;
}

export const TIER_WEIGHT: Record<TraderTier, number> = {
  S: 5,
  A: 3,
  B: 1.5,
  C: 1,
  D: 0.5,
};

const TIMING_CONFIDENCE_WEIGHT = {
  high: 1,
  medium: 0.7,
  low: 0.4,
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const HALF_LIFE_MS = DAY_MS;
const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_FRESHNESS_WEIGHT = 0.3;

const EVENT_WEIGHT = {
  position_opened: 1,
  position_increased: 0.6,
  position_flipped: 1.5,
} as const;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function roundTo(value: number, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function computeFreshnessWeight(
  position: Pick<SignalPositionInput, "openedAt" | "lastAddedAt">,
  now: number
) {
  const reference = position.openedAt ?? position.lastAddedAt;
  if (!reference) return DEFAULT_FRESHNESS_WEIGHT;
  const ageMs = Math.max(0, now - reference);
  return roundTo(0.5 ** (ageMs / HALF_LIFE_MS), 4);
}

export function computeConfidenceWeight(
  confidence: SignalPositionInput["timingConfidence"]
) {
  return TIMING_CONFIDENCE_WEIGHT[confidence];
}

export function computeLeverageFactor(leverage: number) {
  return roundTo(
    Math.min(1.85, 1 + 0.15 * Math.log2(Math.max(leverage, 1))),
    4
  );
}

export function computeConcentrationFactor(
  marginUsed: number,
  accountValue: number
) {
  if (accountValue <= 0) return 1;
  const concentration = Math.min(marginUsed / accountValue, 0.5);
  return roundTo(1 + 2 * concentration, 4);
}

export function computeAlignmentBand(countAlignment: number): AlignmentBand {
  if (countAlignment >= 0.7) return "consensus";
  if (countAlignment >= 0.6) return "near_consensus";
  if (countAlignment > 0.4) return "divergence";
  return "counter_consensus";
}

export function mapAlignmentBandToLegacyType(
  alignmentBand: AlignmentBand
): SignalType {
  if (alignmentBand === "consensus") return "consensus";
  if (alignmentBand === "divergence") return "divergence";
  return "emerging";
}

export function computeDominantSide(
  longScore: number,
  shortScore: number,
  alignmentBand: AlignmentBand
): "LONG" | "SHORT" | "SPLIT" {
  if (alignmentBand === "divergence") return "SPLIT";
  return longScore >= shortScore ? "LONG" : "SHORT";
}

export function classifyStrength(totalScore: number): SignalStrength {
  if (totalScore >= 75) return "strong";
  if (totalScore >= 50) return "moderate";
  return "weak";
}

export function buildLegacyScore(params: {
  countAlignment: number;
  valueAlignment: number;
  sTierAlignment: number;
  totalValueUsd: number;
  sTierCount: number;
  aTierCount: number;
  longRatio: number;
  longValueUsd: number;
  shortValueUsd: number;
}): SignalScoringLegacy {
  const conviction = Math.round(
    params.countAlignment * 40 +
      params.valueAlignment * 30 +
      params.sTierAlignment * 30
  );
  const type =
    params.countAlignment >= 0.7
      ? "consensus"
      : params.countAlignment <= 0.65 && params.countAlignment >= 0.35
        ? "divergence"
        : "emerging";
  const dominantSide =
    type === "consensus"
      ? params.longRatio >= 0.7
        ? "LONG"
        : "SHORT"
      : type === "divergence"
        ? "SPLIT"
        : params.longValueUsd >= params.shortValueUsd
          ? "LONG"
          : "SHORT";

  const scaleScore =
    params.totalValueUsd >= 10_000_000
      ? 30
      : params.totalValueUsd >= 1_000_000
        ? 20
        : params.totalValueUsd >= 100_000
          ? 10
          : 5;
  const tierScore =
    params.sTierCount >= 5
      ? 30
      : params.sTierCount >= 3
        ? 25
        : params.sTierCount >= 1
          ? 15
          : params.aTierCount >= 3
            ? 10
            : 5;
  const convictionScore =
    conviction >= 80 ? 40 : conviction >= 65 ? 30 : conviction >= 50 ? 20 : 10;
  const totalScore = scaleScore + tierScore + convictionScore;

  return {
    conviction,
    type,
    strength: classifyStrength(totalScore),
    dominantSide,
    countAlignment: roundTo(params.countAlignment),
    valueAlignment: roundTo(params.valueAlignment),
    sTierAlignment: roundTo(params.sTierAlignment),
    totalScore,
  };
}

export function buildPositionWeight(
  position: SignalPositionInput,
  now: number
) {
  const freshness = computeFreshnessWeight(position, now);
  const confidence = computeConfidenceWeight(position.timingConfidence);
  const leverage = computeLeverageFactor(position.leverage);
  const concentration = computeConcentrationFactor(
    position.marginUsed,
    position.accountValue ?? 0
  );
  const tier = TIER_WEIGHT[position.tier];

  return {
    freshness,
    confidence,
    leverage,
    concentration,
    tier,
    countWeight: tier * freshness * confidence * leverage * concentration,
    valueWeight:
      position.sizeUsd *
      freshness *
      confidence *
      leverage *
      concentration *
      tier,
    sTierValueWeight:
      position.tier === "S"
        ? position.sizeUsd * freshness * confidence * leverage * concentration
        : 0,
  };
}

export function computeMarketAdjustment(params: {
  market: SignalMarketContext | null | undefined;
  dominantSide: "LONG" | "SHORT" | "SPLIT";
}): MarketAdjustmentSummary {
  if (!params.market || params.dominantSide === "SPLIT") {
    return {
      score: 0,
      fundingPenalty: 0,
      contrarianBonus: 0,
      extensionPenalty: 0,
    };
  }

  const { funding, dayChange } = params.market;
  let fundingPenalty = 0;
  let contrarianBonus = 0;
  let extensionPenalty = 0;

  if (params.dominantSide === "LONG" && funding > 0.0001) {
    fundingPenalty = -5 * (funding / 0.0001);
  }
  if (params.dominantSide === "SHORT" && funding < -0.0001) {
    fundingPenalty = -5 * (Math.abs(funding) / 0.0001);
  }

  if (params.dominantSide === "LONG" && funding < -0.00005) {
    contrarianBonus = 10;
  }
  if (params.dominantSide === "SHORT" && funding > 0.00005) {
    contrarianBonus = 10;
  }

  if (params.dominantSide === "LONG" && dayChange > 10) {
    extensionPenalty = -10;
  }
  if (params.dominantSide === "SHORT" && dayChange < -10) {
    extensionPenalty = -10;
  }

  return {
    score: roundTo(fundingPenalty + contrarianBonus + extensionPenalty),
    fundingPenalty: roundTo(fundingPenalty),
    contrarianBonus: roundTo(contrarianBonus),
    extensionPenalty: roundTo(extensionPenalty),
  };
}

function getEventResultingSide(
  event: PositionChange
): "LONG" | "SHORT" | null {
  if (!event.current) return null;
  return event.current.szi >= 0 ? "LONG" : "SHORT";
}

export function computeVelocityScore(params: {
  recentEvents: PositionChange[];
  coin: string;
  now: number;
}): VelocitySummary {
  const relevant = params.recentEvents.filter(
    (event) =>
      event.coin === params.coin &&
      event.type in EVENT_WEIGHT &&
      getEventResultingSide(event) !== null
  );

  let longScore = 0;
  let shortScore = 0;
  for (const event of relevant) {
    const eventWeight =
      EVENT_WEIGHT[event.type as keyof typeof EVENT_WEIGHT] ?? 0;
    const side = getEventResultingSide(event);
    if (!side) continue;
    const ageMs = Math.max(0, params.now - event.timestamp);
    const recency = 0.5 ** (ageMs / HOUR_MS);
    const tierWeight = TIER_WEIGHT[event.traderTier];
    const magnitude =
      event.type === "position_increased" && event.previous && event.current
        ? Math.max(
            1,
            Math.abs(event.current.positionValueUsd - event.previous.positionValueUsd) /
              10_000
          )
        : Math.max(1, Math.abs(event.current?.positionValueUsd ?? 0) / 10_000);
    const contribution = eventWeight * tierWeight * recency * Math.min(4, magnitude);
    if (side === "LONG") {
      longScore += contribution;
    } else {
      shortScore += contribution;
    }
  }

  const total = longScore + shortScore;
  const dominant = Math.max(longScore, shortScore);
  return {
    dominantSide:
      total === 0 ? "SPLIT" : longScore === shortScore ? "SPLIT" : longScore > shortScore ? "LONG" : "SHORT",
    score: total === 0 ? 0 : Math.round(clamp((dominant / total) * 100, 0, 100)),
    rawScore: roundTo(longScore - shortScore),
    longScore: roundTo(longScore),
    shortScore: roundTo(shortScore),
    eventCount: relevant.length,
  };
}

export function computeScaleBonus(valueUsd: number) {
  if (valueUsd >= 10_000_000) return 30;
  if (valueUsd >= 1_000_000) return 20;
  if (valueUsd >= 100_000) return 10;
  return 0;
}
