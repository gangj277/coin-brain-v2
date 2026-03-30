import { NextRequest } from "next/server";
import { redis, KEYS } from "@/lib/redis/client";
import { discoverFromLeaderboard } from "@/lib/hyperliquid/discovery";
import { scoreFromLeaderboard, rankTraders } from "@/lib/hyperliquid/scoring";
import {
  getClearinghouseState,
  getMetaAndAssetCtxs,
  getUserFillsByTime,
} from "@/lib/hyperliquid/client";
import { aggregateSignals } from "@/lib/signals/aggregator";
import { PositionStore } from "@/lib/hyperliquid/tracker/store";
import { loadPositionTimingState, savePositionTimingState } from "@/lib/hyperliquid/timing/repository";
import {
  applyBackfillResult,
  removeBackfillTask,
  syncPositionTimingForTrader,
} from "@/lib/hyperliquid/timing/state";
import { resolveCurrentPositionTiming } from "@/lib/hyperliquid/timing/reconcile";

export const maxDuration = 60; // Allow up to 60s for this cron

const BACKFILL_BUDGET = 20;
const WINDOW_MS: Record<"1d" | "7d" | "30d", number> = {
  "1d": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = Date.now();

  try {
    const timingState = await loadPositionTimingState();

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
    const rankByAddress = new Map(
      ranked.map((score) => [score.address.toLowerCase(), score])
    );
    const currentStates = new Map<string, Awaited<ReturnType<typeof getClearinghouseState>>>();

    // Batch fetch in groups of 15
    for (let i = 0; i < addresses.length; i += 15) {
      const batch = addresses.slice(i, i + 15);
      await Promise.allSettled(
        batch.map(async (addr) => {
          const scoreMeta = rankByAddress.get(addr);
          if (!scoreMeta) return;
          const tier = scoreMeta.tier;
          const score = scoreMeta.totalScore;
          store.addTrader(addr, tier, score, "polling");
          const state = await getClearinghouseState(addr);
          store.updateState(addr, state);
          currentStates.set(addr, state);
          syncPositionTimingForTrader({
            address: addr,
            tier,
            prevState: timingState.snapshots[addr] ?? null,
            currentState: state,
            timingState,
          });
        })
      );
    }

    for (const [queuedAddress] of Object.entries(timingState.snapshots)) {
      if (!currentStates.has(queuedAddress) && !rankByAddress.has(queuedAddress)) {
        delete timingState.snapshots[queuedAddress];
      }
    }

    // Sort queue: S-tier first, then A, then rest
    const tierPriority: Record<string, number> = { S: 0, A: 1, B: 2, C: 3, D: 4 };
    timingState.queue.sort((a, b) => (tierPriority[a.traderTier] ?? 9) - (tierPriority[b.traderTier] ?? 9));

    for (const task of [...timingState.queue].slice(0, BACKFILL_BUDGET)) {
      const state = currentStates.get(task.address);
      const record = timingState.records[task.positionKey];
      if (!state || !record) {
        removeBackfillTask(timingState, task);
        continue;
      }

      const currentPosition = state.assetPositions.find(
        (assetPosition) =>
          assetPosition.position.coin.toUpperCase() === task.coin &&
          parseFloat(assetPosition.position.szi) !== 0
      );

      if (!currentPosition) {
        removeBackfillTask(timingState, task);
        continue;
      }

      try {
        const endTime = task.endTime ?? state.time;
        const startTime =
          task.strategy === "incremental"
            ? task.startTime ?? Math.max(endTime - WINDOW_MS["1d"], 0)
            : Math.max(endTime - WINDOW_MS[task.strategy], 0);
        const fills = await getUserFillsByTime(task.address, startTime, endTime, {
          aggregateByTime: true,
        });
        const result = resolveCurrentPositionTiming({
          currentSzi: parseFloat(currentPosition.position.szi),
          fills: fills.filter((fill) => fill.coin.toUpperCase() === task.coin),
        });
        applyBackfillResult({
          timingState,
          task,
          result,
          now: state.time,
        });
      } catch {
        // Keep the task queued for a future cron cycle.
      }
    }

    // 3. Aggregate signals
    const signals = aggregateSignals(store, timingState.records);

    // 4. Fetch market data
    const marketData: Record<string, unknown> = {};
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
      savePositionTimingState(timingState),
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
