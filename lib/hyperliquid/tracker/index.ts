import {
  discoverFromLeaderboard,
  type TraderCandidate,
} from "../discovery";
import { scoreFromLeaderboard, rankTraders } from "../scoring";
import type { TrackerConfig, TrackerStats, TraderTier } from "./types";
import { DEFAULT_CONFIG } from "./types";
import { PositionStore } from "./store";
import { TrackerEventBus } from "./events";
import { WebSocketPool } from "./ws-pool";
import { RestPoller } from "./poller";

export { PositionStore } from "./store";
export { TrackerEventBus } from "./events";
export type { PositionChange, TrackerStats, TrackerConfig } from "./types";

const TIER_RANK: Record<TraderTier, number> = { S: 5, A: 4, B: 3, C: 2, D: 1 };

// Use globalThis to share singleton across API routes
const GLOBAL_KEY = "__positionTracker__";
declare global {
  // eslint-disable-next-line no-var
  var __positionTracker__: PositionTracker | undefined;
}

export class PositionTracker {

  private store: PositionStore;
  private events: TrackerEventBus;
  private wsPool: WebSocketPool;
  private poller: RestPoller;
  private config: TrackerConfig;
  private startedAt = 0;
  private totalChanges = 0;
  private lastPollCycleMs = 0;
  private initialized = false;

  private constructor(config?: Partial<TrackerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.store = new PositionStore();
    this.events = new TrackerEventBus();
    this.wsPool = new WebSocketPool(this.store, this.events, this.config);
    this.poller = new RestPoller(this.store, this.events, this.config);

    // Track stats
    this.events.on("position:change", () => {
      this.totalChanges++;
    });
    this.events.on("poll:cycle", (ms) => {
      this.lastPollCycleMs = ms;
    });
  }

  static getInstance(config?: Partial<TrackerConfig>): PositionTracker {
    if (!globalThis.__positionTracker__) {
      globalThis.__positionTracker__ = new PositionTracker(config);
    }
    return globalThis.__positionTracker__;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getStore(): PositionStore {
    return this.store;
  }

  getEventBus(): TrackerEventBus {
    return this.events;
  }

  getStats(): TrackerStats {
    const storeStats = this.store.getStats();
    return {
      ...storeStats,
      wsConnections: this.wsPool.getTotalCount(),
      wsConnected: this.wsPool.getConnectedCount(),
      lastPollCycleMs: this.lastPollCycleMs,
      totalChangesEmitted: this.totalChanges,
      uptime: this.startedAt > 0 ? Date.now() - this.startedAt : 0,
    };
  }

  // ─── Initialization ────────────────────────────────

  async initialize() {
    if (this.initialized) return;

    console.log("[Tracker] Initializing...");
    const start = Date.now();

    // 1. Discover traders from leaderboard
    console.log("[Tracker] Discovering traders...");
    const candidates = await discoverFromLeaderboard({
      minAccountValue: 50_000,
      minAllTimePnl: 50_000,
      minMonthPnl: 1_000,
      minAllTimeRoi: 0.2,
      maxEntries: 300,
    });

    // 2. Score and rank
    const scores = candidates
      .map((c) => ({ candidate: c, score: scoreFromLeaderboard(c) }))
      .filter((s) => s.score.totalScore > 0);

    const ranked = rankTraders(
      scores.map((s) => s.score),
      { minTier: "C", maxResults: 300 }
    );

    // 3. Build candidate lookup
    const candidateMap = new Map<string, TraderCandidate>();
    for (const c of candidates) candidateMap.set(c.address.toLowerCase(), c);

    // 4. Split by tier → WS vs polling
    const thresholdRank = TIER_RANK[this.config.wsTierThreshold];
    const wsAddresses: string[] = [];
    const pollAddresses: string[] = [];

    for (const score of ranked) {
      const addr = score.address.toLowerCase();
      const tierRank = TIER_RANK[score.tier];
      const method = tierRank > thresholdRank ? "websocket" : "polling";

      this.store.addTrader(addr, score.tier, score.totalScore, method);

      if (method === "websocket") {
        wsAddresses.push(addr);
      } else {
        pollAddresses.push(addr);
      }
    }

    console.log(
      `[Tracker] ${ranked.length} traders: ${wsAddresses.length} WS, ${pollAddresses.length} polling`
    );

    // 5. Start WebSocket pool for S/A tier
    if (wsAddresses.length > 0) {
      this.wsPool.start(wsAddresses);
    }

    // 6. Start REST poller for B+ tier
    if (pollAddresses.length > 0) {
      this.poller.start(pollAddresses);
    }

    this.startedAt = Date.now();
    this.initialized = true;
    this.events.emit("tracker:started");

    console.log(
      `[Tracker] Initialized in ${((Date.now() - start) / 1000).toFixed(1)}s`
    );
  }

  stop() {
    this.wsPool.stop();
    this.poller.stop();
    this.events.emit("tracker:stopped");
    this.initialized = false;
    console.log("[Tracker] Stopped");
  }
}
