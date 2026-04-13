import test from "node:test";
import assert from "node:assert/strict";

import {
  backtestCrowdingAlpha,
  buildCrowdingAlphaRows,
  type BinanceFuturesCandle,
  type BinanceFundingRate,
  type CrowdingAlphaConfig,
  type CrowdingAlphaRow,
} from "@/lib/research/crowding-alpha";

function makeCandle(
  index: number,
  close: number,
  takerBuyQuoteVolume: number,
  quoteVolume = 100
): BinanceFuturesCandle {
  const openTime = index * 60 * 60 * 1000;
  return {
    openTime,
    closeTime: openTime + 60 * 60 * 1000 - 1,
    open: close,
    high: close,
    low: close,
    close,
    volume: quoteVolume,
    quoteVolume,
    trades: 10,
    takerBuyBaseVolume: takerBuyQuoteVolume,
    takerBuyQuoteVolume,
  };
}

function makeFunding(index: number, fundingRate: number): BinanceFundingRate {
  return {
    fundingTime: index * 60 * 60 * 1000,
    fundingRate,
  };
}

test("buildCrowdingAlphaRows emits a contrarian short signal when price, flow, and funding all crowd long", () => {
  const candles = [
    makeCandle(0, 100, 50),
    makeCandle(1, 101, 52),
    makeCandle(2, 102, 53),
    makeCandle(3, 103, 55),
    makeCandle(4, 104, 56),
    makeCandle(5, 105, 82),
    makeCandle(6, 108, 88),
    makeCandle(7, 112, 92),
  ];
  const funding = [
    makeFunding(0, 0.00001),
    makeFunding(2, 0.00002),
    makeFunding(4, 0.00003),
    makeFunding(6, 0.00012),
  ];
  const config: CrowdingAlphaConfig = {
    extensionLookbackBars: 2,
    takerLookbackBars: 2,
    zscoreLookbackBars: 4,
    scoreThreshold: 0.8,
    holdBars: 2,
    feeBpsPerSide: 5,
  };

  const rows = buildCrowdingAlphaRows(candles, funding, config);
  const last = rows.at(-1);

  assert.ok(last);
  assert.equal(last?.componentAgreement, "aligned");
  assert.equal(last?.signal, -1);
  assert.ok((last?.crowdingScore ?? 0) > config.scoreThreshold);
});

test("buildCrowdingAlphaRows stays neutral when the components disagree", () => {
  const candles = [
    makeCandle(0, 100, 50),
    makeCandle(1, 99, 52),
    makeCandle(2, 98, 53),
    makeCandle(3, 99, 40),
    makeCandle(4, 100, 35),
    makeCandle(5, 103, 30),
    makeCandle(6, 107, 25),
    makeCandle(7, 112, 20),
  ];
  const funding = [
    makeFunding(0, 0.00001),
    makeFunding(2, 0.00002),
    makeFunding(4, -0.00008),
    makeFunding(6, -0.0001),
  ];
  const config: CrowdingAlphaConfig = {
    extensionLookbackBars: 2,
    takerLookbackBars: 2,
    zscoreLookbackBars: 4,
    scoreThreshold: 0.8,
    holdBars: 2,
    feeBpsPerSide: 5,
  };

  const rows = buildCrowdingAlphaRows(candles, funding, config);
  const last = rows.at(-1);

  assert.ok(last);
  assert.equal(last?.componentAgreement, "mixed");
  assert.equal(last?.signal, 0);
  assert.equal(last?.crowdingScore, 0);
});

test("backtestCrowdingAlpha computes trade metrics for sequential non-overlapping signals", () => {
  const rows: CrowdingAlphaRow[] = [
    {
      timestamp: 0,
      close: 100,
      fundingRate: 0.0001,
      fundingZ: 2,
      priceExtension: 0.03,
      priceExtensionZ: 2,
      takerImbalance: 0.4,
      takerImbalanceZ: 2,
      crowdingScore: 2,
      signal: -1,
      componentAgreement: "aligned",
    },
    {
      timestamp: 1,
      close: 90,
      fundingRate: 0,
      fundingZ: 0,
      priceExtension: 0,
      priceExtensionZ: 0,
      takerImbalance: 0,
      takerImbalanceZ: 0,
      crowdingScore: 0,
      signal: 0,
      componentAgreement: "mixed",
    },
    {
      timestamp: 2,
      close: 90,
      fundingRate: -0.0001,
      fundingZ: -2,
      priceExtension: -0.03,
      priceExtensionZ: -2,
      takerImbalance: -0.4,
      takerImbalanceZ: -2,
      crowdingScore: -2,
      signal: 1,
      componentAgreement: "aligned",
    },
    {
      timestamp: 3,
      close: 99,
      fundingRate: 0,
      fundingZ: 0,
      priceExtension: 0,
      priceExtensionZ: 0,
      takerImbalance: 0,
      takerImbalanceZ: 0,
      crowdingScore: 0,
      signal: 0,
      componentAgreement: "mixed",
    },
    {
      timestamp: 4,
      close: 99,
      fundingRate: 0,
      fundingZ: 0,
      priceExtension: 0,
      priceExtensionZ: 0,
      takerImbalance: 0,
      takerImbalanceZ: 0,
      crowdingScore: 0,
      signal: 0,
      componentAgreement: "mixed",
    },
  ];

  const result = backtestCrowdingAlpha(rows, {
    holdBars: 1,
    feeBpsPerSide: 5,
  });

  assert.equal(result.tradeCount, 2);
  assert.equal(result.winRate, 1);
  assert.ok(result.cumulativeReturn > 0.15);
  assert.ok(result.averageTradeReturn > 0.08);
});
