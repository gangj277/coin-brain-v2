import type { LeaderboardFilter } from "@/lib/hyperliquid/discovery";
import type { TraderTier } from "@/lib/hyperliquid/tracker/types";

export interface CollectionConfig {
  leaderboardFilter: Required<LeaderboardFilter>;
  ranking: {
    minTier: TraderTier;
    maxResults: number;
  };
  pollBatchSize: number;
  backfillBudget: number;
  maxDurationMs: number;
  backfillGuardMs: number;
  universeStaleMs: number;
}

export const DEFAULT_COLLECTION_CONFIG: CollectionConfig = {
  leaderboardFilter: {
    minAccountValue: 50_000,
    minAllTimePnl: 50_000,
    minMonthPnl: 1_000,
    minAllTimeRoi: 0.2,
    maxEntries: 300,
  },
  ranking: {
    minTier: "C",
    maxResults: 300,
  },
  pollBatchSize: 15,
  backfillBudget: 20,
  maxDurationMs: 60_000,
  backfillGuardMs: 10_000,
  universeStaleMs: 20 * 60 * 1000,
};
