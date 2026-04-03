import { getRedis, KEYS } from "@/lib/redis/client";
import type { TraderUniverseSnapshot } from "./types";
import { parseJson } from "./repository-utils";

export interface TraderUniverseRepository {
  loadActive(): Promise<TraderUniverseSnapshot | null>;
  saveActive(snapshot: TraderUniverseSnapshot): Promise<void>;
}

export class RedisTraderUniverseRepository implements TraderUniverseRepository {
  async loadActive(): Promise<TraderUniverseSnapshot | null> {
    const raw = await getRedis().get<string>(KEYS.TRADER_UNIVERSE);
    return parseJson<TraderUniverseSnapshot | null>(raw, null);
  }

  async saveActive(snapshot: TraderUniverseSnapshot): Promise<void> {
    await getRedis().set(KEYS.TRADER_UNIVERSE, JSON.stringify(snapshot));
  }
}
