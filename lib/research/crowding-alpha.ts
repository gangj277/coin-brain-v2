export interface BinanceFuturesCandle {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  trades: number;
  takerBuyBaseVolume: number;
  takerBuyQuoteVolume: number;
}

export interface BinanceFundingRate {
  fundingTime: number;
  fundingRate: number;
}

export interface CrowdingAlphaConfig {
  extensionLookbackBars: number;
  takerLookbackBars: number;
  zscoreLookbackBars: number;
  scoreThreshold: number;
  holdBars: number;
  feeBpsPerSide: number;
  componentMinZ?: number;
  priceWeight?: number;
  takerWeight?: number;
  fundingWeight?: number;
}

export interface CrowdingAlphaRow {
  timestamp: number;
  close: number;
  fundingRate: number;
  fundingZ: number;
  priceExtension: number;
  priceExtensionZ: number;
  takerImbalance: number;
  takerImbalanceZ: number;
  crowdingScore: number;
  signal: -1 | 0 | 1;
  componentAgreement: "aligned" | "mixed";
}

export interface CrowdingAlphaTrade {
  direction: -1 | 1;
  entryTimestamp: number;
  exitTimestamp: number;
  entryPrice: number;
  exitPrice: number;
  netReturn: number;
  holdBars: number;
}

export interface CrowdingAlphaBacktestResult {
  tradeCount: number;
  winRate: number;
  cumulativeReturn: number;
  averageTradeReturn: number;
  maxDrawdown: number;
  annualizedSharpe: number;
  exposureRatio: number;
  benchmarkReturn: number;
  trades: CrowdingAlphaTrade[];
  equityCurve: { timestamp: number; equity: number }[];
}

const DEFAULT_COMPONENT_MIN_Z = 0.25;
const DEFAULT_PRICE_WEIGHT = 0.5;
const DEFAULT_TAKER_WEIGHT = 0.3;
const DEFAULT_FUNDING_WEIGHT = 0.2;

export function buildCrowdingAlphaRows(
  candles: BinanceFuturesCandle[],
  fundingRates: BinanceFundingRate[],
  config: CrowdingAlphaConfig
): CrowdingAlphaRow[] {
  const normalized = normalizeConfig(config);
  const sortedCandles = [...candles].sort((a, b) => a.openTime - b.openTime);
  const sortedFunding = [...fundingRates].sort(
    (a, b) => a.fundingTime - b.fundingTime
  );
  const takerSeries = sortedCandles.map((candle) =>
    candle.quoteVolume > 0
      ? (2 * candle.takerBuyQuoteVolume) / candle.quoteVolume - 1
      : 0
  );

  const rows: CrowdingAlphaRow[] = [];
  const priceExtensions: number[] = [];
  const takerAverages: number[] = [];
  const fundingSeries: number[] = [];
  let fundingCursor = 0;
  let latestFunding = 0;

  for (let i = 0; i < sortedCandles.length; i += 1) {
    const candle = sortedCandles[i]!;

    while (
      fundingCursor < sortedFunding.length &&
      sortedFunding[fundingCursor]!.fundingTime <= candle.closeTime
    ) {
      latestFunding = sortedFunding[fundingCursor]!.fundingRate;
      fundingCursor += 1;
    }

    const priceExtension =
      i >= normalized.extensionLookbackBars
        ? Math.log(
            candle.close /
              sortedCandles[i - normalized.extensionLookbackBars]!.close
          )
        : 0;
    priceExtensions.push(priceExtension);

    const takerImbalance = rollingMean(
      takerSeries,
      i,
      normalized.takerLookbackBars
    );
    takerAverages.push(takerImbalance);
    fundingSeries.push(latestFunding);

    const ready =
      i >= normalized.extensionLookbackBars &&
      i >= normalized.takerLookbackBars - 1 &&
      i >= normalized.zscoreLookbackBars - 1;

    if (!ready) {
      rows.push({
        timestamp: candle.closeTime,
        close: candle.close,
        fundingRate: latestFunding,
        fundingZ: 0,
        priceExtension,
        priceExtensionZ: 0,
        takerImbalance,
        takerImbalanceZ: 0,
        crowdingScore: 0,
        signal: 0,
        componentAgreement: "mixed",
      });
      continue;
    }

    const priceExtensionZ = rollingZScore(
      priceExtensions,
      i,
      normalized.zscoreLookbackBars
    );
    const takerImbalanceZ = rollingZScore(
      takerAverages,
      i,
      normalized.zscoreLookbackBars
    );
    const fundingZ = rollingZScore(
      fundingSeries,
      i,
      normalized.zscoreLookbackBars
    );

    const componentAgreement = areComponentsAligned(
      priceExtensionZ,
      takerImbalanceZ,
      fundingZ,
      normalized.componentMinZ
    )
      ? "aligned"
      : "mixed";

    const crowdingScore =
      componentAgreement === "aligned"
        ? buildCrowdingScore(
            priceExtensionZ,
            takerImbalanceZ,
            fundingZ,
            normalized
          )
        : 0;
    const signal = deriveSignal(crowdingScore, normalized.scoreThreshold);

    rows.push({
      timestamp: candle.closeTime,
      close: candle.close,
      fundingRate: latestFunding,
      fundingZ,
      priceExtension,
      priceExtensionZ,
      takerImbalance,
      takerImbalanceZ,
      crowdingScore,
      signal,
      componentAgreement,
    });
  }

  return rows;
}

export function backtestCrowdingAlpha(
  rows: CrowdingAlphaRow[],
  config: Pick<CrowdingAlphaConfig, "holdBars" | "feeBpsPerSide">
): CrowdingAlphaBacktestResult {
  if (rows.length < 2) {
    return {
      tradeCount: 0,
      winRate: 0,
      cumulativeReturn: 0,
      averageTradeReturn: 0,
      maxDrawdown: 0,
      annualizedSharpe: 0,
      exposureRatio: 0,
      benchmarkReturn: 0,
      trades: [],
      equityCurve: rows.map((row) => ({ timestamp: row.timestamp, equity: 1 })),
    };
  }

  const feeRate = config.feeBpsPerSide / 10_000;
  const trades: CrowdingAlphaTrade[] = [];
  const equityCurve: { timestamp: number; equity: number }[] = [
    { timestamp: rows[0]!.timestamp, equity: 1 },
  ];
  const barReturns: number[] = [];

  let equity = 1;
  let activeTrade:
    | {
        direction: -1 | 1;
        entryIndex: number;
        remainingBars: number;
        multiplier: number;
      }
    | undefined;
  let activeBars = 0;

  for (let i = 0; i < rows.length - 1; i += 1) {
    const row = rows[i]!;
    const nextRow = rows[i + 1]!;
    let barMultiplier = 1;

    if (!activeTrade && row.signal !== 0 && i + config.holdBars < rows.length) {
      activeTrade = {
        direction: row.signal,
        entryIndex: i,
        remainingBars: config.holdBars,
        multiplier: 1,
      };
      barMultiplier *= 1 - feeRate;
      activeTrade.multiplier *= 1 - feeRate;
    }

    if (activeTrade) {
      const priceReturn = nextRow.close / row.close - 1;
      const strategyReturn = activeTrade.direction * priceReturn;
      barMultiplier *= 1 + strategyReturn;
      activeTrade.multiplier *= 1 + strategyReturn;
      activeTrade.remainingBars -= 1;
      activeBars += 1;

      if (activeTrade.remainingBars === 0) {
        barMultiplier *= 1 - feeRate;
        activeTrade.multiplier *= 1 - feeRate;
        trades.push({
          direction: activeTrade.direction,
          entryTimestamp: rows[activeTrade.entryIndex]!.timestamp,
          exitTimestamp: nextRow.timestamp,
          entryPrice: rows[activeTrade.entryIndex]!.close,
          exitPrice: nextRow.close,
          netReturn: activeTrade.multiplier - 1,
          holdBars: i + 1 - activeTrade.entryIndex,
        });
        activeTrade = undefined;
      }
    }

    const barReturn = barMultiplier - 1;
    barReturns.push(barReturn);
    equity *= barMultiplier;
    equityCurve.push({ timestamp: nextRow.timestamp, equity });
  }

  const winningTrades = trades.filter((trade) => trade.netReturn > 0).length;
  const averageTradeReturn =
    trades.length > 0
      ? trades.reduce((sum, trade) => sum + trade.netReturn, 0) / trades.length
      : 0;

  return {
    tradeCount: trades.length,
    winRate: trades.length > 0 ? winningTrades / trades.length : 0,
    cumulativeReturn: equity - 1,
    averageTradeReturn,
    maxDrawdown: computeMaxDrawdown(equityCurve),
    annualizedSharpe: computeAnnualizedSharpe(rows, barReturns),
    exposureRatio: barReturns.length > 0 ? activeBars / barReturns.length : 0,
    benchmarkReturn: rows.at(-1)!.close / rows[0]!.close - 1,
    trades,
    equityCurve,
  };
}

function normalizeConfig(config: CrowdingAlphaConfig) {
  return {
    ...config,
    componentMinZ: config.componentMinZ ?? DEFAULT_COMPONENT_MIN_Z,
    priceWeight: config.priceWeight ?? DEFAULT_PRICE_WEIGHT,
    takerWeight: config.takerWeight ?? DEFAULT_TAKER_WEIGHT,
    fundingWeight: config.fundingWeight ?? DEFAULT_FUNDING_WEIGHT,
  };
}

function rollingMean(series: number[], index: number, lookback: number) {
  const start = Math.max(0, index - lookback + 1);
  const window = series.slice(start, index + 1);
  if (window.length === 0) {
    return 0;
  }
  return window.reduce((sum, value) => sum + value, 0) / window.length;
}

function rollingZScore(series: number[], index: number, lookback: number) {
  const start = Math.max(0, index - lookback + 1);
  const window = series.slice(start, index + 1);
  if (window.length < 2) {
    return 0;
  }

  const mean = window.reduce((sum, value) => sum + value, 0) / window.length;
  const variance =
    window.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    window.length;
  const standardDeviation = Math.sqrt(variance);

  if (!Number.isFinite(standardDeviation) || standardDeviation === 0) {
    return 0;
  }

  return (series[index]! - mean) / standardDeviation;
}

function areComponentsAligned(
  priceExtensionZ: number,
  takerImbalanceZ: number,
  fundingZ: number,
  componentMinZ: number
) {
  const components = [priceExtensionZ, takerImbalanceZ, fundingZ];
  const directions = components
    .filter((value) => Math.abs(value) >= componentMinZ)
    .map((value) => Math.sign(value));

  if (directions.length !== 3) {
    return false;
  }

  return directions.every((direction) => direction === directions[0]);
}

function buildCrowdingScore(
  priceExtensionZ: number,
  takerImbalanceZ: number,
  fundingZ: number,
  config: ReturnType<typeof normalizeConfig>
) {
  const direction = Math.sign(priceExtensionZ) || 0;
  const magnitude =
    Math.abs(priceExtensionZ) * config.priceWeight +
    Math.abs(takerImbalanceZ) * config.takerWeight +
    Math.abs(fundingZ) * config.fundingWeight;

  return direction * magnitude;
}

function deriveSignal(
  crowdingScore: number,
  scoreThreshold: number
): -1 | 0 | 1 {
  if (crowdingScore >= scoreThreshold) {
    return -1;
  }
  if (crowdingScore <= -scoreThreshold) {
    return 1;
  }
  return 0;
}

function computeMaxDrawdown(equityCurve: { equity: number }[]) {
  let peak = equityCurve[0]?.equity ?? 1;
  let maxDrawdown = 0;

  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    const drawdown = peak > 0 ? point.equity / peak - 1 : 0;
    maxDrawdown = Math.min(maxDrawdown, drawdown);
  }

  return maxDrawdown;
}

function computeAnnualizedSharpe(
  rows: CrowdingAlphaRow[],
  barReturns: number[]
) {
  if (barReturns.length < 2) {
    return 0;
  }

  const mean =
    barReturns.reduce((sum, value) => sum + value, 0) / barReturns.length;
  const variance =
    barReturns.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (barReturns.length - 1);
  const standardDeviation = Math.sqrt(variance);

  if (!Number.isFinite(standardDeviation) || standardDeviation === 0) {
    return 0;
  }

  const averageBarMs =
    rows.length > 1
      ? (rows.at(-1)!.timestamp - rows[0]!.timestamp) / (rows.length - 1)
      : 60 * 60 * 1000;
  const barsPerYear =
    averageBarMs > 0
      ? (365 * 24 * 60 * 60 * 1000) / averageBarMs
      : 365 * 24;

  return (mean / standardDeviation) * Math.sqrt(barsPerYear);
}
