import test from "node:test";
import assert from "node:assert/strict";

import { aggregateSignals } from "@/lib/signals/aggregator";
import { PositionStore } from "@/lib/hyperliquid/tracker/store";
import type { ClearinghouseState } from "@/lib/hyperliquid/types";
import type { PositionTimingRecord } from "@/lib/hyperliquid/timing/types";
import {
  applyCooldowns,
  detectEvents,
  updateSideStreaks,
  type CooldownState,
  type SideStreakState,
  type DailyAlertStats,
} from "@/lib/telegram/detector";
import type { ServedSignal, ServedSignalSnapshot } from "@/lib/pipeline/types";

function makeState(
  time: number,
  accountValue: string,
  positions: Array<{
    coin: string;
    szi: string;
    entryPx?: string;
    leverage?: number;
    marginUsed?: string;
    positionValue?: string;
    returnOnEquity?: string;
  }>
): ClearinghouseState {
  return {
    time,
    withdrawable: "0",
    marginSummary: {
      accountValue,
      totalMarginUsed: "0",
      totalNtlPos: "0",
      totalRawUsd: "0",
    },
    assetPositions: positions.map((position) => ({
      type: "oneWay" as const,
      position: {
        coin: position.coin,
        entryPx: position.entryPx ?? "100",
        leverage: {
          type: "cross" as const,
          value: position.leverage ?? 5,
          rawUsd: position.marginUsed ?? "0",
        },
        liquidationPx: null,
        marginUsed: position.marginUsed ?? "1000",
        maxLeverage: 40,
        positionValue: position.positionValue ?? "10000",
        returnOnEquity: position.returnOnEquity ?? "0.1",
        szi: position.szi,
        unrealizedPnl: "100",
        cumFunding: {
          allTime: "0",
          sinceChange: "0",
          sinceOpen: "0",
        },
      },
    })),
  };
}

function makeTiming(
  address: string,
  coin: string,
  overrides: Partial<PositionTimingRecord> = {}
): PositionTimingRecord {
  return {
    address,
    coin,
    openedAt: 1_000,
    lastAddedAt: 2_000,
    lastChangedAt: 2_000,
    observedAt: 900,
    timingSource: "fills",
    timingConfidence: "high",
    preexisting: false,
    backfillStatus: "done",
    ...overrides,
  };
}

function buildStrongTriggerSignal(
  overrides: Partial<ServedSignal> = {}
): ServedSignal {
  return {
    coin: "BTC",
    type: "consensus",
    strength: "strong",
    dominantSide: "LONG",
    conviction: 92,
    totalTraders: 8,
    longTraders: 8,
    shortTraders: 0,
    totalValueUsd: 12_000_000,
    longValueUsd: 12_000_000,
    shortValueUsd: 0,
    avgLeverage: 6,
    avgEntryPx: 70_000,
    totalUnrealizedPnl: 250_000,
    sTierCount: 4,
    aTierCount: 2,
    timestamp: 1_710_000_000_000,
    positions: [],
    market: {
      markPx: 72_000,
      prevDayPx: 70_000,
      dayChange: 2.8,
      funding: 0.00008,
      fundingAnnual: 70.08,
      openInterest: 1_000,
      openInterestUsd: 72_000_000,
      dayVolume: 100_000_000,
    },
    analysis: null,
    narrative: "",
    scoring: {
      legacy: {
        conviction: 85,
        type: "consensus",
        strength: "strong",
        dominantSide: "LONG",
        countAlignment: 0.8,
        valueAlignment: 0.82,
        sTierAlignment: 0.8,
        totalScore: 90,
      },
      v2: {
        conviction: 88,
        rawConviction: 82,
        type: "consensus",
        strength: "strong",
        dominantSide: "LONG",
        alignmentBand: "consensus",
        countAlignment: 0.8,
        valueAlignment: 0.82,
        sTierAlignment: 0.83,
        freshnessWeightedLongs: 9.2,
        freshnessWeightedShorts: 0,
        effectiveTraders: 9.4,
        marketAdjustment: 4,
        velocity: {
          dominantSide: "LONG",
          score: 80,
          rawScore: 24,
          longScore: 26,
          shortScore: 2,
          eventCount: 6,
        },
        concentration: {
          average: 0.2,
          maximum: 0.31,
          dominantAverage: 0.22,
        },
        crossSectional: {
          marketTilt: -0.1,
          coinTilt: 1,
          score: 2,
          idiosyncraticAlpha: 90,
        },
        viability: {
          downgraded: false,
          reason: null,
          scaleFloor: false,
          traderFloor: false,
          sTierFloor: false,
        },
        tradeTrigger: {
          score: 85,
          coreQuality: 35,
          idiosyncraticAlpha: 18,
          smiAlignment: 28,
          velocity: 12,
          viabilityPenalty: 0,
          gate: "pass",
        },
        totalScore: 105,
      },
    },
    smi: {
      smi: 68,
      components: { smp: 64, fd: 18, cv: 22 },
      signal: "LONG",
      confirmed: true,
      confidence: "high",
      persistenceCount: 4,
      effectiveParticipation: 11,
      traderCount: 8,
      timestamp: 1_710_000_000_000,
    },
    ...overrides,
  };
}

function buildSnapshot(signals: ServedSignal[]): ServedSignalSnapshot {
  return {
    signals,
    count: signals.length,
    stats: null,
    timestamp: 1_710_000_000_000,
    etag: '"etag"',
  };
}

test("aggregateSignals attaches v2 scoring + SMI + crossSectional + viability + tradeTrigger", () => {
  const now = Date.UTC(2026, 3, 13, 12, 0, 0);
  const store = new PositionStore();

  const traders = [
    {
      address: "0xaaa",
      tier: "S" as const,
      state: makeState(now, "1000000", [
        {
          coin: "BTC",
          szi: "5.0",
          leverage: 8,
          marginUsed: "200000",
          positionValue: "5000000",
        },
      ]),
    },
    {
      address: "0xbbb",
      tier: "S" as const,
      state: makeState(now, "800000", [
        {
          coin: "BTC",
          szi: "4.0",
          leverage: 6,
          marginUsed: "150000",
          positionValue: "3000000",
        },
      ]),
    },
    {
      address: "0xccc",
      tier: "A" as const,
      state: makeState(now, "500000", [
        {
          coin: "BTC",
          szi: "3.0",
          leverage: 6,
          marginUsed: "100000",
          positionValue: "2000000",
        },
      ]),
    },
    {
      address: "0xddd",
      tier: "A" as const,
      state: makeState(now, "400000", [
        {
          coin: "BTC",
          szi: "2.0",
          leverage: 5,
          marginUsed: "80000",
          positionValue: "1500000",
        },
      ]),
    },
    {
      address: "0xeee",
      tier: "B" as const,
      state: makeState(now, "200000", [
        {
          coin: "BTC",
          szi: "1.5",
          leverage: 4,
          marginUsed: "50000",
          positionValue: "800000",
        },
      ]),
    },
  ];

  for (const trader of traders) {
    store.addTrader(trader.address, trader.tier, 85, "polling");
    store.updateState(trader.address, trader.state);
  }

  const timingRecords: Record<string, PositionTimingRecord> = {};
  for (const t of traders) {
    timingRecords[`${t.address}:BTC`] = makeTiming(t.address, "BTC", {
      openedAt: now - 30 * 60 * 1000,
      lastAddedAt: now - 15 * 60 * 1000,
      timingConfidence: "high",
    });
  }

  const [signal] = aggregateSignals(store, timingRecords, {
    now,
    marketByCoin: {
      BTC: {
        markPx: 72000,
        prevDayPx: 70000,
        dayChange: 2.85,
        funding: 0.00002,
        fundingAnnual: 17.5,
        openInterest: 1000,
        openInterestUsd: 72000000,
        dayVolume: 500000000,
      },
    },
  });

  assert.ok(signal, "expected BTC signal");
  const v2 = signal.scoring!.v2;
  assert.equal(v2.alignmentBand, "consensus");
  assert.equal(v2.dominantSide, "LONG");
  assert.ok(v2.crossSectional, "crossSectional attached");
  assert.ok(v2.viability, "viability attached");
  assert.ok(v2.tradeTrigger, "tradeTrigger attached");
  assert.equal(typeof v2.tradeTrigger.score, "number");
  assert.ok(["pass", "fail"].includes(v2.tradeTrigger.gate));
  assert.ok(signal.smi, "smi attached");
});

test("aggregateSignals viability floor downgrades tiny coin signals", () => {
  const now = Date.UTC(2026, 3, 13, 12, 0, 0);
  const store = new PositionStore();

  // 3 traders with tiny positions (~$30k total)
  for (const [i, tier] of (["S", "S", "S"] as const).entries()) {
    const addr = `0x${"a".repeat(39)}${i}`;
    store.addTrader(addr, tier, 90, "polling");
    store.updateState(
      addr,
      makeState(now, "100000", [
        {
          coin: "TINY",
          szi: "1.0",
          leverage: 3,
          marginUsed: "3000",
          positionValue: "10000",
        },
      ])
    );
  }

  const [signal] = aggregateSignals(store, {}, { now });
  assert.ok(signal, "expected signal");
  // Total value is $30k, below $200k moderate floor → weak
  assert.equal(signal.strength, "weak");
  assert.equal(signal.scoring!.v2.viability.scaleFloor, true);
  assert.equal(signal.scoring!.v2.tradeTrigger.gate, "fail");
});

test("detectEvents enforces daily cap", () => {
  const sig1 = buildStrongTriggerSignal({ coin: "BTC" });
  const sig2 = buildStrongTriggerSignal({ coin: "ETH" });
  const sig3 = buildStrongTriggerSignal({ coin: "SOL" });
  const current = buildSnapshot([sig1, sig2, sig3]);

  const dailyStats: DailyAlertStats = {
    bucketUtcDay: "2024-03-09",
    totalSent: 5, // cap reached
    perCoin: { BTC: 1, ETH: 1, SOL: 1, X: 1, Y: 1 },
  };

  const events = detectEvents(current, null, {
    dailyStats,
    now: Date.UTC(2024, 2, 9, 12, 0, 0),
  });
  assert.deepEqual(events, []);
});

test("detectEvents per-coin daily cap blocks third alert on same coin", () => {
  const current = buildSnapshot([
    buildStrongTriggerSignal({ coin: "BTC" }),
  ]);

  const dailyStats: DailyAlertStats = {
    bucketUtcDay: "2024-03-09",
    totalSent: 2,
    perCoin: { BTC: 2 }, // per-coin cap = 2
  };

  const events = detectEvents(current, null, {
    dailyStats,
    now: Date.UTC(2024, 2, 9, 12, 0, 0),
  });
  assert.deepEqual(events, []);
});

test("detectEvents side_flip requires stable streak", () => {
  const previous = buildSnapshot([
    buildStrongTriggerSignal({ coin: "BTC", dominantSide: "LONG" }),
  ]);
  const current = buildSnapshot([
    buildStrongTriggerSignal({
      coin: "BTC",
      dominantSide: "SHORT",
      longTraders: 0,
      shortTraders: 8,
      longValueUsd: 0,
      shortValueUsd: 12_000_000,
    }),
  ]);

  // Only 1 cycle in SHORT → below required streak of 3 → no flip alert
  const shortStreaks: SideStreakState = {
    BTC: { side: "SHORT", count: 1, updatedAt: 1_710_000_000_000 },
  };

  const events = detectEvents(current, previous, {
    sideStreaks: shortStreaks,
    now: 1_710_000_120_000,
  });
  const flips = events.filter((e) => e.type === "side_flip");
  assert.equal(flips.length, 0);

  // With 3 cycles of stability, flip should fire
  const stableStreaks: SideStreakState = {
    BTC: { side: "SHORT", count: 3, updatedAt: 1_710_000_000_000 },
  };
  const events2 = detectEvents(current, previous, {
    sideStreaks: stableStreaks,
    now: 1_710_000_120_000,
  });
  const flips2 = events2.filter((e) => e.type === "side_flip");
  assert.equal(flips2.length, 1);
});

test("detectEvents tradeTrigger gate fail suppresses alerts", () => {
  const failingSignal = buildStrongTriggerSignal({ coin: "BTC" });
  failingSignal.scoring!.v2.tradeTrigger = {
    ...failingSignal.scoring!.v2.tradeTrigger,
    score: 60,
    gate: "fail",
  };
  const current = buildSnapshot([failingSignal]);

  const events = detectEvents(current, null, { now: 1_710_000_120_000 });
  assert.deepEqual(events, []);
});

test("updateSideStreaks increments on same side, resets on flip", () => {
  const snapshot1 = buildSnapshot([
    buildStrongTriggerSignal({ coin: "BTC", dominantSide: "LONG" }),
  ]);
  const s1 = updateSideStreaks({}, snapshot1, 1_710_000_000_000);
  assert.equal(s1.BTC.count, 1);
  assert.equal(s1.BTC.side, "LONG");

  const s2 = updateSideStreaks(s1, snapshot1, 1_710_000_120_000);
  assert.equal(s2.BTC.count, 2);

  const flipped = buildSnapshot([
    buildStrongTriggerSignal({ coin: "BTC", dominantSide: "SHORT" }),
  ]);
  const s3 = updateSideStreaks(s2, flipped, 1_710_000_240_000);
  assert.equal(s3.BTC.count, 1);
  assert.equal(s3.BTC.side, "SHORT");
});

test("applyCooldowns writes coin:type keys and prunes old entries", () => {
  const now = 1_710_000_000_000;
  const events = [
    {
      type: "new_signal" as const,
      signal: buildStrongTriggerSignal({ coin: "BTC" }),
      detail: "test",
      priority: 1 as const,
      triggerScore: 85,
    },
  ];
  const old: CooldownState = {
    "SOL:new_signal": now - 4 * 60 * 60 * 1000, // 4h old → pruned
  };
  const updated = applyCooldowns(old, events, now);
  assert.equal(typeof updated["BTC:new_signal"], "number");
  assert.equal(updated["SOL:new_signal"], undefined);
});
