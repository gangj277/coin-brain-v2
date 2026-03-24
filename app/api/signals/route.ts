import { PositionTracker } from "@/lib/hyperliquid/tracker";
import { aggregateSignals, type Signal } from "@/lib/signals/aggregator";
import { narrateSignals, type NarratedSignal, type SignalAnalysis } from "@/lib/signals/narrator";
import { getMetaAndAssetCtxs } from "@/lib/hyperliquid/client";

const CACHE_TTL_MS = 10 * 60 * 1000;

interface AnalysisCache {
  analyses: Map<string, { analysis: SignalAnalysis | null; narrative: string }>;
  fingerprint: string;
  timestamp: number;
}

const CACHE_KEY = "__analysisCache__" as const;
declare global {
  // eslint-disable-next-line no-var
  var [CACHE_KEY]: AnalysisCache | undefined;
}

function getCache(): AnalysisCache | null {
  return globalThis[CACHE_KEY] ?? null;
}
function setCache(c: AnalysisCache) {
  globalThis[CACHE_KEY] = c;
}

function signalFingerprint(signals: Signal[]): string {
  return signals
    .filter((s) => s.strength !== "weak" && s.totalTraders >= 3)
    .slice(0, 15)
    .map((s) => {
      const roundedTraders = Math.round(s.totalTraders / 5) * 5;
      return `${s.coin}:${s.type}:${s.dominantSide}:${roundedTraders}`;
    })
    .sort()
    .join("|");
}

export async function GET() {
  const tracker = PositionTracker.getInstance();
  if (!tracker.isInitialized()) {
    return Response.json({ error: "Tracker not initialized" }, { status: 503 });
  }

  const store = tracker.getStore();
  const signals = aggregateSignals(store);

  // Fetch market data for each signal's coin
  let marketData: Record<string, {
    markPx: number;
    prevDayPx: number;
    dayChange: number;
    funding: number;
    fundingAnnual: number;
    openInterest: number;
    openInterestUsd: number;
    dayVolume: number;
  }> = {};

  try {
    const { contexts } = await getMetaAndAssetCtxs();
    for (const [coin, ctx] of contexts) {
      const mark = parseFloat(ctx.markPx);
      const prev = parseFloat(ctx.prevDayPx);
      const funding = parseFloat(ctx.funding);
      const oi = parseFloat(ctx.openInterest);
      marketData[coin] = {
        markPx: mark,
        prevDayPx: prev,
        dayChange: prev > 0 ? ((mark - prev) / prev) * 100 : 0,
        funding,
        fundingAnnual: funding * 24 * 365 * 100,
        openInterest: oi,
        openInterestUsd: oi * mark,
        dayVolume: parseFloat(ctx.dayNtlVlm),
      };
    }
  } catch {
    // continue without market data
  }

  const now = Date.now();
  const cache = getCache();
  const fingerprint = signalFingerprint(signals);
  const cacheAge = cache ? now - cache.timestamp : Infinity;
  const withinTTL = cacheAge < CACHE_TTL_MS;
  const fingerprintSame = cache?.fingerprint === fingerprint;
  const shouldRegenerate = !cache || (!withinTTL && !fingerprintSame);

  let narrated: NarratedSignal[];

  if (shouldRegenerate) {
    console.log(
      `[Signals] Generating analyses (cache age: ${(cacheAge / 1000).toFixed(0)}s, fp changed: ${!fingerprintSame})`
    );
    narrated = await narrateSignals(signals);
    const analyses = new Map<string, { analysis: SignalAnalysis | null; narrative: string }>();
    for (const s of narrated) {
      if (s.analysis || s.narrative) {
        analyses.set(s.coin, { analysis: s.analysis, narrative: s.narrative });
      }
    }
    setCache({ analyses, fingerprint, timestamp: now });
  } else {
    narrated = signals.map((s) => {
      const cached = cache!.analyses.get(s.coin);
      return { ...s, analysis: cached?.analysis ?? null, narrative: cached?.narrative ?? "" };
    });
  }

  // Attach market data to each signal
  const withMarket = narrated.map((s) => ({
    ...s,
    market: marketData[s.coin] ?? null,
  }));

  return Response.json({
    signals: withMarket,
    count: withMarket.length,
    stats: tracker.getStats(),
    timestamp: now,
    narrativeCache: {
      age: Math.round(cacheAge / 1000),
      ttl: CACHE_TTL_MS / 1000,
      regenerated: shouldRegenerate,
    },
  });
}
