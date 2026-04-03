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
  /** coin → timestamp of last alert sent */
  [coin: string]: number;
}

const COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes per coin

function isOnCooldown(coin: string, cooldowns: CooldownState, now: number): boolean {
  const lastSent = cooldowns[coin];
  if (!lastSent) return false;
  return now - lastSent < COOLDOWN_MS;
}

// ─── Strength Ordering ──────────────────────────────────

const STRENGTH_RANK = { weak: 0, moderate: 1, strong: 2 } as const;

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

    // Skip if on cooldown
    if (isOnCooldown(signal.coin, cooldowns, now)) continue;

    const prev = prevByCoin.get(signal.coin);

    // ── New signal: not in previous snapshot ──
    if (!prev && signal.totalTraders >= 3) {
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
    if (sTierDelta >= 2) {
      events.push({
        type: "stier_surge",
        signal,
        detail: `S-tier +${sTierDelta}명 진입 (${prev.sTierCount}→${signal.sTierCount})`,
        priority: 1,
      });
      continue;
    }

    // ── Strength upgrade: weak→moderate, moderate→strong ──
    if (STRENGTH_RANK[signal.strength] > STRENGTH_RANK[prev.strength]) {
      events.push({
        type: "strength_upgrade",
        signal,
        detail: `시그널 강도 상승 (${prev.strength}→${signal.strength})`,
        priority: signal.strength === "strong" ? 1 : 2,
      });
      continue;
    }

    // ── Consensus formed: type changed to consensus ──
    if (signal.type === "consensus" && prev.type !== "consensus") {
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
      prev.dominantSide !== signal.dominantSide
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
    updated[event.signal.coin] = now;
  }
  // Prune old entries (>2 hours)
  const cutoff = now - 2 * 60 * 60 * 1000;
  for (const [coin, ts] of Object.entries(updated)) {
    if (ts < cutoff) delete updated[coin];
  }
  return updated;
}
