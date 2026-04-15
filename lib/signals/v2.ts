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

export interface CrossSectionalAdjustmentSummary {
  /** market-wide directional tilt (-1 bearish … 1 bullish) */
  marketTilt: number;
  /** this coin's tilt on same scale */
  coinTilt: number;
  /** points added/subtracted to conviction based on idiosyncratic alpha */
  score: number;
  /** idiosyncratic alpha magnitude 0-100 — higher = more unique vs. market */
  idiosyncraticAlpha: number;
}

export interface ViabilityAdjustmentSummary {
  /** strength downgraded due to scale / trader-count / s-tier viability */
  downgraded: boolean;
  reason: string | null;
  scaleFloor: boolean;
  traderFloor: boolean;
  sTierFloor: boolean;
}

export interface TradeTriggerBreakdown {
  /** 0-100 composite — single source of truth for alert-worthiness */
  score: number;
  /** individual subcomponents for telemetry */
  coreQuality: number;
  idiosyncraticAlpha: number;
  smiAlignment: number;
  velocity: number;
  viabilityPenalty: number;
  gate: "pass" | "fail";
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
  crossSectional: CrossSectionalAdjustmentSummary;
  viability: ViabilityAdjustmentSummary;
  tradeTrigger: TradeTriggerBreakdown;
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

// ── Viability hard floors ───────────────────────────────────
// Signals below these can never be "strong" — filters statistical artifacts.
export const VIABILITY = {
  MIN_TOTAL_VALUE_FOR_STRONG: 1_000_000,
  MIN_TOTAL_VALUE_FOR_MODERATE: 200_000,
  MIN_TRADERS_FOR_STRONG: 5,
  MIN_S_TIER_FOR_STRONG: 2,
} as const;

// ── Trade trigger gate ──────────────────────────────────────
export const TRADE_TRIGGER_GATE = 75;

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

/**
 * Tightened strength thresholds.
 * Total score range with v2 factors: ~5-130.
 * Only top signals (bulk score + S-tier + conviction + velocity) qualify as strong.
 */
export function classifyStrength(totalScore: number): SignalStrength {
  if (totalScore >= 95) return "strong";
  if (totalScore >= 70) return "moderate";
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
    strength: totalScore >= 75 ? "strong" : totalScore >= 50 ? "moderate" : "weak",
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

// ─── NEW: Cross-sectional market beta normalization ──────────

export interface CrossSectionalInput {
  coin: string;
  dominantSide: "LONG" | "SHORT" | "SPLIT";
  sTierCount: number;
  /** sum of sTier counts on dominant side */
  sTierDominantCount: number;
  totalValueUsd: number;
  dominantValueUsd: number;
}

export interface MarketBaseline {
  marketTilt: number;
  totalSignals: number;
  longCount: number;
  shortCount: number;
}

export function computeMarketBaseline(
  signals: CrossSectionalInput[]
): MarketBaseline {
  const directional = signals.filter((s) => s.dominantSide !== "SPLIT");
  if (directional.length === 0) {
    return { marketTilt: 0, totalSignals: 0, longCount: 0, shortCount: 0 };
  }
  // Weight by sTier presence — market mode is what S-tiers as a whole are doing
  let longWeight = 0;
  let shortWeight = 0;
  for (const s of directional) {
    const w = 1 + s.sTierCount * 0.5;
    if (s.dominantSide === "LONG") longWeight += w;
    else shortWeight += w;
  }
  const total = longWeight + shortWeight;
  const tilt = total > 0 ? (longWeight - shortWeight) / total : 0;
  return {
    marketTilt: roundTo(tilt, 3),
    totalSignals: directional.length,
    longCount: directional.filter((s) => s.dominantSide === "LONG").length,
    shortCount: directional.filter((s) => s.dominantSide === "SHORT").length,
  };
}

/**
 * If the market is 70% short-tilted and this coin is also short, subtract beta.
 * If this coin is LONG against a SHORT market, add contrarian alpha.
 */
export function computeCrossSectionalAdjustment(params: {
  dominantSide: "LONG" | "SHORT" | "SPLIT";
  baseline: MarketBaseline;
}): CrossSectionalAdjustmentSummary {
  if (params.dominantSide === "SPLIT" || params.baseline.totalSignals === 0) {
    return { marketTilt: params.baseline.marketTilt, coinTilt: 0, score: 0, idiosyncraticAlpha: 0 };
  }
  const coinTilt = params.dominantSide === "LONG" ? 1 : -1;
  // Projection onto market tilt: +1 = fully aligned with market beta, -1 = fully against
  const beta = coinTilt * params.baseline.marketTilt;
  // Idiosyncratic component = 1 - |beta alignment|, scaled 0-100
  const idiosyncratic = roundTo(
    clamp((1 - Math.abs(beta)) * 100, 0, 100),
    1
  );
  // Penalty if aligned with beta (market-beta noise), bonus if contrarian
  // ±20 points max adjustment
  const score = roundTo(-beta * 20, 1);
  return {
    marketTilt: params.baseline.marketTilt,
    coinTilt,
    score,
    idiosyncraticAlpha: idiosyncratic,
  };
}

// ─── NEW: Viability floor ────────────────────────────────────

export function applyViabilityFloor(params: {
  strength: SignalStrength;
  totalTraders: number;
  sTierCount: number;
  totalValueUsd: number;
}): { strength: SignalStrength; summary: ViabilityAdjustmentSummary } {
  const reasons: string[] = [];

  // Flag every floor condition regardless of incoming strength so telemetry is accurate.
  const scaleFloorStrong =
    params.totalValueUsd < VIABILITY.MIN_TOTAL_VALUE_FOR_STRONG;
  const scaleFloorModerate =
    params.totalValueUsd < VIABILITY.MIN_TOTAL_VALUE_FOR_MODERATE;
  const traderFloor =
    params.totalTraders < VIABILITY.MIN_TRADERS_FOR_STRONG;
  const sTierFloor =
    params.sTierCount < VIABILITY.MIN_S_TIER_FOR_STRONG;

  let strength = params.strength;

  if (scaleFloorStrong && strength === "strong") {
    strength = "moderate";
    reasons.push(`scale<$1M`);
  }
  if (scaleFloorModerate && strength !== "weak") {
    strength = "weak";
    reasons.push(`scale<$200k`);
  }
  if (traderFloor && strength === "strong") {
    strength = "moderate";
    reasons.push(`traders<${VIABILITY.MIN_TRADERS_FOR_STRONG}`);
  }
  if (sTierFloor && strength === "strong") {
    strength = "moderate";
    reasons.push(`sTier<${VIABILITY.MIN_S_TIER_FOR_STRONG}`);
  }

  return {
    strength,
    summary: {
      downgraded: strength !== params.strength,
      reason: reasons.length > 0 ? reasons.join(", ") : null,
      scaleFloor: scaleFloorStrong || scaleFloorModerate,
      traderFloor,
      sTierFloor,
    },
  };
}

// ─── NEW: Trade-trigger composite ────────────────────────────

export interface TradeTriggerInput {
  v2TotalScore: number;
  strength: SignalStrength;
  alignmentBand: AlignmentBand;
  dominantSide: "LONG" | "SHORT" | "SPLIT";
  conviction: number;
  velocity: VelocitySummary;
  crossSectional: CrossSectionalAdjustmentSummary;
  viability: ViabilityAdjustmentSummary;
  smi: {
    signal: string;
    confirmed: boolean;
    confidence: "high" | "medium" | "low";
  } | null;
  marketAdjustment: number;
  totalValueUsd: number;
  sTierCount: number;
}

/**
 * Single 0-100 composite that is the sole gate for Telegram alerts.
 * Keeps signal surface to a small, high-conviction subset.
 */
export function computeTradeTriggerScore(
  input: TradeTriggerInput
): TradeTriggerBreakdown {
  // Instant fails — sub-viability signals cannot be triggers
  if (input.dominantSide === "SPLIT") {
    return {
      score: 0,
      coreQuality: 0,
      idiosyncraticAlpha: 0,
      smiAlignment: 0,
      velocity: 0,
      viabilityPenalty: 0,
      gate: "fail",
    };
  }
  if (input.strength === "weak") {
    return {
      score: 0,
      coreQuality: 0,
      idiosyncraticAlpha: 0,
      smiAlignment: 0,
      velocity: 0,
      viabilityPenalty: 0,
      gate: "fail",
    };
  }

  // Core quality: scaled v2 totalScore. Max 130 → max 40 pts.
  const coreQuality = clamp((input.v2TotalScore / 130) * 40, 0, 40);

  // Idiosyncratic alpha: 0-100 → 0-20 pts. Rewards signals that differ from market beta.
  const idioAlpha = clamp(
    (input.crossSectional.idiosyncraticAlpha / 100) * 20,
    0,
    20
  );

  // SMI alignment: up to 25. -10 if SMI confirmed in OPPOSITE direction.
  let smiAlignment = 0;
  if (input.smi) {
    const smiDir =
      input.smi.signal === "LONG" || input.smi.signal === "STRONG_LONG"
        ? "LONG"
        : input.smi.signal === "SHORT" || input.smi.signal === "STRONG_SHORT"
          ? "SHORT"
          : null;
    if (smiDir && smiDir === input.dominantSide) {
      smiAlignment = input.smi.confirmed ? 25 : 8;
      if (input.smi.confidence === "high") smiAlignment += 3;
      else if (input.smi.confidence === "medium") smiAlignment += 1;
    } else if (smiDir && smiDir !== input.dominantSide && input.smi.confirmed) {
      smiAlignment = -10;
    }
  }

  // Velocity: 0-100 score → 0-15 pts. Requires fresh entries.
  const velocity = clamp((input.velocity.score / 100) * 15, 0, 15);

  // Viability penalty
  const viabilityPenalty = input.viability.downgraded ? -10 : 0;

  // Raw total
  let score =
    coreQuality + idioAlpha + smiAlignment + velocity + viabilityPenalty;

  // S-tier magnitude bonus: real elite confirmation
  if (input.sTierCount >= 5) score += 5;
  else if (input.sTierCount >= 3) score += 2;

  // Scale bonus for whale-class positions
  if (input.totalValueUsd >= 10_000_000) score += 3;
  else if (input.totalValueUsd >= 3_000_000) score += 1.5;

  // Market adjustment clash: if we're ignoring heavy crowding, penalize
  if (input.marketAdjustment <= -8) score -= 5;

  score = clamp(score, 0, 100);

  return {
    score: roundTo(score, 1),
    coreQuality: roundTo(coreQuality, 1),
    idiosyncraticAlpha: roundTo(idioAlpha, 1),
    smiAlignment: roundTo(smiAlignment, 1),
    velocity: roundTo(velocity, 1),
    viabilityPenalty,
    gate: score >= TRADE_TRIGGER_GATE ? "pass" : "fail",
  };
}
