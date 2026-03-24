import { Redis } from "@upstash/redis";

export const redis = Redis.fromEnv();

// Keys
export const KEYS = {
  SIGNALS: "signals:latest",
  ANALYSIS: "analysis:latest",
  STATS: "stats:latest",
  MARKET: "market:latest",
  LAST_UPDATE: "last_update",
} as const;
