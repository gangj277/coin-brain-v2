import test from "node:test";
import assert from "node:assert/strict";

import { formatAlert } from "@/lib/telegram/formatter";
import type { AlertEvent } from "@/lib/telegram/detector";

test("formatAlert includes alignment band, velocity, trade trigger, and SMI", () => {
  const event: AlertEvent = {
    type: "stier_surge",
    detail: "S-tier +2명 진입 (1→3)",
    priority: 1,
    triggerScore: 82,
    signal: {
      coin: "BTC",
      type: "consensus",
      strength: "strong",
      dominantSide: "LONG",
      conviction: 88,
      totalTraders: 7,
      longTraders: 6,
      shortTraders: 1,
      totalValueUsd: 5_250_000,
      longValueUsd: 5_000_000,
      shortValueUsd: 250_000,
      avgLeverage: 7.5,
      avgEntryPx: 68_000,
      totalUnrealizedPnl: 125_000,
      sTierCount: 3,
      aTierCount: 1,
      positions: [],
      timestamp: 1_710_000_000_000,
      market: {
        markPx: 70_000,
        prevDayPx: 68_500,
        dayChange: 2.2,
        funding: 0.0001,
        fundingAnnual: 87.6,
        openInterest: 1_000,
        openInterestUsd: 70_000_000,
        dayVolume: 150_000_000,
      },
      analysis: null,
      narrative: "",
      scoring: {
        legacy: {
          conviction: 82,
          type: "consensus",
          strength: "strong",
          dominantSide: "LONG",
          countAlignment: 0.86,
          valueAlignment: 0.9,
          sTierAlignment: 0.8,
          totalScore: 88,
        },
        v2: {
          conviction: 88,
          rawConviction: 82,
          type: "consensus",
          strength: "strong",
          dominantSide: "LONG",
          alignmentBand: "consensus",
          countAlignment: 0.86,
          valueAlignment: 0.9,
          sTierAlignment: 0.83,
          freshnessWeightedLongs: 8.4,
          freshnessWeightedShorts: 1.1,
          effectiveTraders: 8.8,
          marketAdjustment: 4,
          velocity: {
            dominantSide: "LONG",
            score: 82,
            rawScore: 9.1,
            longScore: 10.2,
            shortScore: 1.1,
            eventCount: 3,
          },
          concentration: {
            average: 0.16,
            maximum: 0.3,
            dominantAverage: 0.18,
          },
          crossSectional: {
            marketTilt: -0.12,
            coinTilt: 1,
            score: 2,
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
            idiosyncraticAlpha: 18,
            smiAlignment: 25,
            velocity: 12,
            viabilityPenalty: 0,
            gate: "pass",
          },
          totalScore: 104,
        },
      },
      smi: {
        smi: 64,
        components: {
          smp: 58,
          fd: 10,
          cv: 52,
        },
        signal: "LONG",
        confirmed: true,
        confidence: "medium",
        persistenceCount: 2,
        effectiveParticipation: 9.5,
        traderCount: 7,
        timestamp: 1_710_000_000_000,
      },
    },
  };

  const text = formatAlert(event);
  assert.match(text, /consensus/i);
  assert.match(text, /Velocity 82/);
  assert.match(text, /SMI 64/);
  assert.match(text, /Idio α/);
  assert.match(text, /Trigger 82\/100/);
});
