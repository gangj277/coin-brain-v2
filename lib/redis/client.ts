import { Redis } from "@upstash/redis";

export const redis = Redis.fromEnv();

// Keys
export const KEYS = {
  SIGNALS: "signals:latest",
  ANALYSIS: "analysis:latest",
  STATS: "stats:latest",
  MARKET: "market:latest",
  LAST_UPDATE: "last_update",
  YOUTUBERS: "youtubers:latest",
  POSITION_SNAPSHOTS: "positions:snapshots:latest",
  POSITION_TIMINGS: "positions:timings:latest",
  POSITION_TIMING_QUEUE: "positions:timings:queue",
} as const;
