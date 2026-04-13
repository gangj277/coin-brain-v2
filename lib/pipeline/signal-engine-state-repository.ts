import type { PositionChange } from "@/lib/hyperliquid/tracker/types";
import { getRedis, KEYS } from "@/lib/redis/client";
import { parseJson } from "./repository-utils";
import type { SMIHistoryEntry, SignalSmiState } from "@/lib/signals/smi";
import type { SignalMarketData } from "./types";

export interface MarketContextHistoryEntry {
  timestamp: number;
  funding: number;
  fundingAnnual: number;
  openInterestUsd: number;
  dayChange: number;
  dayVolume: number;
}

export interface SignalEngineStateRepository {
  loadRecentPositionEvents(): Promise<PositionChange[]>;
  saveRecentPositionEvents(events: PositionChange[]): Promise<void>;
  loadSmiHistory(coins: string[]): Promise<Record<string, SMIHistoryEntry[]>>;
  saveSmiHistory(historyByCoin: Record<string, SMIHistoryEntry[]>): Promise<void>;
  saveLatestSmi(latestByCoin: Record<string, SignalSmiState>): Promise<void>;
  loadMarketContextHistory(
    coins: string[]
  ): Promise<Record<string, MarketContextHistoryEntry[]>>;
  saveMarketContextHistory(
    historyByCoin: Record<string, MarketContextHistoryEntry[]>
  ): Promise<void>;
}

export class RedisSignalEngineStateRepository
  implements SignalEngineStateRepository
{
  async loadRecentPositionEvents(): Promise<PositionChange[]> {
    const raw = await getRedis().get<string>(KEYS.POSITION_EVENTS_RECENT);
    return parseJson<PositionChange[]>(raw, []);
  }

  async saveRecentPositionEvents(events: PositionChange[]): Promise<void> {
    await getRedis().set(KEYS.POSITION_EVENTS_RECENT, JSON.stringify(events));
  }

  async loadSmiHistory(
    coins: string[]
  ): Promise<Record<string, SMIHistoryEntry[]>> {
    const uniqueCoins = [...new Set(coins.map((coin) => coin.toUpperCase()))];
    const entries = await Promise.all(
      uniqueCoins.map(async (coin) => {
        const raw = await getRedis().get<string>(KEYS.smiHistory(coin));
        return [coin, parseJson<SMIHistoryEntry[]>(raw, [])] as const;
      })
    );
    return Object.fromEntries(entries);
  }

  async saveSmiHistory(
    historyByCoin: Record<string, SMIHistoryEntry[]>
  ): Promise<void> {
    await Promise.all(
      Object.entries(historyByCoin).map(([coin, history]) =>
        getRedis().set(KEYS.smiHistory(coin), JSON.stringify(history))
      )
    );
  }

  async saveLatestSmi(
    latestByCoin: Record<string, SignalSmiState>
  ): Promise<void> {
    await getRedis().set(KEYS.SMI_ALL_LATEST, JSON.stringify(latestByCoin));
  }

  async loadMarketContextHistory(
    coins: string[]
  ): Promise<Record<string, MarketContextHistoryEntry[]>> {
    const uniqueCoins = [...new Set(coins.map((coin) => coin.toUpperCase()))];
    const entries = await Promise.all(
      uniqueCoins.map(async (coin) => {
        const raw = await getRedis().get<string>(KEYS.marketContextHistory(coin));
        return [coin, parseJson<MarketContextHistoryEntry[]>(raw, [])] as const;
      })
    );
    return Object.fromEntries(entries);
  }

  async saveMarketContextHistory(
    historyByCoin: Record<string, MarketContextHistoryEntry[]>
  ): Promise<void> {
    await Promise.all(
      Object.entries(historyByCoin).map(([coin, history]) =>
        getRedis().set(KEYS.marketContextHistory(coin), JSON.stringify(history))
      )
    );
  }
}

export function appendMarketContextHistory(
  history: MarketContextHistoryEntry[],
  market: SignalMarketData,
  timestamp: number
): MarketContextHistoryEntry[] {
  return [
    ...history,
    {
      timestamp,
      funding: market.funding,
      fundingAnnual: market.fundingAnnual,
      openInterestUsd: market.openInterestUsd,
      dayChange: market.dayChange,
      dayVolume: market.dayVolume,
    },
  ].slice(-720);
}
