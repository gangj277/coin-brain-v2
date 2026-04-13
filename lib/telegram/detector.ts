/**
 * Signal Event Detector — diffs snapshots to find alert-worthy changes.
 *
 * Compares current vs previous served snapshot and emits events:
 *   - new_signal:      Coin appears with 3+ traders for the first time
 *   - stier_surge:     S-tier count increased by 2+ on a coin
 *   - strength_upgrade: Signal strength increased (weak→moderate→strong)
 *   - consensus_formed: Signal type changed to "consensus"
 *   - side_flip:       Dominant side flipped (LONG→SHORT or vice versa)
 */

import type { ServedSignal, ServedSignalSnapshot } from "@/lib/pipeline/types";

// ─── Event Types ────────────────────────────────────────

export type AlertEventType =
  | "new_signal"
  | "stier_surge"
  | "strength_upgrade"
  | "consensus_formed"
  | "side_flip";

export interface AlertEvent {
  type: AlertEventType;
  signal: ServedSignal;
  /** What changed — human-readable context for the formatter */
  detail: string;
  /** Priority 1 (highest) to 3 (lowest) */
  priority: 1 | 2 | 3;
}

// ─── Cooldown State ─────────────────────────────────────

export interface CooldownState {
  /** `${coin}:${eventType}` → timestamp of last alert sent */
  [key: string]: number;
}

const COOLDOWN_MS: Record<AlertEventType, number> = {
  new_signal: 30 * 60 * 1000,
  stier_surge: 20 * 60 * 1000,
  strength_upgrade: 30 * 60 * 1000,
  consensus_formed: 60 * 60 * 1000,
  side_flip: 15 * 60 * 1000,
};

function getCooldownKey(coin: string, type: AlertEventType) {
  return `${coin}:${type}`;
}

function isOnCooldown(
  coin: string,
  type: AlertEventType,
  cooldowns: CooldownState,
  now: number
): boolean {
  const lastSent = cooldowns[getCooldownKey(coin, type)] ?? cooldowns[coin];
  if (!lastSent) return false;
  return now - lastSent < COOLDOWN_MS[type];
}

// ─── Strength Ordering ──────────────────────────────────

const STRENGTH_RANK = { weak: 0, moderate: 1, strong: 2 } as const;
const EVENT_QUALITY_FLOOR: Record<AlertEventType, number> = {
  new_signal: 7,
  stier_surge: 6.5,
  strength_upgrade: 7,
  consensus_formed: 7,
  side_flip: 8,
};

function getAlignmentBand(signal: ServedSignal) {
  if (signal.scoring?.v2.alignmentBand) {
    return signal.scoring.v2.alignmentBand;
  }
  if (signal.type === "consensus") return "consensus";
  if (signal.type === "divergence") return "divergence";
  return "near_consensus";
}

function getEffectiveTraders(signal: ServedSignal) {
  return signal.scoring?.v2.effectiveTraders ?? signal.totalTraders;
}

function getVelocityScore(signal: ServedSignal) {
  return signal.scoring?.v2.velocity.score ?? 0;
}

function getMarketAdjustment(signal: ServedSignal) {
  return signal.scoring?.v2.marketAdjustment ?? 0;
}

function getSmiDirection(signal: ServedSignal): "LONG" | "SHORT" | null {
  const smiSignal = signal.smi?.signal;
  if (smiSignal === "LONG" || smiSignal === "STRONG_LONG") return "LONG";
  if (smiSignal === "SHORT" || smiSignal === "STRONG_SHORT") return "SHORT";
  return null;
}

function isMeaningfulAlertSignal(
  signal: ServedSignal,
  eventType: AlertEventType
) {
  if (signal.strength === "weak" || signal.totalTraders < 3) {
    return false;
  }

  const alignmentBand = getAlignmentBand(signal);
  if (alignmentBand === "divergence" || alignmentBand === "counter_consensus") {
    return false;
  }

  const velocity = getVelocityScore(signal);
  const effectiveTraders = getEffectiveTraders(signal);
  const marketAdjustment = getMarketAdjustment(signal);
  const smiDirection = getSmiDirection(signal);
  const alignedDirectionalSmi =
    smiDirection !== null && smiDirection === signal.dominantSide;
  const alignedConfirmedSmi =
    alignedDirectionalSmi && Boolean(signal.smi?.confirmed);
  const conflictingConfirmedSmi =
    Boolean(signal.smi?.confirmed) &&
    smiDirection !== null &&
    smiDirection !== signal.dominantSide;

  if (conflictingConfirmedSmi) {
    return false;
  }

  if (marketAdjustment <= -10 && !alignedConfirmedSmi) {
    return false;
  }

  if (eventType === "new_signal") {
    const structuralEntry =
      signal.totalTraders >= 4 ||
      signal.sTierCount >= 2 ||
      alignedConfirmedSmi;
    if (!structuralEntry) {
      return false;
    }
  }

  if (signal.strength === "moderate" && !alignedConfirmedSmi) {
    const moderateMomentumCase =
      signal.sTierCount >= 2 &&
      effectiveTraders >= 6 &&
      velocity >= 70 &&
      marketAdjustment >= 0;
    if (!moderateMomentumCase) {
      return false;
    }
  }

  if (eventType === "side_flip") {
    if (
      signal.strength !== "strong" ||
      !alignedConfirmedSmi ||
      velocity < 55 ||
      marketAdjustment <= -8
    ) {
      return false;
    }
  }

  let qualityScore = 0;

  qualityScore += signal.strength === "strong" ? 4 : 1;
  qualityScore += alignmentBand === "consensus" ? 3 : 2;

  if (signal.sTierCount >= 3) {
    qualityScore += 2;
  } else if (signal.sTierCount >= 2) {
    qualityScore += 1;
  }

  if (signal.totalTraders >= 5) {
    qualityScore += 1;
  }

  if (effectiveTraders >= 8) {
    qualityScore += 2;
  } else if (effectiveTraders >= 5) {
    qualityScore += 1;
  }

  if (signal.conviction >= 85) {
    qualityScore += 2;
  } else if (signal.conviction >= 75) {
    qualityScore += 1;
  }

  if (velocity >= 75) {
    qualityScore += 2;
  } else if (velocity >= 55) {
    qualityScore += 1;
  }

  if (marketAdjustment >= 8) {
    qualityScore += 1.5;
  } else if (marketAdjustment > 0) {
    qualityScore += 0.5;
  } else if (marketAdjustment <= -8) {
    qualityScore -= 2;
  } else if (marketAdjustment <= -4) {
    qualityScore -= 1;
  }

  if (alignedConfirmedSmi) {
    qualityScore += 3;
  } else if (alignedDirectionalSmi) {
    qualityScore += 1;
  }

  if (signal.smi?.confidence === "high") {
    qualityScore += 1;
  } else if (signal.smi?.confidence === "medium") {
    qualityScore += 0.5;
  }

  if (eventType === "stier_surge") {
    qualityScore += 1;
  }
  if (eventType === "consensus_formed") {
    qualityScore += 1;
  }

  return qualityScore >= EVENT_QUALITY_FLOOR[eventType];
}

// ─── Detector ───────────────────────────────────────────

export function detectEvents(
  current: ServedSignalSnapshot,
  previous: ServedSignalSnapshot | null,
  cooldowns: CooldownState = {},
  now = Date.now()
): AlertEvent[] {
  const events: AlertEvent[] = [];

  // Build lookup of previous signals by coin
  const prevByCoin = new Map<string, ServedSignal>();
  if (previous) {
    for (const sig of previous.signals) {
      prevByCoin.set(sig.coin, sig);
    }
  }

  for (const signal of current.signals) {
    // Skip weak signals entirely
    if (signal.strength === "weak") continue;

    const prev = prevByCoin.get(signal.coin);

    // ── New signal: not in previous snapshot ──
    if (
      !prev &&
      isMeaningfulAlertSignal(signal, "new_signal") &&
      signal.totalTraders >= 3 &&
      !isOnCooldown(signal.coin, "new_signal", cooldowns, now)
    ) {
      events.push({
        type: "new_signal",
        signal,
        detail: `${signal.coin} 신규 등장 — ${signal.totalTraders}명 트레이더, S-tier ${signal.sTierCount}명`,
        priority: signal.sTierCount >= 2 ? 1 : 2,
      });
      continue; // don't double-alert a new signal
    }

    if (!prev) continue;

    // ── S-tier surge: 2+ more S-tier traders ──
    const sTierDelta = signal.sTierCount - prev.sTierCount;
    if (
      sTierDelta >= 2 &&
      isMeaningfulAlertSignal(signal, "stier_surge") &&
      !isOnCooldown(signal.coin, "stier_surge", cooldowns, now)
    ) {
      events.push({
        type: "stier_surge",
        signal,
        detail: `S-tier +${sTierDelta}명 진입 (${prev.sTierCount}→${signal.sTierCount})`,
        priority: 1,
      });
      continue;
    }

    // ── Strength upgrade: weak→moderate, moderate→strong ──
    if (
      STRENGTH_RANK[signal.strength] > STRENGTH_RANK[prev.strength] &&
      isMeaningfulAlertSignal(signal, "strength_upgrade") &&
      !isOnCooldown(signal.coin, "strength_upgrade", cooldowns, now)
    ) {
      events.push({
        type: "strength_upgrade",
        signal,
        detail: `시그널 강도 상승 (${prev.strength}→${signal.strength})`,
        priority: signal.strength === "strong" ? 1 : 2,
      });
      continue;
    }

    // ── Consensus formed: type changed to consensus ──
    if (
      signal.type === "consensus" &&
      prev.type !== "consensus" &&
      isMeaningfulAlertSignal(signal, "consensus_formed") &&
      !isOnCooldown(signal.coin, "consensus_formed", cooldowns, now)
    ) {
      events.push({
        type: "consensus_formed",
        signal,
        detail: `컨센서스 형성 — ${signal.totalTraders}명 중 ${Math.max(signal.longTraders, signal.shortTraders)}명 ${signal.dominantSide}`,
        priority: 1,
      });
      continue;
    }

    // ── Side flip: dominant side changed ──
    if (
      prev.dominantSide !== "SPLIT" &&
      signal.dominantSide !== "SPLIT" &&
      prev.dominantSide !== signal.dominantSide &&
      isMeaningfulAlertSignal(signal, "side_flip") &&
      !isOnCooldown(signal.coin, "side_flip", cooldowns, now)
    ) {
      events.push({
        type: "side_flip",
        signal,
        detail: `방향 전환 ${prev.dominantSide}→${signal.dominantSide}`,
        priority: 2,
      });
    }
  }

  // Sort by priority (1 first), then by total value
  events.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.signal.totalValueUsd - a.signal.totalValueUsd;
  });

  return events;
}

/** Update cooldown timestamps for alerted coins */
export function applyCooldowns(
  cooldowns: CooldownState,
  events: AlertEvent[],
  now = Date.now()
): CooldownState {
  const updated = { ...cooldowns };
  for (const event of events) {
    updated[getCooldownKey(event.signal.coin, event.type)] = now;
  }
  // Prune old entries (>2 hours)
  const cutoff = now - 2 * 60 * 60 * 1000;
  for (const [key, ts] of Object.entries(updated)) {
    if (ts < cutoff) delete updated[key];
  }
  return updated;
}
