import { KEYS, redis } from "@/lib/redis/client";
import { createEmptyTimingState } from "./state";
import type { PositionTimingState } from "./types";

function parseJson<T>(value: unknown, fallback: T): T {
  if (!value) return fallback;
  if (typeof value === "string") return JSON.parse(value) as T;
  return value as T;
}

export async function loadPositionTimingState(): Promise<PositionTimingState> {
  const [snapshotsRaw, recordsRaw, queueRaw] = await Promise.all([
    redis.get<string>(KEYS.POSITION_SNAPSHOTS),
    redis.get<string>(KEYS.POSITION_TIMINGS),
    redis.get<string>(KEYS.POSITION_TIMING_QUEUE),
  ]);

  return createEmptyTimingState({
    snapshots: parseJson(snapshotsRaw, {}),
    records: parseJson(recordsRaw, {}),
    queue: parseJson(queueRaw, []),
  });
}

export async function savePositionTimingState(state: PositionTimingState) {
  await Promise.all([
    redis.set(KEYS.POSITION_SNAPSHOTS, JSON.stringify(state.snapshots)),
    redis.set(KEYS.POSITION_TIMINGS, JSON.stringify(state.records)),
    redis.set(KEYS.POSITION_TIMING_QUEUE, JSON.stringify(state.queue)),
  ]);
}
