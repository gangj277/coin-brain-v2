import {
  discoverFromLeaderboard,
  type TraderCandidate,
} from "@/lib/hyperliquid/discovery";
import { rankTraders, scoreFromLeaderboard } from "@/lib/hyperliquid/scoring";
import { DEFAULT_COLLECTION_CONFIG, type CollectionConfig } from "./config";
import type { TraderUniverseSnapshot } from "./types";
import type { TraderUniverseRepository } from "./trader-universe-repository";

export interface TraderUniverseServiceDeps {
  repository: TraderUniverseRepository;
  discoverCandidates?: (
    filter: CollectionConfig["leaderboardFilter"]
  ) => Promise<TraderCandidate[]>;
  now?: () => number;
  config?: Partial<CollectionConfig>;
}

export class TraderUniverseService {
  private readonly repository: TraderUniverseRepository;
  private readonly discoverCandidates: NonNullable<
    TraderUniverseServiceDeps["discoverCandidates"]
  >;
  private readonly now: NonNullable<TraderUniverseServiceDeps["now"]>;
  private readonly config: CollectionConfig;

  constructor(deps: TraderUniverseServiceDeps) {
    this.repository = deps.repository;
    this.discoverCandidates = deps.discoverCandidates ?? discoverFromLeaderboard;
    this.now = deps.now ?? Date.now;
    this.config = { ...DEFAULT_COLLECTION_CONFIG, ...deps.config };
  }

  async refreshActiveUniverse(): Promise<TraderUniverseSnapshot> {
    const refreshedAt = this.now();
    const candidates = await this.discoverCandidates(this.config.leaderboardFilter);
    const scored = candidates
      .map((candidate) => ({
        candidate,
        score: scoreFromLeaderboard(candidate),
      }))
      .filter((entry) => entry.score.totalScore > 0);
    const ranked = rankTraders(
      scored.map((entry) => entry.score),
      this.config.ranking
    );

    const candidateByAddress = new Map(
      candidates.map((candidate) => [candidate.address.toLowerCase(), candidate])
    );

    const snapshot: TraderUniverseSnapshot = {
      refreshedAt,
      source: "leaderboard",
      traders: ranked.map((rankedTrader) => ({
        address: rankedTrader.address.toLowerCase(),
        tier: rankedTrader.tier,
        score: rankedTrader.totalScore,
        refreshedAt,
        source:
          candidateByAddress.get(rankedTrader.address.toLowerCase())?.source ??
          "leaderboard",
        flags: rankedTrader.flags,
      })),
      filters: {
        ...this.config.leaderboardFilter,
        ...this.config.ranking,
      },
      totalCandidates: candidates.length,
      totalRanked: ranked.length,
    };

    await this.repository.saveActive(snapshot);
    return snapshot;
  }

  async ensureActiveUniverse(): Promise<{
    snapshot: TraderUniverseSnapshot;
    refreshedInline: boolean;
  }> {
    const current = await this.repository.loadActive();
    if (!current) {
      return {
        snapshot: await this.refreshActiveUniverse(),
        refreshedInline: true,
      };
    }

    const isStale =
      this.now() - current.refreshedAt >= this.config.universeStaleMs;
    if (!isStale) {
      return {
        snapshot: current,
        refreshedInline: false,
      };
    }

    return {
      snapshot: await this.refreshActiveUniverse(),
      refreshedInline: true,
    };
  }
}
