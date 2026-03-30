import test from "node:test";
import assert from "node:assert/strict";

import type { ClearinghouseState, Fill } from "@/lib/hyperliquid/types";
import type { TraderTier } from "@/lib/hyperliquid/tracker/types";
import {
  createEmptyTimingState,
  getPositionTimingKey,
  syncPositionTimingForTrader,
  applyBackfillResult,
} from "@/lib/hyperliquid/timing/state";
import { resolveCurrentPositionTiming } from "@/lib/hyperliquid/timing/reconcile";
import {
  buildEntryMarkers,
  formatPositionTiming,
  getEntryMarkerKey,
} from "@/lib/hyperliquid/timing/presentation";

function makeState(
  time: number,
  positions: Array<{ coin: string; szi: string; entryPx?: string }>
): ClearinghouseState {
  return {
    time,
    withdrawable: "0",
    marginSummary: {
      accountValue: "100000",
      totalMarginUsed: "0",
      totalNtlPos: "0",
      totalRawUsd: "0",
    },
    assetPositions: positions.map((position) => ({
      type: "oneWay" as const,
      position: {
        coin: position.coin,
        entryPx: position.entryPx ?? "100",
        leverage: { type: "cross" as const, value: 10, rawUsd: "0" },
        liquidationPx: null,
        marginUsed: "1000",
        maxLeverage: 40,
        positionValue: "10000",
        returnOnEquity: "0.1",
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

function fill(overrides: Partial<Fill> & Pick<Fill, "time" | "startPosition" | "dir" | "sz">): Fill {
  return {
    coin: "BTC",
    px: "68000",
    side: "A",
    hash: "0xhash",
    oid: 1,
    crossed: true,
    fee: "0",
    feeToken: "USDC",
    tid: 1,
    closedPnl: "0",
    ...overrides,
  };
}

test("resolveCurrentPositionTiming reconstructs openedAt and lastAddedAt for scaled short", () => {
  const fills: Fill[] = [
    fill({ time: 4_000, startPosition: "-6", dir: "Close Short", sz: "2" }),
    fill({ time: 3_000, startPosition: "-5", dir: "Open Short", sz: "1" }),
    fill({ time: 2_000, startPosition: "-3", dir: "Open Short", sz: "2" }),
    fill({ time: 1_000, startPosition: "0", dir: "Open Short", sz: "3" }),
  ];

  const timing = resolveCurrentPositionTiming({
    currentSzi: -4,
    fills,
  });

  assert.equal(timing.openedAt, 1_000);
  assert.equal(timing.lastAddedAt, 3_000);
  assert.equal(timing.complete, true);
});

test("resolveCurrentPositionTiming reports incomplete history when opening fill is missing", () => {
  const fills: Fill[] = [
    fill({ time: 4_000, startPosition: "-6", dir: "Close Short", sz: "2" }),
    fill({ time: 3_000, startPosition: "-5", dir: "Open Short", sz: "1" }),
    fill({ time: 2_000, startPosition: "-3", dir: "Open Short", sz: "2" }),
  ];

  const timing = resolveCurrentPositionTiming({
    currentSzi: -4,
    fills,
  });

  assert.equal(timing.openedAt, null);
  assert.equal(timing.lastAddedAt, 3_000);
  assert.equal(timing.complete, false);
});

test("syncPositionTimingForTrader bootstraps pre-existing positions and queues top-tier backfill", () => {
  const address = "0xabc";
  const state = createEmptyTimingState();

  syncPositionTimingForTrader({
    address,
    tier: "S",
    prevState: null,
    currentState: makeState(10_000, [{ coin: "BTC", szi: "2" }]),
    timingState: state,
  });

  const key = getPositionTimingKey(address, "BTC");
  const record = state.records[key];

  assert.equal(record.preexisting, true);
  assert.equal(record.openedAt, null);
  assert.equal(record.observedAt, 10_000);
  assert.equal(record.backfillStatus, "pending");
  assert.deepEqual(state.queue.map((task) => task.strategy), ["1d"]);
});

test("syncPositionTimingForTrader detects open, increase, decrease, flip, and close transitions", () => {
  const address = "0xdef";
  const tier: TraderTier = "A";
  const state = createEmptyTimingState();

  syncPositionTimingForTrader({
    address,
    tier,
    prevState: null,
    currentState: makeState(1_000, []),
    timingState: state,
  });

  syncPositionTimingForTrader({
    address,
    tier,
    prevState: makeState(1_000, []),
    currentState: makeState(2_000, [{ coin: "BTC", szi: "1" }]),
    timingState: state,
  });

  const key = getPositionTimingKey(address, "BTC");
  assert.equal(state.records[key].preexisting, false);
  assert.equal(state.records[key].lastAddedAt, 2_000);
  assert.equal(state.records[key].backfillStatus, "pending");
  assert.deepEqual(
    state.queue.filter((task) => task.positionKey === key).map((task) => task.strategy),
    ["incremental"]
  );

  syncPositionTimingForTrader({
    address,
    tier,
    prevState: makeState(2_000, [{ coin: "BTC", szi: "1" }]),
    currentState: makeState(3_000, [{ coin: "BTC", szi: "3" }]),
    timingState: state,
  });
  assert.equal(state.records[key].lastAddedAt, 3_000);

  syncPositionTimingForTrader({
    address,
    tier,
    prevState: makeState(3_000, [{ coin: "BTC", szi: "3" }]),
    currentState: makeState(4_000, [{ coin: "BTC", szi: "2" }]),
    timingState: state,
  });
  assert.equal(state.records[key].lastChangedAt, 4_000);
  assert.equal(state.records[key].lastAddedAt, 3_000);

  syncPositionTimingForTrader({
    address,
    tier,
    prevState: makeState(4_000, [{ coin: "BTC", szi: "2" }]),
    currentState: makeState(5_000, [{ coin: "BTC", szi: "-1" }]),
    timingState: state,
  });
  assert.equal(state.records[key].observedAt, 5_000);
  assert.equal(state.records[key].lastAddedAt, 5_000);

  syncPositionTimingForTrader({
    address,
    tier,
    prevState: makeState(5_000, [{ coin: "BTC", szi: "-1" }]),
    currentState: makeState(6_000, []),
    timingState: state,
  });
  assert.equal(state.records[key], undefined);
});

test("applyBackfillResult upgrades exact fills timing and advances retry windows when unresolved", () => {
  const address = "0x123";
  const key = getPositionTimingKey(address, "BTC");
  const state = createEmptyTimingState({
    records: {
      [key]: {
        address,
        coin: "BTC",
        openedAt: null,
        lastAddedAt: 2_000,
        lastChangedAt: 2_000,
        observedAt: 2_000,
        timingSource: "diff",
        timingConfidence: "medium",
        preexisting: false,
        backfillStatus: "pending",
      },
    },
    queue: [
      {
        positionKey: key,
        address,
        coin: "BTC",
        strategy: "incremental",
        startTime: 1_000,
        endTime: 2_000,
        enqueuedAt: 2_000,
        traderTier: "A",
      },
    ],
  });

  applyBackfillResult({
    timingState: state,
    task: state.queue[0],
    result: { openedAt: 1_500, lastAddedAt: 1_800, complete: true },
  });

  assert.equal(state.records[key].openedAt, 1_500);
  assert.equal(state.records[key].lastAddedAt, 1_800);
  assert.equal(state.records[key].timingSource, "fills");
  assert.equal(state.records[key].timingConfidence, "high");
  assert.equal(state.records[key].backfillStatus, "done");
  assert.equal(state.queue.length, 0);

  const unresolved = createEmptyTimingState({
    records: {
      [key]: {
        ...state.records[key],
        openedAt: null,
        lastAddedAt: 2_000,
        timingSource: "bootstrap",
        timingConfidence: "low",
        backfillStatus: "pending",
      },
    },
    queue: [
      {
        positionKey: key,
        address,
        coin: "BTC",
        strategy: "1d",
        enqueuedAt: 2_000,
        traderTier: "S",
      },
    ],
  });

  applyBackfillResult({
    timingState: unresolved,
    task: unresolved.queue[0],
    result: { openedAt: null, lastAddedAt: null, complete: false },
    now: 10_000,
  });

  assert.equal(unresolved.records[key].backfillStatus, "pending");
  assert.deepEqual(unresolved.queue.map((task) => task.strategy), ["7d"]);
});

test("buildEntryMarkers uses exact timing when available and price fallback otherwise", () => {
  const markers = buildEntryMarkers({
    candles: [
      { time: 100, open: 1, high: 2, low: 0.5, close: 1.5 },
      { time: 200, open: 1.5, high: 2.5, low: 1, close: 2 },
    ],
    positions: [
      {
        address: "0x1",
        tier: "S",
        side: "LONG",
        entryPx: 100,
        sizeUsd: 1_000_000,
        leverage: 5,
        unrealizedPnl: 100,
        openedAt: 200_000,
        timingConfidence: "high",
      },
      {
        address: "0x2",
        tier: "A",
        side: "SHORT",
        entryPx: 0.75,
        sizeUsd: 500_000,
        leverage: 3,
        unrealizedPnl: 50,
        openedAt: 150_000,
        timingConfidence: "medium",
      },
    ],
  });

  assert.equal(markers.length, 2);
  assert.equal(markers[0].time, 100);
  assert.equal(markers[1].time, 200);

  const exact = formatPositionTiming({
    openedAt: Date.UTC(2026, 2, 29, 3, 0, 0),
    lastAddedAt: Date.UTC(2026, 2, 29, 4, 0, 0),
    observedAt: Date.UTC(2026, 2, 29, 2, 0, 0),
    timingConfidence: "high",
    preexisting: false,
  });
  assert.match(exact.primary, /최초 진입/);
  assert.match(exact.secondary ?? "", /최근 추가/);

  const fallback = formatPositionTiming({
    openedAt: null,
    lastAddedAt: null,
    observedAt: Date.UTC(2026, 2, 29, 2, 0, 0),
    timingConfidence: "low",
    preexisting: true,
  });
  assert.match(fallback.primary, /pre-existing/i);
  assert.match(fallback.secondary ?? "", /tracked since/i);
});

test("buildEntryMarkers decorates the selected marker and dims the rest", () => {
  const selectedPosition = {
    address: "0x1",
    tier: "A",
    side: "LONG" as const,
    entryPx: 100,
    sizeUsd: 1_000_000,
    leverage: 5,
    unrealizedPnl: 100,
    openedAt: 200_000,
    timingConfidence: "high" as const,
  };
  const unselectedPosition = {
    address: "0x2",
    tier: "A",
    side: "SHORT" as const,
    entryPx: 90,
    sizeUsd: 500_000,
    leverage: 3,
    unrealizedPnl: 50,
    openedAt: 150_000,
    timingConfidence: "high" as const,
  };
  const selectedKey = getEntryMarkerKey(selectedPosition);

  const markers = buildEntryMarkers({
    candles: [
      { time: 100, open: 1, high: 2, low: 0.5, close: 1.5 },
      { time: 200, open: 1.5, high: 2.5, low: 1, close: 2 },
    ],
    positions: [selectedPosition, unselectedPosition],
    selectedEntryKey: selectedKey,
  });

  const selectedMarker = markers.find((marker) => marker.id === selectedKey);
  const unselectedMarker = markers.find((marker) => marker.id !== selectedKey);

  assert.ok(selectedMarker);
  assert.ok(unselectedMarker);
  assert.match(selectedMarker?.text ?? "", /◉/);
  assert.notEqual(selectedMarker?.color, unselectedMarker?.color);
});
