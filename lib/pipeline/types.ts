import type { DiscoverySource } from "@/lib/hyperliquid/discovery";
import type { PositionStoreStats, TraderTier } from "@/lib/hyperliquid/tracker/types";
import type { PositionTimingRecord } from "@/lib/hyperliquid/timing/types";
import type { Signal } from "@/lib/signals/aggregator";
import type { SignalAnalysis } from "@/lib/signals/narrator";
import type { CollectionConfig } from "./config";

export interface SignalMarketData {
  markPx: number;
  prevDayPx: number;
  dayChange: number;
  funding: number;
  fundingAnnual: number;
  openInterest: number;
  openInterestUsd: number;
  dayVolume: number;
}

export type CollectedSignal = Signal & {
  market: SignalMarketData | null;
};

export type ServedSignal = CollectedSignal & {
  analysis: SignalAnalysis | null;
  narrative: string;
};

export interface TraderUniverseEntry {
  address: string;
  tier: TraderTier;
  score: number;
  refreshedAt: number;
  source: DiscoverySource;
  flags: string[];
}

export interface TraderUniverseSnapshot {
  refreshedAt: number;
  source: DiscoverySource | "mixed";
  traders: TraderUniverseEntry[];
  filters: CollectionConfig["leaderboardFilter"] & CollectionConfig["ranking"];
  totalCandidates: number;
  totalRanked: number;
}

export interface BaseSignalSnapshot {
  signals: CollectedSignal[];
  stats: PositionStoreStats;
  market: Record<string, SignalMarketData>;
  timestamp: number;
  collection: {
    traders: number;
    positions: number;
    durationMs: number;
    universeRefreshedAt: number;
    timingQueueRemaining: number;
    fallbackUniverseRefresh: boolean;
    recentEventsTracked?: number;
  };
}

export interface ServedSignalSnapshot {
  signals: ServedSignal[];
  count: number;
  stats: PositionStoreStats | null;
  timestamp: number;
  etag: string;
}

export type SignalAnalysisMap = Record<
  string,
  {
    analysis: SignalAnalysis;
    narrative: string;
  }
>;

export interface PipelineStageMetrics {
  startedAt: number;
  completedAt: number;
  durationMs: number;
  marketFetches: number;
  traderFetches: number;
  backfillTasksProcessed: number;
}

export type TimingRecordMap = Record<string, PositionTimingRecord>;
