import { getRedis, KEYS } from "@/lib/redis/client";
import type { BaseSignalSnapshot, ServedSignalSnapshot } from "./types";
import { parseJson } from "./repository-utils";

export interface SignalSnapshotRepository {
  loadBase(): Promise<BaseSignalSnapshot | null>;
  saveBase(snapshot: BaseSignalSnapshot): Promise<void>;
  loadServed(): Promise<ServedSignalSnapshot | null>;
  saveServed(snapshot: ServedSignalSnapshot): Promise<void>;
}

export class RedisSignalSnapshotRepository implements SignalSnapshotRepository {
  async loadBase(): Promise<BaseSignalSnapshot | null> {
    const raw = await getRedis().get<string>(KEYS.SIGNALS_BASE);
    return parseJson<BaseSignalSnapshot | null>(raw, null);
  }

  async saveBase(snapshot: BaseSignalSnapshot): Promise<void> {
    await getRedis().set(KEYS.SIGNALS_BASE, JSON.stringify(snapshot));
  }

  async loadServed(): Promise<ServedSignalSnapshot | null> {
    const raw = await getRedis().get<string>(KEYS.SIGNALS_SERVED);
    return parseJson<ServedSignalSnapshot | null>(raw, null);
  }

  async saveServed(snapshot: ServedSignalSnapshot): Promise<void> {
    await getRedis().set(KEYS.SIGNALS_SERVED, JSON.stringify(snapshot));
  }
}
