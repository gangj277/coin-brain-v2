import test from "node:test";
import assert from "node:assert/strict";

import { formatAlert } from "@/lib/telegram/formatter";
import type { AlertEvent } from "@/lib/telegram/detector";

test("formatAlert includes alignment band, velocity, and SMI context", () => {
  const event = {
    type: "stier_surge",
    detail: "S-tier +2명 진입 (1→3)",
    priority: 1,
    signal: {
      coin: "BTC",
      type: "emerging",
      strength: "strong",
      dominantSide: "LONG",
      conviction: 78,
      totalTraders: 4,
      longTraders: 3,
      shortTraders: 1,
      totalValueUsd: 1_250_000,
      longValueUsd: 1_000_000,
      shortValueUsd: 250_000,
      avgLeverage: 7.5,
      avgEntryPx: 68_000,
      totalUnrealizedPnl: 25_000,
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
          conviction: 71,
          type: "emerging",
          strength: "moderate",
          dominantSide: "LONG",
          countAlignment: 0.67,
          valueAlignment: 0.8,
          sTierAlignment: 0.6,
          totalScore: 60,
        },
        v2: {
          conviction: 78,
          rawConviction: 72,
          type: "emerging",
          strength: "strong",
          dominantSide: "LONG",
          alignmentBand: "near_consensus",
          countAlignment: 0.66,
          valueAlignment: 0.8,
          sTierAlignment: 0.74,
          freshnessWeightedLongs: 7.2,
          freshnessWeightedShorts: 3.1,
          effectiveTraders: 2.8,
          marketAdjustment: 6,
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
          totalScore: 86,
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
        traderCount: 4,
        timestamp: 1_710_000_000_000,
      },
    },
  } satisfies AlertEvent as AlertEvent & { signal: AlertEvent["signal"] & Record<string, unknown> };

  const text = formatAlert(event);

  assert.match(text, /near_consensus/i);
  assert.match(text, /Velocity 82/);
  assert.match(text, /SMI 64/);
});
