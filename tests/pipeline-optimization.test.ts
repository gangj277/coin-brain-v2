import test from "node:test";
import assert from "node:assert/strict";

import { buildSignalsRouteHandler } from "@/app/api/signals/route";
import type { TraderCandidate } from "@/lib/hyperliquid/discovery";
import type { TraderTier } from "@/lib/hyperliquid/tracker/types";
import type { ClearinghouseState } from "@/lib/hyperliquid/types";
import { narrateSignals } from "@/lib/signals/narrator";
import { PositionCollectionService } from "@/lib/pipeline/position-collection-service";
import { SignalAnalysisService } from "@/lib/pipeline/signal-analysis-service";
import { SignalAssemblyService } from "@/lib/pipeline/signal-assembly-service";
import { TraderUniverseService } from "@/lib/pipeline/trader-universe-service";
import type {
  BaseSignalSnapshot,
  SignalAnalysisMap,
  TraderUniverseSnapshot,
} from "@/lib/pipeline/types";

function makeCandidate(address: string): TraderCandidate {
  return {
    address,
    source: "leaderboard",
    accountValue: 250_000,
    hasOpenPositions: true,
    positionCount: 2,
    leaderboard: {
      displayName: null,
      dayPnl: 10_000,
      dayRoi: 0.05,
      weekPnl: 50_000,
      weekRoi: 0.2,
      monthPnl: 80_000,
      monthRoi: 0.32,
      monthVolume: 75_000_000,
      allTimePnl: 500_000,
      allTimeRoi: 2.2,
      allTimeVolume: 500_000_000,
    },
  };
}

function makeState(
  time: number,
  address: string,
  size: string,
  tier: TraderTier = "C"
): {
  trader: TraderUniverseSnapshot["traders"][number];
  state: ClearinghouseState;
} {
  return {
    trader: {
      address: address.toLowerCase(),
      tier,
      score: 71.4,
      refreshedAt: time,
      source: "leaderboard",
      flags: [],
    },
    state: {
      time,
      withdrawable: "0",
      marginSummary: {
        accountValue: "150000",
        totalMarginUsed: "25000",
        totalNtlPos: "50000",
        totalRawUsd: "25000",
      },
      assetPositions: [
        {
          type: "oneWay",
          position: {
            coin: "BTC",
            entryPx: "68000",
            leverage: { type: "cross", value: 5, rawUsd: "25000" },
            liquidationPx: "61000",
            marginUsed: "25000",
            maxLeverage: 40,
            positionValue: "50000",
            returnOnEquity: "0.12",
            szi: size,
            unrealizedPnl: "6000",
            cumFunding: {
              allTime: "0",
              sinceChange: "0",
              sinceOpen: "0",
            },
          },
        },
      ],
    },
  };
}

function makeBaseSnapshot(): BaseSignalSnapshot {
  return {
    timestamp: 1_710_000_000_000,
    stats: {
      totalTraders: 2,
      wsTraders: 0,
      pollTraders: 2,
      tradersWithPositions: 2,
      totalPositions: 2,
      uniqueCoins: 1,
      recentChanges: 0,
    },
    market: {
      BTC: {
        markPx: 70000,
        prevDayPx: 68000,
        dayChange: 2.94,
        funding: 0.0001,
        fundingAnnual: 87.6,
        openInterest: 1000,
        openInterestUsd: 70_000_000,
        dayVolume: 123_000_000,
      },
    },
    collection: {
      traders: 2,
      positions: 2,
      durationMs: 1500,
      universeRefreshedAt: 1_709_999_000_000,
      timingQueueRemaining: 0,
      fallbackUniverseRefresh: false,
    },
    signals: [
      {
        coin: "BTC",
        type: "consensus",
        strength: "strong",
        dominantSide: "LONG",
        conviction: 92,
        totalTraders: 2,
        longTraders: 2,
        shortTraders: 0,
        totalValueUsd: 100000,
        longValueUsd: 100000,
        shortValueUsd: 0,
        avgLeverage: 5,
        avgEntryPx: 68000,
        totalUnrealizedPnl: 10000,
        sTierCount: 1,
        aTierCount: 0,
        timestamp: 1_710_000_000_000,
        market: {
          markPx: 70000,
          prevDayPx: 68000,
          dayChange: 2.94,
          funding: 0.0001,
          fundingAnnual: 87.6,
          openInterest: 1000,
          openInterestUsd: 70_000_000,
          dayVolume: 123_000_000,
        },
        positions: [
          {
            address: "0xaaa",
            tier: "S",
            side: "LONG",
            size: 0.7,
            sizeUsd: 50000,
            leverage: 5,
            leverageType: "cross",
            entryPx: 68000,
            liquidationPx: 61000,
            unrealizedPnl: 5000,
            returnOnEquity: 0.12,
            marginUsed: 10000,
            openedAt: 1_709_990_000_000,
            lastAddedAt: 1_709_995_000_000,
            observedAt: 1_709_999_000_000,
            timingSource: "fills",
            timingConfidence: "high",
            preexisting: false,
          },
          {
            address: "0xbbb",
            tier: "C",
            side: "LONG",
            size: 0.7,
            sizeUsd: 50000,
            leverage: 5,
            leverageType: "cross",
            entryPx: 68000,
            liquidationPx: 61000,
            unrealizedPnl: 5000,
            returnOnEquity: 0.12,
            marginUsed: 10000,
            openedAt: null,
            lastAddedAt: null,
            observedAt: 1_709_999_500_000,
            timingSource: "bootstrap",
            timingConfidence: "low",
            preexisting: true,
          },
        ],
      },
    ],
  };
}

test("TraderUniverseService refreshes stale universe inline and persists the refreshed roster", async () => {
  const staleSnapshot: TraderUniverseSnapshot = {
    refreshedAt: 1000,
    source: "leaderboard",
    traders: [],
    filters: {
      minAccountValue: 50_000,
      minAllTimePnl: 50_000,
      minMonthPnl: 1_000,
      minAllTimeRoi: 0.2,
      maxEntries: 300,
      minTier: "C",
      maxResults: 300,
    },
    totalCandidates: 0,
    totalRanked: 0,
  };

  let savedSnapshot: TraderUniverseSnapshot | null = null;
  const service = new TraderUniverseService({
    repository: {
      loadActive: async () => staleSnapshot,
      saveActive: async (snapshot) => {
        savedSnapshot = snapshot;
      },
    },
    discoverCandidates: async () => [makeCandidate("0x1111111111111111111111111111111111111111")],
    now: () => 2_000_000,
    config: {
      universeStaleMs: 60_000,
    },
  });

  const result = await service.ensureActiveUniverse();

  assert.equal(result.refreshedInline, true);
  assert.ok(savedSnapshot);
  if (!savedSnapshot) {
    throw new Error("expected persisted trader universe snapshot");
  }
  const persistedSnapshot = savedSnapshot as TraderUniverseSnapshot;
  assert.equal(persistedSnapshot.refreshedAt, 2_000_000);
  assert.equal(persistedSnapshot.traders.length, 1);
  assert.equal(
    persistedSnapshot.traders[0]?.address,
    "0x1111111111111111111111111111111111111111"
  );
  assert.equal(result.snapshot.traders[0]?.tier, "A");
});

test("PositionCollectionService reuses one market fetch per cycle and preserves timing metadata", async () => {
  const first = makeState(10_000, "0xaaa0000000000000000000000000000000000000", "1");
  const second = makeState(10_000, "0xbbb0000000000000000000000000000000000000", "1");
  const universe: TraderUniverseSnapshot = {
    refreshedAt: 9_000,
    source: "leaderboard",
    traders: [first.trader, second.trader],
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

  let marketFetchCount = 0;
  let savedTimingState: unknown = null;
  const service = new PositionCollectionService({
    loadTimingState: async () => ({
      snapshots: {
        [first.trader.address]: first.state,
      },
      records: {
        [`${first.trader.address}:BTC`]: {
          address: first.trader.address,
          coin: "BTC",
          openedAt: 4_000,
          lastAddedAt: 5_000,
          lastChangedAt: 6_000,
          observedAt: 9_500,
          timingSource: "fills",
          timingConfidence: "high",
          preexisting: false,
          backfillStatus: "done",
        },
      },
      queue: [],
    }),
    saveTimingState: async (state) => {
      savedTimingState = state;
    },
    fetchClearinghouseState: async (address) => {
      if (address === first.trader.address) return first.state;
      return second.state;
    },
    fetchMetaAndAssetCtxs: async () => {
      marketFetchCount += 1;
      return {
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
      };
    },
    fetchUserFillsByTime: async () => [],
    config: {
      pollBatchSize: 15,
      backfillBudget: 20,
      maxDurationMs: 60_000,
      backfillGuardMs: 10_000,
    },
  });

  const snapshot = await service.collect(universe);

  assert.equal(marketFetchCount, 1);
  assert.equal(snapshot.signals.length, 1);
  assert.equal(snapshot.signals[0]?.coin, "BTC");
  assert.equal(snapshot.signals[0]?.market?.markPx, 70000);
  assert.equal(snapshot.signals[0]?.positions[0]?.openedAt, 4_000);
  assert.ok(savedTimingState);
});

test("PositionCollectionService keeps the cycle alive when market enrichment fails", async () => {
  const first = makeState(10_000, "0xaaa0000000000000000000000000000000000000", "1");
  const second = makeState(10_000, "0xbbb0000000000000000000000000000000000000", "1");
  const universe: TraderUniverseSnapshot = {
    refreshedAt: 9_000,
    source: "leaderboard",
    traders: [first.trader, second.trader],
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

  const service = new PositionCollectionService({
    loadTimingState: async () => ({
      snapshots: {},
      records: {},
      queue: [],
    }),
    saveTimingState: async () => {},
    fetchClearinghouseState: async (address) => {
      if (address === first.trader.address) return first.state;
      return second.state;
    },
    fetchMetaAndAssetCtxs: async () => {
      throw new Error("market unavailable");
    },
    fetchUserFillsByTime: async () => [],
  });

  const snapshot = await service.collect(universe);

  assert.equal(snapshot.signals.length, 1);
  assert.equal(snapshot.signals[0]?.market, null);
  assert.deepEqual(snapshot.market, {});
});

test("narrateSignals reuses attached market data and skips Hyperliquid refetch when market is present", async (t) => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-key";

  const fetchMock = t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("api.hyperliquid.xyz")) {
      throw new Error("unexpected Hyperliquid market fetch");
    }

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                analyses: [
                  {
                    index: 1,
                    marketContext: "market",
                    positionAnalysis: "position",
                    riskAssessment: "risk",
                    conclusion: "conclusion",
                    sentiment: "bullish",
                    confidenceLevel: "high",
                  },
                ],
              }),
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  });

  try {
    const narrated = await narrateSignals([
      {
        ...makeBaseSnapshot().signals[0],
        totalTraders: 3,
        positions: [
          ...makeBaseSnapshot().signals[0].positions,
          {
            ...makeBaseSnapshot().signals[0].positions[1],
            address: "0xccc",
          },
        ],
      },
    ]);

    assert.equal(fetchMock.mock.calls.length, 1);
    assert.equal(narrated[0]?.analysis?.conclusion, "conclusion");
  } finally {
    if (previousKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = previousKey;
    }
  }
});

test("buildSignalsRouteHandler serves precomputed snapshots and honors conditional requests", async () => {
  const assembly = new SignalAssemblyService();
  const served = assembly.buildServedSnapshot(makeBaseSnapshot());
  const handler = buildSignalsRouteHandler({
    loadServed: async () => served,
  });

  const okResponse = await handler(new Request("http://localhost/api/signals"));
  assert.equal(okResponse.status, 200);
  assert.equal(okResponse.headers.get("etag"), served.etag);
  assert.equal(
    okResponse.headers.get("cache-control"),
    "private, max-age=0, must-revalidate"
  );
  assert.deepEqual(await okResponse.json(), {
    signals: served.signals,
    count: served.count,
    stats: served.stats,
    timestamp: served.timestamp,
  });

  const notModified = await handler(
    new Request("http://localhost/api/signals", {
      headers: {
        "if-none-match": served.etag,
      },
    })
  );
  assert.equal(notModified.status, 304);
});

test("staged services compose into a full snapshot pipeline without changing signal payload fields", async () => {
  let storedUniverse: TraderUniverseSnapshot | null = null;
  let storedBase: BaseSignalSnapshot | null = null;
  let storedServed: ReturnType<SignalAssemblyService["buildServedSnapshot"]> | null = null;

  const first = makeState(15_000, "0xaaa0000000000000000000000000000000000000", "1");
  const second = makeState(15_000, "0xbbb0000000000000000000000000000000000000", "1");

  const universeService = new TraderUniverseService({
    repository: {
      loadActive: async () => storedUniverse,
      saveActive: async (snapshot) => {
        storedUniverse = snapshot;
      },
    },
    discoverCandidates: async () => [
      makeCandidate(first.trader.address),
      makeCandidate(second.trader.address),
    ],
    now: () => 15_000,
    config: {
      universeStaleMs: 60_000,
    },
  });

  const universe = await universeService.refreshActiveUniverse();

  const collectionService = new PositionCollectionService({
    loadTimingState: async () => ({
      snapshots: {
        [first.trader.address]: first.state,
      },
      records: {
        [`${first.trader.address}:BTC`]: {
          address: first.trader.address,
          coin: "BTC",
          openedAt: 3_000,
          lastAddedAt: 4_000,
          lastChangedAt: 5_000,
          observedAt: 10_000,
          timingSource: "fills",
          timingConfidence: "high",
          preexisting: false,
          backfillStatus: "done",
        },
      },
      queue: [],
    }),
    saveTimingState: async () => {},
    fetchClearinghouseState: async (address) => {
      if (address === first.trader.address) return first.state;
      return second.state;
    },
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
  });

  storedBase = await collectionService.collect(universe);
  const assembly = new SignalAssemblyService();
  storedServed = assembly.buildServedSnapshot(storedBase);

  const analysisService = new SignalAnalysisService({
    narrate: async () =>
      [
        {
          ...storedBase!.signals[0],
          analysis: {
            marketContext: "market",
            positionAnalysis: "position",
            riskAssessment: "risk",
            conclusion: "conclusion",
            sentiment: "bullish",
            confidenceLevel: "high",
          },
          narrative: "conclusion",
        },
      ],
  });

  const analysisMap: SignalAnalysisMap = await analysisService.analyze(storedBase);
  storedServed = assembly.buildServedSnapshot(storedBase, analysisMap);

  assert.ok(storedUniverse);
  if (!storedUniverse) {
    throw new Error("expected stored trader universe");
  }
  const persistedUniverse = storedUniverse as TraderUniverseSnapshot;
  assert.equal(persistedUniverse.traders.length, 2);
  assert.equal(storedBase.signals[0]?.positions[0]?.openedAt, 3_000);
  assert.equal(storedServed.signals[0]?.analysis?.conclusion, "conclusion");
  assert.equal(storedServed.signals[0]?.positions[0]?.openedAt, 3_000);
});
