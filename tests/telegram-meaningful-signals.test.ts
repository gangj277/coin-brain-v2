import test from "node:test";
import assert from "node:assert/strict";

import { detectEvents } from "@/lib/telegram/detector";
import type { ServedSignal, ServedSignalSnapshot } from "@/lib/pipeline/types";

function buildTriggerPassingSignal(
  overrides: Partial<ServedSignal> = {}
): ServedSignal {
  return {
    coin: "BTC",
    type: "consensus",
    strength: "strong",
    dominantSide: "LONG",
    conviction: 90,
    totalTraders: 8,
    longTraders: 8,
    shortTraders: 0,
    totalValueUsd: 8_000_000,
    longValueUsd: 8_000_000,
    shortValueUsd: 0,
    avgLeverage: 6,
    avgEntryPx: 72_000,
    totalUnrealizedPnl: 100_000,
    sTierCount: 3,
    aTierCount: 2,
    positions: [],
    timestamp: 1_710_000_000_000,
    market: {
      markPx: 73_000,
      prevDayPx: 71_000,
      dayChange: 2.5,
      funding: 0.00005,
      fundingAnnual: 43.8,
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
        effectiveTraders: 9.2,
        marketAdjustment: 4,
        velocity: {
          dominantSide: "LONG",
          score: 75,
          rawScore: 20,
          longScore: 22,
          shortScore: 2,
          eventCount: 5,
        },
        concentration: { average: 0.16, maximum: 0.29, dominantAverage: 0.18 },
        crossSectional: {
          marketTilt: -0.15,
          coinTilt: 1,
          score: 3,
          idiosyncraticAlpha: 88,
        },
        viability: {
          downgraded: false,
          reason: null,
          scaleFloor: false,
          traderFloor: false,
          sTierFloor: false,
        },
        tradeTrigger: {
          score: 82,
          coreQuality: 34,
          idiosyncraticAlpha: 17,
          smiAlignment: 25,
          velocity: 11,
          viabilityPenalty: 0,
          gate: "pass",
        },
        totalScore: 98,
      },
    },
    smi: {
      smi: 70,
      components: { smp: 66, fd: 18, cv: 22 },
      signal: "LONG",
      confirmed: true,
      confidence: "high",
      persistenceCount: 3,
      effectiveParticipation: 9.2,
      traderCount: 8,
      timestamp: 1_710_000_000_000,
    },
    ...overrides,
  };
}

function snap(signals: ServedSignal[]): ServedSignalSnapshot {
  return {
    signals,
    count: signals.length,
    stats: null,
    timestamp: 1_710_000_000_000,
    etag: '"etag"',
  };
}

test("detectEvents suppresses signals without v2 tradeTrigger", () => {
  const legacyOnly = buildTriggerPassingSignal();
  // Strip v2 scoring to simulate legacy snapshot
  legacyOnly.scoring = undefined;
  const events = detectEvents(snap([legacyOnly]), null, {
    now: 1_710_000_120_000,
  });
  assert.deepEqual(events, []);
});

test("detectEvents surfaces new_signal when trigger gate passes", () => {
  const current = snap([buildTriggerPassingSignal()]);
  const events = detectEvents(current, null, { now: 1_710_000_120_000 });
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "new_signal");
});

test("detectEvents suppresses new_signal when S-tier count too low", () => {
  const sig = buildTriggerPassingSignal({ sTierCount: 1 });
  const events = detectEvents(snap([sig]), null, { now: 1_710_000_120_000 });
  assert.deepEqual(events, []);
});

test("detectEvents stier_surge requires same direction", () => {
  const prev = buildTriggerPassingSignal({ sTierCount: 1 });
  const curr = buildTriggerPassingSignal({ sTierCount: 4, dominantSide: "SHORT" });
  const events = detectEvents(snap([curr]), snap([prev]), {
    now: 1_710_000_120_000,
  });
  const surges = events.filter((e) => e.type === "stier_surge");
  assert.equal(surges.length, 0);
});

test("detectEvents strength_upgrade only moderate→strong", () => {
  const prev = buildTriggerPassingSignal({ strength: "weak" });
  const curr = buildTriggerPassingSignal({ strength: "strong" });
  const events = detectEvents(snap([curr]), snap([prev]), {
    now: 1_710_000_120_000,
  });
  // weak→strong is technically an upgrade but we skip unless moderate→strong
  // (because weak is treated as "not present")
  // So this should trigger new_signal instead of strength_upgrade
  const upgrades = events.filter((e) => e.type === "strength_upgrade");
  assert.equal(upgrades.length, 0);
  const news = events.filter((e) => e.type === "new_signal");
  assert.equal(news.length, 1);
});

test("detectEvents consensus_formed fires on alignment band transition", () => {
  const prev = buildTriggerPassingSignal({ type: "emerging" });
  prev.scoring!.v2.alignmentBand = "near_consensus";
  const curr = buildTriggerPassingSignal();
  const events = detectEvents(snap([curr]), snap([prev]), {
    now: 1_710_000_120_000,
  });
  const consensus = events.filter((e) => e.type === "consensus_formed");
  assert.equal(consensus.length, 1);
});
