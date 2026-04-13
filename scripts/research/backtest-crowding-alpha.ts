import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  backtestCrowdingAlpha,
  buildCrowdingAlphaRows,
  type BinanceFundingRate,
  type BinanceFuturesCandle,
  type CrowdingAlphaConfig,
  type CrowdingAlphaRow,
} from "@/lib/research/crowding-alpha";

const BINANCE_FUTURES_API = "https://fapi.binance.com";
const DEFAULT_CACHE_DIR = ".cache/binance-alpha";
const DEFAULT_SYMBOLS = ["BTCUSDT", "ETHUSDT"];
const DEFAULT_CONFIG: CrowdingAlphaConfig = {
  extensionLookbackBars: 24,
  takerLookbackBars: 4,
  zscoreLookbackBars: 72,
  scoreThreshold: 1.4,
  holdBars: 8,
  feeBpsPerSide: 5,
  componentMinZ: 0.25,
  priceWeight: 0.5,
  takerWeight: 0.3,
  fundingWeight: 0.2,
};
const DEFAULT_START = "2024-01-01";
const DEFAULT_END = "2026-04-03";
const DEFAULT_SPLIT = "2025-07-01";
const INTERVAL = "1h";
const INTERVAL_MS = 60 * 60 * 1000;

interface CliOptions extends CrowdingAlphaConfig {
  symbols: string[];
  startTime: number;
  endTime: number;
  splitTime: number;
  cacheDir: string;
}

interface SymbolReport {
  symbol: string;
  rows: CrowdingAlphaRow[];
  metrics: {
    full: ReturnType<typeof backtestCrowdingAlpha>;
    outOfSample: ReturnType<typeof backtestCrowdingAlpha>;
  };
  diagnostics: {
    alignedRowRatio: number;
    nonZeroSignalRatio: number;
    averageAbsoluteScore: number;
    averageSignedForwardReturnWhenShort: number;
    averageSignedForwardReturnWhenLong: number;
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const reports: SymbolReport[] = [];

  for (const symbol of options.symbols) {
    const [candles, fundingRates] = await Promise.all([
      fetchKlines(symbol, options.startTime, options.endTime, options.cacheDir),
      fetchFundingRates(
        symbol,
        options.startTime,
        options.endTime,
        options.cacheDir
      ),
    ]);

    const rows = buildCrowdingAlphaRows(candles, fundingRates, options);
    const full = backtestCrowdingAlpha(rows, options);
    const outOfSampleRows = rows.filter((row) => row.timestamp >= options.splitTime);
    const outOfSample =
      outOfSampleRows.length > 1
        ? backtestCrowdingAlpha(outOfSampleRows, options)
        : backtestCrowdingAlpha([], options);

    reports.push({
      symbol,
      rows,
      metrics: { full, outOfSample },
      diagnostics: buildDiagnostics(rows, options.holdBars),
    });
  }

  printReport(options, reports);
}

function parseArgs(argv: string[]): CliOptions {
  const raw = new Map<string, string>();

  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      continue;
    }
    const [key, value = "true"] = arg.slice(2).split("=");
    raw.set(key, value);
  }

  return {
    ...DEFAULT_CONFIG,
    symbols: (raw.get("symbols") ?? DEFAULT_SYMBOLS.join(","))
      .split(",")
      .map((symbol) => symbol.trim().toUpperCase())
      .filter(Boolean),
    startTime: parseDateArg(raw.get("start") ?? DEFAULT_START),
    endTime: parseDateArg(raw.get("end") ?? DEFAULT_END, true),
    splitTime: parseDateArg(raw.get("split") ?? DEFAULT_SPLIT),
    cacheDir: raw.get("cache-dir") ?? DEFAULT_CACHE_DIR,
    extensionLookbackBars: parseInteger(
      raw.get("extension-lookback"),
      DEFAULT_CONFIG.extensionLookbackBars
    ),
    takerLookbackBars: parseInteger(
      raw.get("taker-lookback"),
      DEFAULT_CONFIG.takerLookbackBars
    ),
    zscoreLookbackBars: parseInteger(
      raw.get("zscore-lookback"),
      DEFAULT_CONFIG.zscoreLookbackBars
    ),
    scoreThreshold: parseFloatArg(
      raw.get("threshold"),
      DEFAULT_CONFIG.scoreThreshold
    ),
    holdBars: parseInteger(raw.get("hold-bars"), DEFAULT_CONFIG.holdBars),
    feeBpsPerSide: parseFloatArg(
      raw.get("fee-bps"),
      DEFAULT_CONFIG.feeBpsPerSide
    ),
    componentMinZ: parseFloatArg(
      raw.get("component-min-z"),
      DEFAULT_CONFIG.componentMinZ ?? 0
    ),
    priceWeight: parseFloatArg(
      raw.get("price-weight"),
      DEFAULT_CONFIG.priceWeight ?? 0
    ),
    takerWeight: parseFloatArg(
      raw.get("taker-weight"),
      DEFAULT_CONFIG.takerWeight ?? 0
    ),
    fundingWeight: parseFloatArg(
      raw.get("funding-weight"),
      DEFAULT_CONFIG.fundingWeight ?? 0
    ),
  };
}

async function fetchKlines(
  symbol: string,
  startTime: number,
  endTime: number,
  cacheDir: string
) {
  const cacheKey = `${symbol}_${INTERVAL}_${startTime}_${endTime}_klines.json`;
  return withCache(cacheDir, cacheKey, async () => {
    const records: BinanceFuturesCandle[] = [];
    let cursor = startTime;

    while (cursor < endTime) {
      const response = await fetchJson(
        `${BINANCE_FUTURES_API}/fapi/v1/klines?symbol=${symbol}&interval=${INTERVAL}&limit=1500&startTime=${cursor}&endTime=${endTime}`
      );
      const batch = (response as unknown[]).map(parseKline);

      if (batch.length === 0) {
        break;
      }

      for (const candle of batch) {
        if (records.length === 0 || candle.openTime > records.at(-1)!.openTime) {
          records.push(candle);
        }
      }

      cursor = batch.at(-1)!.openTime + INTERVAL_MS;
      await sleep(80);
    }

    return records;
  });
}

async function fetchFundingRates(
  symbol: string,
  startTime: number,
  endTime: number,
  cacheDir: string
) {
  const cacheKey = `${symbol}_${startTime}_${endTime}_funding.json`;
  return withCache(cacheDir, cacheKey, async () => {
    const records: BinanceFundingRate[] = [];
    let cursor = startTime;

    while (cursor < endTime) {
      const response = await fetchJson(
        `${BINANCE_FUTURES_API}/fapi/v1/fundingRate?symbol=${symbol}&limit=1000&startTime=${cursor}&endTime=${endTime}`
      );
      const batch = (response as Array<Record<string, string | number>>).map(
        parseFundingRate
      );

      if (batch.length === 0) {
        break;
      }

      for (const item of batch) {
        if (records.length === 0 || item.fundingTime > records.at(-1)!.fundingTime) {
          records.push(item);
        }
      }

      cursor = batch.at(-1)!.fundingTime + 1;
      await sleep(80);
    }

    return records;
  });
}

async function withCache<T>(
  cacheDir: string,
  cacheKey: string,
  loader: () => Promise<T>
): Promise<T> {
  await mkdir(cacheDir, { recursive: true });
  const cachePath = path.join(cacheDir, cacheKey);

  try {
    const cached = await readFile(cachePath, "utf8");
    return JSON.parse(cached) as T;
  } catch {
    const loaded = await loader();
    await writeFile(cachePath, JSON.stringify(loaded), "utf8");
    return loaded;
  }
}

async function fetchJson(url: string, attempt = 1): Promise<unknown> {
  const response = await fetch(url);
  if (response.ok) {
    return response.json();
  }
  if (attempt >= 4) {
    throw new Error(`Binance request failed (${response.status}) for ${url}`);
  }

  await sleep(250 * attempt);
  return fetchJson(url, attempt + 1);
}

function parseKline(row: unknown): BinanceFuturesCandle {
  if (!Array.isArray(row)) {
    throw new Error("Unexpected kline payload");
  }

  return {
    openTime: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
    closeTime: Number(row[6]),
    quoteVolume: Number(row[7]),
    trades: Number(row[8]),
    takerBuyBaseVolume: Number(row[9]),
    takerBuyQuoteVolume: Number(row[10]),
  };
}

function parseFundingRate(
  row: Record<string, string | number>
): BinanceFundingRate {
  return {
    fundingTime: Number(row.fundingTime),
    fundingRate: Number(row.fundingRate),
  };
}

function buildDiagnostics(rows: CrowdingAlphaRow[], holdBars: number) {
  const alignedRows = rows.filter((row) => row.componentAgreement === "aligned");
  const signalRows = rows.filter((row) => row.signal !== 0);
  const averageAbsoluteScore =
    rows.length > 0
      ? rows.reduce((sum, row) => sum + Math.abs(row.crowdingScore), 0) /
        rows.length
      : 0;

  const shortReturns: number[] = [];
  const longReturns: number[] = [];
  for (let i = 0; i < rows.length - holdBars; i += 1) {
    const row = rows[i]!;
    if (row.signal === 0) {
      continue;
    }
    const exitRow = rows[i + holdBars]!;
    const forwardReturn = exitRow.close / row.close - 1;
    if (row.signal === -1) {
      shortReturns.push(-forwardReturn);
    } else {
      longReturns.push(forwardReturn);
    }
  }

  return {
    alignedRowRatio: rows.length > 0 ? alignedRows.length / rows.length : 0,
    nonZeroSignalRatio: rows.length > 0 ? signalRows.length / rows.length : 0,
    averageAbsoluteScore,
    averageSignedForwardReturnWhenShort: average(shortReturns),
    averageSignedForwardReturnWhenLong: average(longReturns),
  };
}

function printReport(options: CliOptions, reports: SymbolReport[]) {
  const thesis =
    "Leveraged one-way crowding, revealed by aligned price extension, same-side taker aggression, and funding pressure, tends to mean-revert over the next 8 hours on liquid Binance perpetual markets.";

  console.log("");
  console.log("Alpha Thesis");
  console.log(thesis);
  console.log("");
  console.log("Config");
  console.log(
    JSON.stringify(
      {
        symbols: options.symbols,
        start: new Date(options.startTime).toISOString().slice(0, 10),
        end: new Date(options.endTime).toISOString().slice(0, 10),
        split: new Date(options.splitTime).toISOString().slice(0, 10),
        interval: INTERVAL,
        extensionLookbackBars: options.extensionLookbackBars,
        takerLookbackBars: options.takerLookbackBars,
        zscoreLookbackBars: options.zscoreLookbackBars,
        scoreThreshold: options.scoreThreshold,
        holdBars: options.holdBars,
        feeBpsPerSide: options.feeBpsPerSide,
      },
      null,
      2
    )
  );

  for (const report of reports) {
    console.log("");
    console.log(`Symbol: ${report.symbol}`);
    console.log(
      formatMetrics("Full", report.metrics.full, report.rows.length, report.diagnostics)
    );
    console.log(
      formatMetrics(
        "Out-of-sample",
        report.metrics.outOfSample,
        report.rows.filter((row) => row.timestamp >= options.splitTime).length,
        report.diagnostics
      )
    );
  }
}

function formatMetrics(
  label: string,
  result: ReturnType<typeof backtestCrowdingAlpha>,
  rowCount: number,
  diagnostics: SymbolReport["diagnostics"]
) {
  return [
    `${label}:`,
    `  rows=${rowCount}`,
    `  trades=${result.tradeCount}`,
    `  winRate=${toPct(result.winRate)}`,
    `  cumulative=${toPct(result.cumulativeReturn)}`,
    `  avgTrade=${toPct(result.averageTradeReturn)}`,
    `  sharpe=${result.annualizedSharpe.toFixed(2)}`,
    `  maxDrawdown=${toPct(result.maxDrawdown)}`,
    `  benchmark=${toPct(result.benchmarkReturn)}`,
    `  exposure=${toPct(diagnostics.nonZeroSignalRatio)}`,
    `  alignedRows=${toPct(diagnostics.alignedRowRatio)}`,
    `  avgAbsScore=${diagnostics.averageAbsoluteScore.toFixed(2)}`,
    `  avgShortForward=${toPct(
      diagnostics.averageSignedForwardReturnWhenShort
    )}`,
    `  avgLongForward=${toPct(
      diagnostics.averageSignedForwardReturnWhenLong
    )}`,
  ].join("\n");
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function parseDateArg(value: string, inclusiveEnd = false) {
  const timestamp = Date.parse(
    inclusiveEnd ? `${value}T23:59:59.999Z` : `${value}T00:00:00.000Z`
  );
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Invalid date: ${value}`);
  }
  return timestamp;
}

function parseInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseFloatArg(value: string | undefined, fallback: number) {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toPct(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
