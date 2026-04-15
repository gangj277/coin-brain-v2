/**
 * Signal Event Detector — diffs snapshots, enforces trade-trigger gate, daily cap,
 * side-flip stability, and per-coin:event cooldowns.
 *
 * Single-gate model: the v2 scoring pipeline attaches `tradeTrigger.gate` to each signal.
 * The detector only surfaces events for signals that have passed that gate, plus a few
 * event-specific structural requirements.
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
  detail: string;
  priority: 1 | 2 | 3;
  triggerScore: number;
}

// ─── Cooldown State ─────────────────────────────────────

export interface CooldownState {
  [key: string]: number;
}

const COOLDOWN_MS: Record<AlertEventType, number> = {
  new_signal: 45 * 60 * 1000,
  stier_surge: 30 * 60 * 1000,
  strength_upgrade: 45 * 60 * 1000,
  consensus_formed: 90 * 60 * 1000,
  side_flip: 60 * 60 * 1000,
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

// ─── Side Streak Tracking ───────────────────────────────

export interface SideStreakEntry {
  side: "LONG" | "SHORT" | "SPLIT";
  count: number;
  updatedAt: number;
}

export type SideStreakState = Record<string, SideStreakEntry>;

const SIDE_FLIP_REQUIRED_STREAK = 3;

export function updateSideStreaks(
  prev: SideStreakState,
  snapshot: ServedSignalSnapshot,
  now: number
): SideStreakState {
  const next: SideStreakState = {};
  for (const signal of snapshot.signals) {
    const prevEntry = prev[signal.coin];
    if (prevEntry && prevEntry.side === signal.dominantSide) {
      next[signal.coin] = {
        side: signal.dominantSide,
        count: prevEntry.count + 1,
        updatedAt: now,
      };
    } else {
      next[signal.coin] = {
        side: signal.dominantSide,
        count: 1,
        updatedAt: now,
      };
    }
  }
  // Prune stale entries (>12h)
  const cutoff = now - 12 * 60 * 60 * 1000;
  for (const [coin, entry] of Object.entries(prev)) {
    if (!next[coin] && entry.updatedAt >= cutoff) {
      next[coin] = entry;
    }
  }
  return next;
}

// ─── Daily Cap Tracking ─────────────────────────────────

export interface DailyAlertStats {
  bucketUtcDay: string; // YYYY-MM-DD
  totalSent: number;
  perCoin: Record<string, number>;
}

const DAILY_GLOBAL_CAP = 5;
const DAILY_PER_COIN_CAP = 2;

export function utcDayKey(now: number): string {
  const d = new Date(now);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function ensureDailyBucket(
  stats: DailyAlertStats | null | undefined,
  now: number
): DailyAlertStats {
  const today = utcDayKey(now);
  if (!stats || stats.bucketUtcDay !== today) {
    return { bucketUtcDay: today, totalSent: 0, perCoin: {} };
  }
  return stats;
}

export function canEmitUnderDailyCap(
  stats: DailyAlertStats,
  coin: string
): boolean {
  if (stats.totalSent >= DAILY_GLOBAL_CAP) return false;
  if ((stats.perCoin[coin] ?? 0) >= DAILY_PER_COIN_CAP) return false;
  return true;
}

export function incrementDailyCount(
  stats: DailyAlertStats,
  coin: string
): DailyAlertStats {
  return {
    bucketUtcDay: stats.bucketUtcDay,
    totalSent: stats.totalSent + 1,
    perCoin: {
      ...stats.perCoin,
      [coin]: (stats.perCoin[coin] ?? 0) + 1,
    },
  };
}

// ─── Trade Trigger Gate ─────────────────────────────────

function getTradeTrigger(signal: ServedSignal) {
  return signal.scoring?.v2.tradeTrigger ?? null;
}

/**
 * The single gate that determines whether a signal deserves a Telegram alert.
 *
 *  - must have v2 scoring (no legacy fallback — forces fresh code path)
 *  - tradeTrigger.gate must be "pass"
 *  - dominantSide must be directional (not SPLIT)
 *  - strength must not be "weak" (viability floor kills tiny/thin signals)
 */
function isTradeTriggerPassing(signal: ServedSignal): boolean {
  const trigger = getTradeTrigger(signal);
  if (!trigger) return false;
  if (trigger.gate !== "pass") return false;
  if (signal.dominantSide === "SPLIT") return false;
  if (signal.strength === "weak") return false;
  return true;
}

// ─── Detector ───────────────────────────────────────────

export interface DetectOptions {
  sideStreaks?: SideStreakState;
  dailyStats?: DailyAlertStats | null;
  cooldowns?: CooldownState;
  now?: number;
}

export function detectEvents(
  current: ServedSignalSnapshot,
  previous: ServedSignalSnapshot | null,
  options: DetectOptions = {}
): AlertEvent[] {
  const now = options.now ?? Date.now();
  const cooldowns = options.cooldowns ?? {};
  const sideStreaks = options.sideStreaks ?? {};
  const dailyBucket = ensureDailyBucket(options.dailyStats ?? null, now);

  // Short-circuit if global cap already hit
  if (dailyBucket.totalSent >= DAILY_GLOBAL_CAP) return [];

  const events: AlertEvent[] = [];

  const prevByCoin = new Map<string, ServedSignal>();
  if (previous) {
    for (const sig of previous.signals) prevByCoin.set(sig.coin, sig);
  }

  for (const signal of current.signals) {
    if (!isTradeTriggerPassing(signal)) continue;

    // Skip if per-coin daily cap reached
    if (!canEmitUnderDailyCap(dailyBucket, signal.coin)) continue;

    const prev = prevByCoin.get(signal.coin);
    const trigger = getTradeTrigger(signal)!;

    // ── new_signal: previously absent OR was weak/SPLIT ──
    const wasPresent = prev && prev.strength !== "weak" && prev.dominantSide !== "SPLIT";
    if (!wasPresent) {
      if (
        signal.totalTraders >= 4 &&
        signal.sTierCount >= 2 &&
        !isOnCooldown(signal.coin, "new_signal", cooldowns, now)
      ) {
        events.push({
          type: "new_signal",
          signal,
          detail: `${signal.coin} ${signal.dominantSide} 신규 트리거 — ${signal.totalTraders}명 (S:${signal.sTierCount})`,
          priority: trigger.score >= 85 ? 1 : 2,
          triggerScore: trigger.score,
        });
        continue;
      }
    }

    if (!prev) continue;

    // ── stier_surge: S-tier +2 AND direction unchanged ──
    const sTierDelta = signal.sTierCount - prev.sTierCount;
    if (
      sTierDelta >= 2 &&
      signal.dominantSide === prev.dominantSide &&
      !isOnCooldown(signal.coin, "stier_surge", cooldowns, now)
    ) {
      events.push({
        type: "stier_surge",
        signal,
        detail: `S-tier +${sTierDelta}명 유입 (${prev.sTierCount}→${signal.sTierCount})`,
        priority: 1,
        triggerScore: trigger.score,
      });
      continue;
    }

    // ── strength_upgrade: moderate → strong only (weak→moderate intentionally silent) ──
    if (
      prev.strength === "moderate" &&
      signal.strength === "strong" &&
      signal.dominantSide === prev.dominantSide &&
      !isOnCooldown(signal.coin, "strength_upgrade", cooldowns, now)
    ) {
      events.push({
        type: "strength_upgrade",
        signal,
        detail: `시그널 강도 상승 (moderate→strong)`,
        priority: 1,
        triggerScore: trigger.score,
      });
      continue;
    }

    // ── consensus_formed: alignment band → consensus ──
    const prevBand = prev.scoring?.v2.alignmentBand;
    const currBand = signal.scoring?.v2.alignmentBand;
    if (
      currBand === "consensus" &&
      prevBand !== "consensus" &&
      !isOnCooldown(signal.coin, "consensus_formed", cooldowns, now)
    ) {
      events.push({
        type: "consensus_formed",
        signal,
        detail: `컨센서스 형성 — ${signal.totalTraders}명 중 ${Math.max(signal.longTraders, signal.shortTraders)}명 ${signal.dominantSide}`,
        priority: 1,
        triggerScore: trigger.score,
      });
      continue;
    }

    // ── side_flip: direction changed AND new direction stable N cycles ──
    if (
      prev.dominantSide !== "SPLIT" &&
      signal.dominantSide !== "SPLIT" &&
      prev.dominantSide !== signal.dominantSide &&
      (sideStreaks[signal.coin]?.count ?? 0) >= SIDE_FLIP_REQUIRED_STREAK &&
      sideStreaks[signal.coin]?.side === signal.dominantSide &&
      signal.strength === "strong" &&
      trigger.score >= 80 &&
      !isOnCooldown(signal.coin, "side_flip", cooldowns, now)
    ) {
      events.push({
        type: "side_flip",
        signal,
        detail: `방향 전환 확정 ${prev.dominantSide}→${signal.dominantSide} (${sideStreaks[signal.coin]?.count} 사이클 유지)`,
        priority: 2,
        triggerScore: trigger.score,
      });
    }
  }

  // Sort: priority first, then trigger score
  events.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.triggerScore - a.triggerScore;
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
  const cutoff = now - 3 * 60 * 60 * 1000;
  for (const [key, ts] of Object.entries(updated)) {
    if (ts < cutoff) delete updated[key];
  }
  return updated;
}
