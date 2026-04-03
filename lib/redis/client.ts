import { Redis } from "@upstash/redis";

type RedisClient = ReturnType<typeof Redis.fromEnv>;

let cachedRedis: RedisClient | null = null;

export function getRedis(): RedisClient {
  if (!cachedRedis) {
    cachedRedis = Redis.fromEnv();
  }

  return cachedRedis;
}

export const redis = new Proxy({} as RedisClient, {
  get(_target, prop, receiver) {
    const client = getRedis() as unknown as Record<PropertyKey, unknown>;
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
}) as RedisClient;

// Keys
export const KEYS = {
  SIGNALS: "signals:latest",
  ANALYSIS: "analysis:latest",
  STATS: "stats:latest",
  MARKET: "market:latest",
  LAST_UPDATE: "last_update",
  TRADER_UNIVERSE: "traders:universe:active",
  SIGNALS_BASE: "signals:base:latest",
  SIGNALS_SERVED: "signals:served:latest",
  YOUTUBERS: "youtubers:latest",
  POSITION_SNAPSHOTS: "positions:snapshots:latest",
  POSITION_TIMINGS: "positions:timings:latest",
  POSITION_TIMING_QUEUE: "positions:timings:queue",
  NOTIFY_LAST_STATE: "notify:last-state",
  NOTIFY_COOLDOWNS: "notify:cooldowns",
} as const;
