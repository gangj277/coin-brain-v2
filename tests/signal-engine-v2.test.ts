import test from "node:test";
import assert from "node:assert/strict";

import { aggregateSignals } from "@/lib/signals/aggregator";
import { PositionStore } from "@/lib/hyperliquid/tracker/store";
import type { ClearinghouseState } from "@/lib/hyperliquid/types";
import type { PositionTimingRecord } from "@/lib/hyperliquid/timing/types";
import {
  applyCooldowns,
  detectEvents,
  type CooldownState,
} from "@/lib/telegram/detector";
import type { ServedSignalSnapshot } from "@/lib/pipeline/types";

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

function buildServedSnapshot(
  signalOverrides: Partial<ServedSignalSnapshot["signals"][number]> = {}
): ServedSignalSnapshot {
  return {
    signals: [
      {
        coin: "BTC",
        type: "consensus",
        strength: "strong",
        dominantSide: "LONG",
        conviction: 92,
        totalTraders: 4,
        longTraders: 4,
        shortTraders: 0,
        totalValueUsd: 500_000,
        longValueUsd: 500_000,
        shortValueUsd: 0,
        avgLeverage: 5,
        avgEntryPx: 70_000,
        totalUnrealizedPnl: 25_000,
        sTierCount: 2,
        aTierCount: 1,
        timestamp: 1_710_000_000_000,
        positions: [],
        market: {
          markPx: 72_000,
          prevDayPx: 70_000,
          dayChange: 2.8,
          funding: 0.0001,
          fundingAnnual: 87.6,
          openInterest: 1_000,
          openInterestUsd: 72_000_000,
          dayVolume: 100_000_000,
        },
        analysis: null,
        narrative: "",
        ...signalOverrides,
      },
    ],
    count: 1,
    stats: null,
    timestamp: 1_710_000_000_000,
    etag: "\"etag\"",
  };
}

test("aggregateSignals adds legacy and v2 scoring layers plus SMI metadata", () => {
  const now = Date.UTC(2026, 3, 13, 12, 0, 0);
  const store = new PositionStore();

  const traders = [
    {
      address: "0xaaa",
      tier: "S" as const,
      state: makeState(now, "200000", [
        {
          coin: "BTC",
          szi: "1.0",
          leverage: 8,
          marginUsed: "40000",
          positionValue: "80000",
        },
      ]),
    },
    {
      address: "0xbbb",
      tier: "A" as const,
      state: makeState(now, "150000", [
        {
          coin: "BTC",
          szi: "0.8",
          leverage: 6,
          marginUsed: "20000",
          positionValue: "50000",
        },
      ]),
    },
    {
      address: "0xccc",
      tier: "B" as const,
      state: makeState(now, "50000", [
        {
          coin: "BTC",
          szi: "-0.2",
          leverage: 3,
          marginUsed: "5000",
          positionValue: "10000",
        },
      ]),
    },
  ];

  for (const trader of traders) {
    store.addTrader(trader.address, trader.tier, 70, "polling");
    store.updateState(trader.address, trader.state);
  }

  const timingRecords = {
    "0xaaa:BTC": makeTiming("0xaaa", "BTC", {
      openedAt: now - 15 * 60 * 1000,
      lastAddedAt: now - 5 * 60 * 1000,
      timingConfidence: "high",
    }),
    "0xbbb:BTC": makeTiming("0xbbb", "BTC", {
      openedAt: now - 2 * 60 * 60 * 1000,
      timingConfidence: "medium",
    }),
    "0xccc:BTC": makeTiming("0xccc", "BTC", {
      openedAt: null,
      lastAddedAt: null,
      timingSource: "bootstrap",
      timingConfidence: "low",
      preexisting: true,
    }),
  };

  const [signal] = aggregateSignals(store, timingRecords as Record<string, PositionTimingRecord>);

  assert.ok(signal, "expected BTC signal");
  assert.ok((signal as any).scoring, "expected nested scoring metadata");
  assert.ok((signal as any).scoring.legacy, "expected legacy scoring snapshot");
  assert.ok((signal as any).scoring.v2, "expected v2 scoring snapshot");
  assert.equal(
    typeof (signal as any).scoring.v2.marketAdjustment,
    "number",
    "expected v2 market adjustment"
  );
  assert.equal(
    typeof (signal as any).scoring.v2.velocity.score,
    "number",
    "expected velocity score"
  );
  assert.ok((signal as any).smi, "expected attached SMI payload");
  assert.equal(
    typeof (signal as any).smi.components.smp,
    "number",
    "expected SMI component breakdown"
  );
});

test("aggregateSignals exposes near_consensus alignmentBand while keeping mapped legacy type", () => {
  const now = Date.UTC(2026, 3, 13, 12, 0, 0);
  const store = new PositionStore();

  const setups = [
    { address: "0x111", tier: "S" as const, szi: "1.0", value: "100000" },
    { address: "0x222", tier: "B" as const, szi: "0.8", value: "80000" },
    { address: "0x333", tier: "A" as const, szi: "-0.6", value: "60000" },
  ];

  for (const setup of setups) {
    store.addTrader(setup.address, setup.tier, 70, "polling");
    store.updateState(
      setup.address,
      makeState(now, "150000", [
        {
          coin: "BTC",
          szi: setup.szi,
          positionValue: setup.value,
          leverage: 5,
          marginUsed: "10000",
        },
      ])
    );
  }

  const [signal] = aggregateSignals(store, {
    "0x111:BTC": makeTiming("0x111", "BTC", {
      openedAt: now - 10 * 60 * 1000,
      timingConfidence: "high",
    }),
    "0x222:BTC": makeTiming("0x222", "BTC", {
      openedAt: now - 8 * 60 * 1000,
      timingConfidence: "high",
    }),
    "0x333:BTC": makeTiming("0x333", "BTC", {
      openedAt: now - 12 * 60 * 1000,
      timingConfidence: "high",
    }),
  });

  assert.ok(signal, "expected signal");
  assert.equal((signal as any).scoring.v2.alignmentBand, "near_consensus");
  assert.equal(signal.type, "emerging");
});

test("detectEvents applies cooldowns per coin and event type", () => {
  const previous = buildServedSnapshot({
    sTierCount: 1,
    strength: "moderate",
    type: "emerging",
  });
  const current = buildServedSnapshot({
    sTierCount: 3,
    strength: "strong",
    type: "consensus",
  });

  const cooldowns: CooldownState = {
    "BTC:new_signal": 1_710_000_000_000,
  };

  const events = detectEvents(current, previous, cooldowns, 1_710_000_100_000);

  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "stier_surge");

  const updated = applyCooldowns({}, events, 1_710_000_100_000);
  assert.equal(typeof updated["BTC:stier_surge"], "number");
  assert.equal(updated.BTC, undefined);
});
