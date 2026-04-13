import test from "node:test";
import assert from "node:assert/strict";

import { detectEvents } from "@/lib/telegram/detector";
import type { ServedSignalSnapshot } from "@/lib/pipeline/types";

function buildSnapshot(
  overrides: Partial<ServedSignalSnapshot["signals"][number]> = {}
): ServedSignalSnapshot {
  return {
    signals: [
      {
        coin: "BTC",
        type: "consensus",
        strength: "strong",
        dominantSide: "LONG",
        conviction: 88,
        totalTraders: 5,
        longTraders: 5,
        shortTraders: 0,
        totalValueUsd: 900_000,
        longValueUsd: 900_000,
        shortValueUsd: 0,
        avgLeverage: 6,
        avgEntryPx: 72_000,
        totalUnrealizedPnl: 20_000,
        sTierCount: 2,
        aTierCount: 1,
        positions: [],
        timestamp: 1_710_000_000_000,
        market: {
          markPx: 73_000,
          prevDayPx: 71_000,
          dayChange: 2.5,
          funding: 0.0001,
          fundingAnnual: 87.6,
          openInterest: 1_200,
          openInterestUsd: 73_000_000,
          dayVolume: 180_000_000,
        },
        analysis: null,
        narrative: "",
        scoring: {
          legacy: {
            conviction: 82,
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
            rawConviction: 84,
            type: "consensus",
            strength: "strong",
            dominantSide: "LONG",
            alignmentBand: "consensus",
            countAlignment: 0.8,
            valueAlignment: 0.82,
            sTierAlignment: 0.84,
            freshnessWeightedLongs: 7.4,
            freshnessWeightedShorts: 0,
            effectiveTraders: 8.2,
            marketAdjustment: 6,
            velocity: {
              dominantSide: "LONG",
              score: 72,
              rawScore: 18,
              longScore: 20,
              shortScore: 2,
              eventCount: 4,
            },
            concentration: {
              average: 0.16,
              maximum: 0.29,
              dominantAverage: 0.18,
            },
            totalScore: 92,
          },
        },
        smi: {
          smi: 68,
          components: {
            smp: 64,
            fd: 18,
            cv: 22,
          },
          signal: "LONG",
          confirmed: true,
          confidence: "medium",
          persistenceCount: 3,
          effectiveParticipation: 9.2,
          traderCount: 5,
          timestamp: 1_710_000_000_000,
        },
        ...overrides,
      },
    ],
    count: 1,
    stats: null,
    timestamp: 1_710_000_000_000,
    etag: "\"etag\"",
  };
}

test("detectEvents suppresses noisy new signals that lack confirmation", () => {
  const current = buildSnapshot({
    strength: "moderate",
    conviction: 63,
    totalTraders: 3,
    longTraders: 3,
    totalValueUsd: 180_000,
    longValueUsd: 180_000,
    sTierCount: 1,
    scoring: {
      legacy: {
        conviction: 60,
        type: "emerging",
        strength: "moderate",
        dominantSide: "LONG",
        countAlignment: 0.66,
        valueAlignment: 0.7,
        sTierAlignment: 0.6,
        totalScore: 62,
      },
      v2: {
        conviction: 63,
        rawConviction: 71,
        type: "emerging",
        strength: "moderate",
        dominantSide: "LONG",
        alignmentBand: "near_consensus",
        countAlignment: 0.63,
        valueAlignment: 0.68,
        sTierAlignment: 0.61,
        freshnessWeightedLongs: 3.5,
        freshnessWeightedShorts: 0,
        effectiveTraders: 4.1,
        marketAdjustment: -9,
        velocity: {
          dominantSide: "LONG",
          score: 24,
          rawScore: 3,
          longScore: 4,
          shortScore: 1,
          eventCount: 1,
        },
        concentration: {
          average: 0.09,
          maximum: 0.12,
          dominantAverage: 0.09,
        },
        totalScore: 58,
      },
    },
    smi: {
      smi: 18,
      components: {
        smp: 22,
        fd: -10,
        cv: 6,
      },
      signal: "NEUTRAL",
      confirmed: false,
      confidence: "low",
      persistenceCount: 0,
      effectiveParticipation: 4.1,
      traderCount: 3,
      timestamp: 1_710_000_000_000,
    },
  });

  const events = detectEvents(current, null, {}, 1_710_000_120_000);
  assert.deepEqual(events, []);
});

test("detectEvents allows new signals when structure and SMI confirmation agree", () => {
  const current = buildSnapshot();

  const events = detectEvents(current, null, {}, 1_710_000_120_000);

  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "new_signal");
});

test("detectEvents still allows S-tier surges when the structural signal is already strong", () => {
  const previous = buildSnapshot({
    sTierCount: 1,
    scoring: {
      legacy: {
        conviction: 80,
        type: "consensus",
        strength: "strong",
        dominantSide: "LONG",
        countAlignment: 0.79,
        valueAlignment: 0.8,
        sTierAlignment: 0.76,
        totalScore: 88,
      },
      v2: {
        conviction: 86,
        rawConviction: 82,
        type: "consensus",
        strength: "strong",
        dominantSide: "LONG",
        alignmentBand: "consensus",
        countAlignment: 0.79,
        valueAlignment: 0.81,
        sTierAlignment: 0.8,
        freshnessWeightedLongs: 7.1,
        freshnessWeightedShorts: 0,
        effectiveTraders: 8.1,
        marketAdjustment: 2,
        velocity: {
          dominantSide: "LONG",
          score: 58,
          rawScore: 12,
          longScore: 14,
          shortScore: 2,
          eventCount: 3,
        },
        concentration: {
          average: 0.17,
          maximum: 0.28,
          dominantAverage: 0.19,
        },
        totalScore: 90,
      },
    },
    smi: {
      smi: 44,
      components: {
        smp: 52,
        fd: 8,
        cv: 10,
      },
      signal: "NEUTRAL",
      confirmed: false,
      confidence: "low",
      persistenceCount: 1,
      effectiveParticipation: 8.1,
      traderCount: 5,
      timestamp: 1_710_000_000_000,
    },
  });
  const current = buildSnapshot({
    sTierCount: 3,
    smi: {
      smi: 38,
      components: {
        smp: 42,
        fd: 6,
        cv: 8,
      },
      signal: "NEUTRAL",
      confirmed: false,
      confidence: "low",
      persistenceCount: 1,
      effectiveParticipation: 8.4,
      traderCount: 5,
      timestamp: 1_710_000_000_000,
    },
  });

  const events = detectEvents(current, previous, {}, 1_710_000_120_000);

  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "stier_surge");
});

test("detectEvents suppresses side flips until the new direction is confirmed", () => {
  const previous = buildSnapshot();
  const current = buildSnapshot({
    dominantSide: "SHORT",
    longTraders: 0,
    shortTraders: 5,
    longValueUsd: 0,
    shortValueUsd: 900_000,
    scoring: {
      legacy: {
        conviction: 84,
        type: "consensus",
        strength: "strong",
        dominantSide: "SHORT",
        countAlignment: 0.8,
        valueAlignment: 0.83,
        sTierAlignment: 0.82,
        totalScore: 90,
      },
      v2: {
        conviction: 90,
        rawConviction: 84,
        type: "consensus",
        strength: "strong",
        dominantSide: "SHORT",
        alignmentBand: "consensus",
        countAlignment: 0.8,
        valueAlignment: 0.83,
        sTierAlignment: 0.84,
        freshnessWeightedLongs: 0,
        freshnessWeightedShorts: 7.6,
        effectiveTraders: 8.4,
        marketAdjustment: 4,
        velocity: {
          dominantSide: "SHORT",
          score: 78,
          rawScore: -19,
          longScore: 2,
          shortScore: 21,
          eventCount: 5,
        },
        concentration: {
          average: 0.16,
          maximum: 0.29,
          dominantAverage: 0.18,
        },
        totalScore: 94,
      },
    },
    smi: {
      smi: 61,
      components: {
        smp: 58,
        fd: 12,
        cv: 17,
      },
      signal: "LONG",
      confirmed: true,
      confidence: "medium",
      persistenceCount: 3,
      effectiveParticipation: 9.1,
      traderCount: 5,
      timestamp: 1_710_000_000_000,
    },
  });

  const events = detectEvents(current, previous, {}, 1_710_000_120_000);
  assert.deepEqual(events, []);
});

test("detectEvents allows side flips when the new direction has strong confirmation", () => {
  const previous = buildSnapshot();
  const current = buildSnapshot({
    dominantSide: "SHORT",
    longTraders: 0,
    shortTraders: 5,
    longValueUsd: 0,
    shortValueUsd: 900_000,
    scoring: {
      legacy: {
        conviction: 84,
        type: "consensus",
        strength: "strong",
        dominantSide: "SHORT",
        countAlignment: 0.8,
        valueAlignment: 0.83,
        sTierAlignment: 0.82,
        totalScore: 90,
      },
      v2: {
        conviction: 92,
        rawConviction: 84,
        type: "consensus",
        strength: "strong",
        dominantSide: "SHORT",
        alignmentBand: "consensus",
        countAlignment: 0.8,
        valueAlignment: 0.83,
        sTierAlignment: 0.84,
        freshnessWeightedLongs: 0,
        freshnessWeightedShorts: 7.6,
        effectiveTraders: 8.4,
        marketAdjustment: 8,
        velocity: {
          dominantSide: "SHORT",
          score: 82,
          rawScore: -24,
          longScore: 1,
          shortScore: 25,
          eventCount: 5,
        },
        concentration: {
          average: 0.16,
          maximum: 0.29,
          dominantAverage: 0.18,
        },
        totalScore: 96,
      },
    },
    smi: {
      smi: -82,
      components: {
        smp: -76,
        fd: -22,
        cv: -24,
      },
      signal: "STRONG_SHORT",
      confirmed: true,
      confidence: "high",
      persistenceCount: 4,
      effectiveParticipation: 9.1,
      traderCount: 5,
      timestamp: 1_710_000_000_000,
    },
  });

  const events = detectEvents(current, previous, {}, 1_710_000_120_000);

  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "side_flip");
});
