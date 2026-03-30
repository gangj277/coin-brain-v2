import type { ClearinghouseState, Fill } from "../types";
import type { TraderTier } from "../tracker/types";

export type PositionTimingSource = "diff" | "fills" | "bootstrap";
export type PositionTimingConfidence = "high" | "medium" | "low";
export type PositionBackfillStatus = "pending" | "done" | "exhausted";
export type PositionBackfillStrategy = "incremental" | "1d" | "7d" | "30d";

export interface PositionTimingRecord {
  address: string;
  coin: string;
  openedAt: number | null;
  lastAddedAt: number | null;
  lastChangedAt: number;
  observedAt: number;
  timingSource: PositionTimingSource;
  timingConfidence: PositionTimingConfidence;
  preexisting: boolean;
  backfillStatus: PositionBackfillStatus;
}

export interface PositionBackfillTask {
  positionKey: string;
  address: string;
  coin: string;
  strategy: PositionBackfillStrategy;
  startTime?: number;
  endTime?: number;
  enqueuedAt: number;
  traderTier: TraderTier;
}

export interface PositionTimingState {
  snapshots: Record<string, ClearinghouseState>;
  records: Record<string, PositionTimingRecord>;
  queue: PositionBackfillTask[];
}

export interface ResolveCurrentPositionTimingParams {
  currentSzi: number;
  fills: Fill[];
}

export interface ResolvedCurrentPositionTiming {
  openedAt: number | null;
  lastAddedAt: number | null;
  complete: boolean;
}
