import test from "node:test";
import assert from "node:assert/strict";

import { PositionCollectionService } from "@/lib/pipeline/position-collection-service";
import type { TraderUniverseSnapshot } from "@/lib/pipeline/types";
import type { ClearinghouseState } from "@/lib/hyperliquid/types";
import type { PositionChange } from "@/lib/hyperliquid/tracker/types";

function makeState(
  time: number,
  positions: Array<{ coin: string; szi: string; positionValue?: string }>
): ClearinghouseState {
  return {
    time,
    withdrawable: "0",
    marginSummary: {
      accountValue: "150000",
      totalMarginUsed: "25000",
      totalNtlPos: "50000",
      totalRawUsd: "25000",
    },
    assetPositions: positions.map((position) => ({
      type: "oneWay" as const,
      position: {
        coin: position.coin,
        entryPx: "68000",
        leverage: { type: "cross", value: 5, rawUsd: "25000" },
        liquidationPx: "61000",
        marginUsed: "25000",
        maxLeverage: 40,
        positionValue: position.positionValue ?? "50000",
        returnOnEquity: "0.12",
        szi: position.szi,
        unrealizedPnl: "6000",
        cumFunding: {
          allTime: "0",
          sinceChange: "0",
          sinceOpen: "0",
        },
      },
    })),
  };
}

test("PositionCollectionService persists recent events, SMI history, and market context history", async () => {
  const now = Date.UTC(2026, 3, 13, 12, 0, 0);
  const universe: TraderUniverseSnapshot = {
    refreshedAt: now - 60_000,
    source: "leaderboard",
    traders: [
      {
        address: "0xaaa",
        tier: "S",
        score: 90,
        refreshedAt: now - 60_000,
        source: "leaderboard",
        flags: [],
      },
      {
        address: "0xbbb",
        tier: "A",
        score: 80,
        refreshedAt: now - 60_000,
        source: "leaderboard",
        flags: [],
      },
    ],
    filters: {
      minAccountValue: 50_000,
      minAllTimePnl: 50_000,
      minMonthPnl: 1_000,
      minAllTimeRoi: 0.2,
      maxEntries: 300,
      minTier: "C",
      maxResults: 300,
    },
    totalCandidates: 2,
    totalRanked: 2,
  };

  const staleEvent: PositionChange = {
    type: "position_opened",
    traderAddress: "0xold",
    traderTier: "B",
    coin: "BTC",
    timestamp: now - 8 * 60 * 60 * 1000,
    previous: null,
    current: {
      coin: "BTC",
      szi: 1,
      entryPx: 60000,
      leverage: 4,
      positionValueUsd: 40000,
    },
  };

  let savedRecentEvents: PositionChange[] | null = null;
  let savedSmiHistory: Record<string, unknown> | null = null;
  let savedLatestSmi: Record<string, unknown> | null = null;
  let savedMarketHistory: Record<string, unknown> | null = null;

  const service = new PositionCollectionService({
    loadTimingState: async () => ({
      snapshots: {
        "0xaaa": makeState(now - 2 * 60 * 1000, []),
      },
      records: {},
      queue: [],
    }),
    saveTimingState: async () => {},
    fetchClearinghouseState: async (address: string) =>
      address === "0xaaa"
        ? makeState(now, [{ coin: "BTC", szi: "1", positionValue: "50000" }])
        : makeState(now, [{ coin: "BTC", szi: "0.8", positionValue: "45000" }]),
    fetchMetaAndAssetCtxs: async () => ({
      meta: { universe: [{ name: "BTC", szDecimals: 5, maxLeverage: 40 }] },
      contexts: new Map([
        [
          "BTC",
          {
            funding: "0.0001",
            openInterest: "1000",
            prevDayPx: "68000",
            dayNtlVlm: "123000000",
            premium: "0",
            oraclePx: "70000",
            markPx: "70000",
            midPx: "70000",
          },
        ],
      ]),
    }),
    fetchUserFillsByTime: async () => [],
    now: () => now,
    loadRecentPositionEvents: (async () => [staleEvent]) as any,
    saveRecentPositionEvents: (async (events: PositionChange[]) => {
      savedRecentEvents = events;
    }) as any,
    loadSmiHistory: (async () => ({
      BTC: [
        {
          smi: 35,
          smp: 40,
          fd: -5,
          cv: 10,
          traderCount: 2,
          timestamp: now - 2 * 60 * 1000,
        },
      ],
    })) as any,
    saveSmiHistory: (async (history: Record<string, unknown>) => {
      savedSmiHistory = history;
    }) as any,
    saveLatestSmi: (async (latest: Record<string, unknown>) => {
      savedLatestSmi = latest;
    }) as any,
    loadMarketContextHistory: (async () => ({ BTC: [] })) as any,
    saveMarketContextHistory: (async (history: Record<string, unknown>) => {
      savedMarketHistory = history;
    }) as any,
  } as any);

  const snapshot = await service.collect(universe);

  assert.equal(snapshot.signals.length, 1);
  assert.equal((snapshot.collection as any).recentEventsTracked, 2);
  assert.ok(savedRecentEvents, "expected persisted recent events");
  assert.equal((savedRecentEvents as PositionChange[]).length, 2);
  assert.equal((savedRecentEvents as PositionChange[])[0]?.traderAddress, "0xaaa");
  assert.ok(savedSmiHistory && Array.isArray((savedSmiHistory as any).BTC));
  assert.equal((savedSmiHistory as any).BTC.length, 2);
  assert.ok(savedLatestSmi && (savedLatestSmi as any).BTC);
  assert.ok(savedMarketHistory && Array.isArray((savedMarketHistory as any).BTC));
  assert.equal((savedMarketHistory as any).BTC.length, 1);
});
