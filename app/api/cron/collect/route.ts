import { NextRequest } from "next/server";
import { redis, KEYS } from "@/lib/redis/client";
import { discoverFromLeaderboard } from "@/lib/hyperliquid/discovery";
import { scoreFromLeaderboard, rankTraders } from "@/lib/hyperliquid/scoring";
import { getClearinghouseState, getMetaAndAssetCtxs } from "@/lib/hyperliquid/client";
import { aggregateSignals } from "@/lib/signals/aggregator";
import { PositionStore } from "@/lib/hyperliquid/tracker/store";

export const maxDuration = 60; // Allow up to 60s for this cron

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = Date.now();

  try {
    // 1. Discover & score traders from leaderboard
    const candidates = await discoverFromLeaderboard({
      minAccountValue: 50_000,
      minAllTimePnl: 50_000,
      minMonthPnl: 1_000,
      minAllTimeRoi: 0.2,
      maxEntries: 300,
    });

    const scores = candidates
      .map((c) => ({ candidate: c, score: scoreFromLeaderboard(c) }))
      .filter((s) => s.score.totalScore > 0);

    const ranked = rankTraders(
      scores.map((s) => s.score),
      { minTier: "C", maxResults: 300 }
    );

    // 2. Fetch positions for top traders
    const store = new PositionStore();
    const addresses = ranked.map((s) => s.address.toLowerCase());

    // Batch fetch in groups of 15
    for (let i = 0; i < addresses.length; i += 15) {
      const batch = addresses.slice(i, i + 15);
      const results = await Promise.allSettled(
        batch.map(async (addr) => {
          const tier = ranked.find((r) => r.address === addr)!.tier;
          const score = ranked.find((r) => r.address === addr)!.totalScore;
          store.addTrader(addr, tier, score, "polling");
          const state = await getClearinghouseState(addr);
          store.updateState(addr, state);
        })
      );
    }

    // 3. Aggregate signals
    const signals = aggregateSignals(store);

    // 4. Fetch market data
    let marketData: Record<string, unknown> = {};
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
    } catch {}

    // 5. Attach market data to signals
    const withMarket = signals.map((s) => ({
      ...s,
      market: marketData[s.coin] ?? null,
    }));

    // 6. Store in Redis
    const storeStats = store.getStats();
    await Promise.all([
      redis.set(KEYS.SIGNALS, JSON.stringify(withMarket)),
      redis.set(KEYS.STATS, JSON.stringify(storeStats)),
      redis.set(KEYS.MARKET, JSON.stringify(marketData)),
      redis.set(KEYS.LAST_UPDATE, Date.now()),
    ]);

    const duration = Date.now() - start;

    return Response.json({
      ok: true,
      traders: addresses.length,
      signals: withMarket.length,
      positions: storeStats.totalPositions,
      duration: `${(duration / 1000).toFixed(1)}s`,
    });
  } catch (e) {
    return Response.json(
      { error: (e as Error).message },
      { status: 500 }
    );
  }
}
