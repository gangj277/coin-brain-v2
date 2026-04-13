import type { ServedSignal, ServedSignalSnapshot } from "./types";
import { getRedis, KEYS } from "@/lib/redis/client";
import { parseJson } from "./repository-utils";

export interface PendingSignalOutcome {
  id: string;
  coin: string;
  direction: "LONG" | "SHORT";
  entryPrice: number;
  emittedAt: number;
  checkpoints: {
    "1h": SignalOutcomeCheckpoint | null;
    "4h": SignalOutcomeCheckpoint | null;
    "24h": SignalOutcomeCheckpoint | null;
  };
  tags: {
    alignmentBand: string;
    strength: string;
    smiSignal: string;
    confirmed: boolean;
  };
}

export interface SignalOutcomeCheckpoint {
  evaluatedAt: number;
  exitPrice: number;
  returnPct: number;
}

export interface SignalOutcomeBucket {
  count: number;
  wins: {
    "1h": number;
    "4h": number;
    "24h": number;
  };
  returns: {
    "1h": number[];
    "4h": number[];
    "24h": number[];
  };
}

export type SignalOutcomeStats = Record<string, SignalOutcomeBucket>;

export interface SignalOutcomeRepository {
  loadPending(): Promise<PendingSignalOutcome[]>;
  savePending(pending: PendingSignalOutcome[]): Promise<void>;
  loadStats(): Promise<SignalOutcomeStats>;
  saveStats(stats: SignalOutcomeStats): Promise<void>;
}

export class RedisSignalOutcomeRepository implements SignalOutcomeRepository {
  async loadPending(): Promise<PendingSignalOutcome[]> {
    const raw = await getRedis().get<string>(KEYS.SIGNAL_OUTCOMES_PENDING);
    return parseJson<PendingSignalOutcome[]>(raw, []);
  }

  async savePending(pending: PendingSignalOutcome[]): Promise<void> {
    await getRedis().set(KEYS.SIGNAL_OUTCOMES_PENDING, JSON.stringify(pending));
  }

  async loadStats(): Promise<SignalOutcomeStats> {
    const raw = await getRedis().get<string>(KEYS.SIGNAL_OUTCOMES_STATS);
    return parseJson<SignalOutcomeStats>(raw, {});
  }

  async saveStats(stats: SignalOutcomeStats): Promise<void> {
    await getRedis().set(KEYS.SIGNAL_OUTCOMES_STATS, JSON.stringify(stats));
  }
}

export function buildOutcomeBucketKey(pending: PendingSignalOutcome) {
  return `${pending.tags.strength}_${pending.tags.alignmentBand}_${pending.direction}`;
}

export function buildPendingSignalOutcome(
  signal: ServedSignal,
  emittedAt: number
): PendingSignalOutcome {
  return {
    id: `${signal.coin}:${signal.dominantSide}:${signal.strength}:${emittedAt}`,
    coin: signal.coin,
    direction: signal.dominantSide === "SHORT" ? "SHORT" : "LONG",
    entryPrice: signal.market?.markPx ?? signal.avgEntryPx,
    emittedAt,
    checkpoints: {
      "1h": null,
      "4h": null,
      "24h": null,
    },
    tags: {
      alignmentBand: signal.scoring?.v2.alignmentBand ?? signal.type,
      strength: signal.strength,
      smiSignal: signal.smi?.signal ?? "NEUTRAL",
      confirmed: signal.smi?.confirmed ?? false,
    },
  };
}

export async function registerPendingServedSignals(params: {
  repository: SignalOutcomeRepository;
  snapshot: ServedSignalSnapshot;
}) {
  const pending = await params.repository.loadPending();
  const existingIds = new Set(pending.map((entry) => entry.id));
  const additions = params.snapshot.signals
    .filter((signal) => signal.strength !== "weak" && signal.totalTraders >= 3)
    .map((signal) => buildPendingSignalOutcome(signal, params.snapshot.timestamp))
    .filter((entry) => !existingIds.has(entry.id));
  if (additions.length === 0) return;
  await params.repository.savePending([...pending, ...additions]);
}

export function upsertOutcomeStat(
  stats: SignalOutcomeStats,
  pending: PendingSignalOutcome,
  horizon: keyof PendingSignalOutcome["checkpoints"],
  returnPct: number
) {
  const key = buildOutcomeBucketKey(pending);
  const bucket =
    stats[key] ??
    ({
      count: 0,
      wins: { "1h": 0, "4h": 0, "24h": 0 },
      returns: { "1h": [], "4h": [], "24h": [] },
    } satisfies SignalOutcomeBucket);
  if (bucket.returns[horizon].length === 0) {
    bucket.count += 1;
  }
  bucket.returns[horizon].push(returnPct);
  if (returnPct > 0) {
    bucket.wins[horizon] += 1;
  }
  stats[key] = bucket;
}
