import type { ClearinghouseState } from "../types";

// ─── Position Change Events ─────────────────────────────

export type PositionChangeType =
  | "position_opened"
  | "position_closed"
  | "position_increased"
  | "position_decreased"
  | "position_flipped"; // long→short or short→long

export interface PositionSnapshot {
  coin: string;
  szi: number;          // signed size
  entryPx: number;
  leverage: number;
  positionValueUsd: number;
}

export interface PositionChange {
  type: PositionChangeType;
  traderAddress: string;
  traderTier: TraderTier;
  coin: string;
  timestamp: number;
  previous: PositionSnapshot | null; // null when newly opened
  current: PositionSnapshot | null;  // null when closed
}

// ─── Tracked Trader ─────────────────────────────────────

export type TraderTier = "S" | "A" | "B" | "C" | "D";

export type TrackingMethod = "websocket" | "polling";

export interface TrackedTrader {
  address: string;
  tier: TraderTier;
  score: number;
  method: TrackingMethod;
  lastUpdated: number;
  state: ClearinghouseState | null;
  previousState: ClearinghouseState | null;
}

// ─── Tracker Config ─────────────────────────────────────

export interface TrackerConfig {
  pollIntervalMs: number;          // default 10_000
  pollConcurrency: number;         // default 15
  wsReconnectDelayMs: number;      // default 3_000
  wsMaxReconnectAttempts: number;  // default 20
  wsSubscriptionsPerConn: number;  // default 50
  // Tier threshold for WS vs polling
  wsTierThreshold: TraderTier;     // default "B" — S and A use WS
}

export const DEFAULT_CONFIG: TrackerConfig = {
  pollIntervalMs: 10_000,
  pollConcurrency: 15,
  wsReconnectDelayMs: 3_000,
  wsMaxReconnectAttempts: 20,
  wsSubscriptionsPerConn: 50,
  wsTierThreshold: "B",
};

// ─── Tracker Stats ──────────────────────────────────────

export interface TrackerStats {
  totalTraders: number;
  wsTraders: number;
  pollTraders: number;
  tradersWithPositions: number;
  totalPositions: number;
  wsConnections: number;
  wsConnected: number;
  lastPollCycleMs: number;
  totalChangesEmitted: number;
  uptime: number;
}
