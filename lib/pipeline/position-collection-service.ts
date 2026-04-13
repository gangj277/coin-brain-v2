import {
  getClearinghouseState,
  getMetaAndAssetCtxs,
  getUserFillsByTime,
  type AssetContext,
} from "@/lib/hyperliquid/client";
import type { PositionChange } from "@/lib/hyperliquid/tracker/types";
import {
  applyBackfillResult,
  removeBackfillTask,
  syncPositionTimingForTrader,
} from "@/lib/hyperliquid/timing/state";
import { resolveCurrentPositionTiming } from "@/lib/hyperliquid/timing/reconcile";
import {
  loadPositionTimingState,
  savePositionTimingState,
} from "@/lib/hyperliquid/timing/repository";
import type { PositionTimingState } from "@/lib/hyperliquid/timing/types";
import { PositionStore } from "@/lib/hyperliquid/tracker/store";
import {
  aggregateSignals,
  appendSmiHistory,
  type SignalSmiState,
} from "@/lib/signals/aggregator";
import type { SMIHistoryEntry } from "@/lib/signals/smi";
import { DEFAULT_COLLECTION_CONFIG, type CollectionConfig } from "./config";
import { appendMarketContextHistory } from "./signal-engine-state-repository";
import type {
  BaseSignalSnapshot,
  SignalMarketData,
  PipelineStageMetrics,
  TraderUniverseSnapshot,
} from "./types";
import type { MarketContextHistoryEntry } from "./signal-engine-state-repository";

function toMarketData(ctx: AssetContext): SignalMarketData {
  const markPx = parseFloat(ctx.markPx);
  const prevDayPx = parseFloat(ctx.prevDayPx);
  const funding = parseFloat(ctx.funding);
  const openInterest = parseFloat(ctx.openInterest);

  return {
    markPx,
    prevDayPx,
    dayChange: prevDayPx > 0 ? ((markPx - prevDayPx) / prevDayPx) * 100 : 0,
    funding,
    fundingAnnual: funding * 24 * 365 * 100,
    openInterest,
    openInterestUsd: openInterest * markPx,
    dayVolume: parseFloat(ctx.dayNtlVlm),
  };
}

export interface PositionCollectionServiceDeps {
  loadTimingState?: () => Promise<PositionTimingState>;
  saveTimingState?: (state: PositionTimingState) => Promise<void>;
  fetchClearinghouseState?: typeof getClearinghouseState;
  fetchMetaAndAssetCtxs?: typeof getMetaAndAssetCtxs;
  fetchUserFillsByTime?: typeof getUserFillsByTime;
  loadRecentPositionEvents?: () => Promise<PositionChange[]>;
  saveRecentPositionEvents?: (events: PositionChange[]) => Promise<void>;
  loadSmiHistory?: (
    coins: string[]
  ) => Promise<Record<string, SMIHistoryEntry[]>>;
  saveSmiHistory?: (
    historyByCoin: Record<string, SMIHistoryEntry[]>
  ) => Promise<void>;
  saveLatestSmi?: (
    latestByCoin: Record<string, SignalSmiState>
  ) => Promise<void>;
  loadMarketContextHistory?: (
    coins: string[]
  ) => Promise<Record<string, MarketContextHistoryEntry[]>>;
  saveMarketContextHistory?: (
    historyByCoin: Record<string, MarketContextHistoryEntry[]>
  ) => Promise<void>;
  now?: () => number;
  config?: Partial<CollectionConfig>;
}

export class PositionCollectionService {
  private readonly loadTimingState: NonNullable<
    PositionCollectionServiceDeps["loadTimingState"]
  >;
  private readonly saveTimingState: NonNullable<
    PositionCollectionServiceDeps["saveTimingState"]
  >;
  private readonly fetchClearinghouseState: NonNullable<
    PositionCollectionServiceDeps["fetchClearinghouseState"]
  >;
  private readonly fetchMetaAndAssetCtxs: NonNullable<
    PositionCollectionServiceDeps["fetchMetaAndAssetCtxs"]
  >;
  private readonly fetchUserFillsByTime: NonNullable<
    PositionCollectionServiceDeps["fetchUserFillsByTime"]
  >;
  private readonly loadRecentPositionEvents: NonNullable<
    PositionCollectionServiceDeps["loadRecentPositionEvents"]
  >;
  private readonly saveRecentPositionEvents: NonNullable<
    PositionCollectionServiceDeps["saveRecentPositionEvents"]
  >;
  private readonly loadSmiHistory: NonNullable<
    PositionCollectionServiceDeps["loadSmiHistory"]
  >;
  private readonly saveSmiHistory: NonNullable<
    PositionCollectionServiceDeps["saveSmiHistory"]
  >;
  private readonly saveLatestSmi: NonNullable<
    PositionCollectionServiceDeps["saveLatestSmi"]
  >;
  private readonly loadMarketContextHistory: NonNullable<
    PositionCollectionServiceDeps["loadMarketContextHistory"]
  >;
  private readonly saveMarketContextHistory: NonNullable<
    PositionCollectionServiceDeps["saveMarketContextHistory"]
  >;
  private readonly now: NonNullable<PositionCollectionServiceDeps["now"]>;
  private readonly config: CollectionConfig;

  constructor(deps: PositionCollectionServiceDeps = {}) {
    this.loadTimingState = deps.loadTimingState ?? loadPositionTimingState;
    this.saveTimingState = deps.saveTimingState ?? savePositionTimingState;
    this.fetchClearinghouseState =
      deps.fetchClearinghouseState ?? getClearinghouseState;
    this.fetchMetaAndAssetCtxs =
      deps.fetchMetaAndAssetCtxs ?? getMetaAndAssetCtxs;
    this.fetchUserFillsByTime =
      deps.fetchUserFillsByTime ?? getUserFillsByTime;
    this.loadRecentPositionEvents =
      deps.loadRecentPositionEvents ?? (async () => []);
    this.saveRecentPositionEvents =
      deps.saveRecentPositionEvents ?? (async () => {});
    this.loadSmiHistory = deps.loadSmiHistory ?? (async () => ({}));
    this.saveSmiHistory = deps.saveSmiHistory ?? (async () => {});
    this.saveLatestSmi = deps.saveLatestSmi ?? (async () => {});
    this.loadMarketContextHistory =
      deps.loadMarketContextHistory ?? (async () => ({}));
    this.saveMarketContextHistory =
      deps.saveMarketContextHistory ?? (async () => {});
    this.now = deps.now ?? Date.now;
    this.config = { ...DEFAULT_COLLECTION_CONFIG, ...deps.config };
  }

  async collect(
    universe: TraderUniverseSnapshot,
    options?: {
      fallbackUniverseRefresh?: boolean;
    }
  ): Promise<BaseSignalSnapshot> {
    const startedAt = this.now();
    const deadline = startedAt + this.config.maxDurationMs - this.config.backfillGuardMs;
    const [timingState, previousRecentEvents] = await Promise.all([
      this.loadTimingState(),
      this.loadRecentPositionEvents(),
    ]);
    const store = new PositionStore();
    const currentStates = new Map<string, Awaited<ReturnType<typeof getClearinghouseState>>>();
    const currentCycleEvents: PositionChange[] = [];
    const rankByAddress = new Map(
      universe.traders.map((trader) => [trader.address.toLowerCase(), trader])
    );

    for (let index = 0; index < universe.traders.length; index += this.config.pollBatchSize) {
      const batch = universe.traders.slice(index, index + this.config.pollBatchSize);
      await Promise.allSettled(
        batch.map(async (trader) => {
          const address = trader.address.toLowerCase();
          store.addTrader(address, trader.tier, trader.score, "polling");
          const state = await this.fetchClearinghouseState(address);
          const changes = store.updateState(address, state);
          currentCycleEvents.push(...changes);
          currentStates.set(address, state);
          syncPositionTimingForTrader({
            address,
            tier: trader.tier,
            prevState: timingState.snapshots[address] ?? null,
            currentState: state,
            timingState,
          });
        })
      );
    }

    for (const [address] of Object.entries(timingState.snapshots)) {
      if (!currentStates.has(address) && !rankByAddress.has(address)) {
        delete timingState.snapshots[address];
      }
    }

    const tierPriority: Record<string, number> = { S: 0, A: 1, B: 2, C: 3, D: 4 };
    timingState.queue.sort(
      (left, right) =>
        (tierPriority[left.traderTier] ?? 9) - (tierPriority[right.traderTier] ?? 9)
    );

    let backfillTasksProcessed = 0;
    for (const task of [...timingState.queue].slice(0, this.config.backfillBudget)) {
      if (this.now() >= deadline) {
        break;
      }

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
            ? task.startTime ?? Math.max(endTime - 24 * 60 * 60 * 1000, 0)
            : Math.max(
                endTime -
                  {
                    "1d": 24 * 60 * 60 * 1000,
                    "7d": 7 * 24 * 60 * 60 * 1000,
                    "30d": 30 * 24 * 60 * 60 * 1000,
                  }[task.strategy],
                0
              );

        const fills = await this.fetchUserFillsByTime(task.address, startTime, endTime, {
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
        backfillTasksProcessed += 1;
      } catch {
        // Leave the task queued for the next cycle.
      }
    }

    const market: Record<string, SignalMarketData> = {};
    let marketFetches = 0;
    try {
      const { contexts } = await this.fetchMetaAndAssetCtxs();
      marketFetches = 1;
      for (const [coin, context] of contexts) {
        market[coin] = toMarketData(context);
      }
    } catch {
      // Continue with signal data even when market enrichment is unavailable.
    }

    const trackedCoins = [...new Set(
      store.getAllPositions().flatMap((trader) => trader.positions.map((position) => position.coin))
    )];
    const [smiHistoryByCoin, marketHistoryByCoin] = await Promise.all([
      this.loadSmiHistory(trackedCoins),
      this.loadMarketContextHistory(Object.keys(market)),
    ]);

    const recentEvents = [...previousRecentEvents, ...currentCycleEvents].filter(
      (event) => startedAt - event.timestamp <= 6 * 60 * 60 * 1000
    );

    const signals = aggregateSignals(store, timingState.records, {
      marketByCoin: market,
      recentEvents,
      smiHistoryByCoin,
      now: startedAt,
    }).map((signal) => ({
      ...signal,
      market: market[signal.coin] ?? null,
    }));

    const nextSmiHistoryByCoin: Record<string, SMIHistoryEntry[]> = {
      ...smiHistoryByCoin,
    };
    const latestSmiByCoin: Record<string, SignalSmiState> = {};
    for (const signal of signals) {
      if (!signal.smi) continue;
      latestSmiByCoin[signal.coin] = signal.smi;
      nextSmiHistoryByCoin[signal.coin] = appendSmiHistory(
        smiHistoryByCoin[signal.coin] ?? [],
        signal.smi
      );
    }

    const nextMarketHistoryByCoin: Record<string, MarketContextHistoryEntry[]> = {
      ...marketHistoryByCoin,
    };
    for (const [coin, marketData] of Object.entries(market)) {
      nextMarketHistoryByCoin[coin] = appendMarketContextHistory(
        marketHistoryByCoin[coin] ?? [],
        marketData,
        startedAt
      );
    }

    await Promise.all([
      this.saveTimingState(timingState),
      this.saveRecentPositionEvents(recentEvents),
      this.saveSmiHistory(nextSmiHistoryByCoin),
      this.saveLatestSmi(latestSmiByCoin),
      this.saveMarketContextHistory(nextMarketHistoryByCoin),
    ]);

    const completedAt = this.now();
    const metrics: PipelineStageMetrics = {
      startedAt,
      completedAt,
      durationMs: completedAt - startedAt,
      marketFetches,
      traderFetches: universe.traders.length,
      backfillTasksProcessed,
    };

    return {
      signals,
      stats: store.getStats(),
      market,
      timestamp: completedAt,
      collection: {
        traders: universe.traders.length,
        positions: store.getStats().totalPositions,
        durationMs: metrics.durationMs,
        universeRefreshedAt: universe.refreshedAt,
        timingQueueRemaining: timingState.queue.length,
        fallbackUniverseRefresh: options?.fallbackUniverseRefresh ?? false,
        recentEventsTracked: recentEvents.length,
      },
    };
  }
}
