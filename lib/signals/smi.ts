import type { TraderTier } from "@/lib/hyperliquid/tracker/types";
import type { SignalMarketContext } from "./v2";
import { TIER_WEIGHT, roundTo } from "./v2";

export type SMIDirection =
  | "STRONG_LONG"
  | "LONG"
  | "NEUTRAL"
  | "SHORT"
  | "STRONG_SHORT";
export type SMIConfidence = "high" | "medium" | "low";

export interface SMIComponents {
  smp: number;
  fd: number;
  cv: number;
}

export interface SMIHistoryEntry {
  smi: number;
  smp: number;
  fd: number;
  cv: number;
  traderCount: number;
  timestamp: number;
}

export interface SignalSmiState {
  smi: number;
  components: SMIComponents;
  signal: SMIDirection;
  confirmed: boolean;
  confidence: SMIConfidence;
  persistenceCount: number;
  effectiveParticipation: number;
  traderCount: number;
  timestamp: number;
}

interface SMIPositionInput {
  tier: TraderTier;
  side: "LONG" | "SHORT";
  sizeUsd: number;
  leverage: number;
}

const DEAD_ZONE = 10;
const ENTRY_THRESHOLD = 55;
const STRONG_THRESHOLD = 75;
const EXIT_THRESHOLD = 25;
const EMA_ALPHA = 0.3;
const HISTORY_LIMIT = 30;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function deriveSmiSignal(smi: number): SMIDirection {
  if (smi >= STRONG_THRESHOLD) return "STRONG_LONG";
  if (smi >= ENTRY_THRESHOLD) return "LONG";
  if (smi <= -STRONG_THRESHOLD) return "STRONG_SHORT";
  if (smi <= -ENTRY_THRESHOLD) return "SHORT";
  return "NEUTRAL";
}

function applyDeadZone(value: number) {
  if (Math.abs(value) < DEAD_ZONE) return 0;
  return Math.sign(value) * (Math.abs(value) - DEAD_ZONE) * (100 / (100 - DEAD_ZONE));
}

function buildSmp(positions: SMIPositionInput[]) {
  const weightedLong = positions
    .filter((position) => position.side === "LONG")
    .reduce((sum, position) => sum + TIER_WEIGHT[position.tier] * position.sizeUsd, 0);
  const weightedShort = positions
    .filter((position) => position.side === "SHORT")
    .reduce((sum, position) => sum + TIER_WEIGHT[position.tier] * position.sizeUsd, 0);
  const weightedTotal = weightedLong + weightedShort;
  const weightedNet = weightedLong - weightedShort;
  const ratio = weightedTotal > 0 ? weightedNet / weightedTotal : 0;
  const effectiveParticipation = positions.reduce(
    (sum, position) => sum + TIER_WEIGHT[position.tier],
    0
  );
  const participationFactor = Math.min(1, Math.sqrt(effectiveParticipation / 30));
  const totalUsd = positions.reduce((sum, position) => sum + position.sizeUsd, 0);
  const avgLeverage =
    totalUsd > 0
      ? positions.reduce((sum, position) => sum + position.sizeUsd * position.leverage, 0) /
        totalUsd
      : 0;
  const leverageFactor = Math.min(1.2, 1 + 0.02 * Math.min(avgLeverage, 10));

  return {
    smp: clamp(ratio * participationFactor * leverageFactor * 100, -100, 100),
    effectiveParticipation,
  };
}

function buildFd(smp: number, market: SignalMarketContext | null | undefined) {
  if (!market || smp === 0) return 0;
  const fundingNorm = clamp((market.funding * 10_000) / 5, -1, 1);
  return clamp(-fundingNorm * Math.sign(smp) * Math.abs(smp), -100, 100);
}

function buildCv(
  currentSmp: number,
  history: SMIHistoryEntry[]
) {
  const previousSmps = history.slice(-3).map((entry) => entry.smp);
  if (previousSmps.length === 0) return 0;
  if (previousSmps.length === 1) {
    return clamp(((currentSmp - previousSmps[0]!) / 40) * 100, -100, 100);
  }
  if (previousSmps.length === 2) {
    const d1 = currentSmp - previousSmps[1]!;
    const d2 = previousSmps[1]! - previousSmps[0]!;
    return clamp(((0.6 * d1 + 0.4 * d2) / 40) * 100, -100, 100);
  }

  const [s0, s1, s2] = previousSmps;
  const d1 = currentSmp - s2!;
  const d2 = s2! - s1!;
  const d3 = s1! - s0!;
  return clamp(((0.5 * d1 + 0.3 * d2 + 0.2 * d3) / 40) * 100, -100, 100);
}

function deriveConfidence(params: {
  smi: number;
  effectiveParticipation: number;
  persistenceCount: number;
}): SMIConfidence {
  if (
    Math.abs(params.smi) >= STRONG_THRESHOLD &&
    params.effectiveParticipation >= 15 &&
    params.persistenceCount >= 3
  ) {
    return "high";
  }
  if (
    Math.abs(params.smi) >= ENTRY_THRESHOLD &&
    params.effectiveParticipation >= 8 &&
    params.persistenceCount >= 2
  ) {
    return "medium";
  }
  return "low";
}

function countPersistence(currentSignal: SMIDirection, history: SMIHistoryEntry[]) {
  if (currentSignal === "NEUTRAL") return 0;

  let count = 1;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (deriveSmiSignal(history[index]!.smi) !== currentSignal) break;
    count += 1;
  }
  return count;
}

export function buildSignalSmi(params: {
  positions: SMIPositionInput[];
  market: SignalMarketContext | null | undefined;
  history: SMIHistoryEntry[];
  timestamp: number;
}): SignalSmiState {
  const { smp, effectiveParticipation } = buildSmp(params.positions);
  const fd = buildFd(smp, params.market);
  const cv = buildCv(smp, params.history);
  const raw = 0.5 * smp + 0.25 * fd + 0.25 * cv;
  const previous = params.history.at(-1)?.smi ?? raw;
  const smoothed = EMA_ALPHA * raw + (1 - EMA_ALPHA) * previous;
  const smi = Math.round(clamp(applyDeadZone(smoothed), -100, 100));
  const signal = deriveSmiSignal(smi);
  const persistenceCount = countPersistence(signal, params.history);
  const confirmed =
    signal !== "NEUTRAL" &&
    params.positions.length >= 3 &&
    effectiveParticipation >= 5 &&
    persistenceCount >= 2 &&
    (params.market?.dayVolume ?? 0) >= 10_000_000 &&
    (params.market?.openInterestUsd ?? 0) >= 5_000_000;

  return {
    smi,
    components: {
      smp: roundTo(smp),
      fd: roundTo(fd),
      cv: roundTo(cv),
    },
    signal,
    confirmed,
    confidence: deriveConfidence({
      smi,
      effectiveParticipation,
      persistenceCount,
    }),
    persistenceCount,
    effectiveParticipation: roundTo(effectiveParticipation),
    traderCount: params.positions.length,
    timestamp: params.timestamp,
  };
}

export function appendSmiHistory(
  history: SMIHistoryEntry[],
  state: SignalSmiState
): SMIHistoryEntry[] {
  return [
    ...history,
    {
      smi: state.smi,
      smp: state.components.smp,
      fd: state.components.fd,
      cv: state.components.cv,
      traderCount: state.traderCount,
      timestamp: state.timestamp,
    },
  ].slice(-HISTORY_LIMIT);
}

export { ENTRY_THRESHOLD, EXIT_THRESHOLD, STRONG_THRESHOLD };
