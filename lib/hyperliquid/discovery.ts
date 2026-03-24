/**
 * Multi-source trader discovery engine for Hyperliquid.
 *
 * Sources:
 *   1. Leaderboard   — 32k+ traders ranked by PnL (stats-data endpoint)
 *   2. HLP Vault     — Top depositors who also trade independently
 *   3. Curated Seeds — Manually added whale / alpha addresses
 *
 * Each source produces TraderCandidate entries. The engine deduplicates,
 * enriches with on-chain data, scores, and ranks them.
 */

import { getClearinghouseState, getVaultDetails } from "./client";

// ─── Types ───────────────────────────────────────────────

export interface LeaderboardEntry {
  ethAddress: string;
  accountValue: string;
  displayName: string | null;
  windowPerformances: [
    string,
    { pnl: string; roi: string; vlm: string },
  ][];
  prize: number;
}

export interface LeaderboardResponse {
  leaderboardRows: LeaderboardEntry[];
}

export type DiscoverySource =
  | "leaderboard"
  | "hlp_vault"
  | "curated";

export interface TraderCandidate {
  address: string;
  source: DiscoverySource;
  accountValue: number;
  // From leaderboard (if available)
  leaderboard?: {
    displayName: string | null;
    dayPnl: number;
    dayRoi: number;
    weekPnl: number;
    weekRoi: number;
    monthPnl: number;
    monthRoi: number;
    monthVolume: number;
    allTimePnl: number;
    allTimeRoi: number;
    allTimeVolume: number;
  };
  // Live on-chain state
  hasOpenPositions: boolean;
  positionCount: number;
}

// ─── Source 1: Leaderboard ───────────────────────────────

const LEADERBOARD_URL =
  "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard";

export async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  const res = await fetch(LEADERBOARD_URL);
  if (!res.ok) throw new Error(`Leaderboard fetch failed: ${res.status}`);
  const data = (await res.json()) as LeaderboardResponse;
  return data.leaderboardRows;
}

function parseLeaderboardEntry(entry: LeaderboardEntry): TraderCandidate {
  const perfs: Record<string, { pnl: string; roi: string; vlm: string }> = {};
  for (const [window, data] of entry.windowPerformances) {
    perfs[window] = data;
  }

  return {
    address: entry.ethAddress,
    source: "leaderboard",
    accountValue: parseFloat(entry.accountValue),
    leaderboard: {
      displayName: entry.displayName,
      dayPnl: parseFloat(perfs.day?.pnl ?? "0"),
      dayRoi: parseFloat(perfs.day?.roi ?? "0"),
      weekPnl: parseFloat(perfs.week?.pnl ?? "0"),
      weekRoi: parseFloat(perfs.week?.roi ?? "0"),
      monthPnl: parseFloat(perfs.month?.pnl ?? "0"),
      monthRoi: parseFloat(perfs.month?.roi ?? "0"),
      monthVolume: parseFloat(perfs.month?.vlm ?? "0"),
      allTimePnl: parseFloat(perfs.allTime?.pnl ?? "0"),
      allTimeRoi: parseFloat(perfs.allTime?.roi ?? "0"),
      allTimeVolume: parseFloat(perfs.allTime?.vlm ?? "0"),
    },
    hasOpenPositions: false, // enriched later
    positionCount: 0,
  };
}

export interface LeaderboardFilter {
  minAccountValue?: number;   // default $10k
  minAllTimePnl?: number;     // default $10k
  minMonthPnl?: number;       // default $1k
  minAllTimeRoi?: number;     // default 10%
  maxEntries?: number;        // default 200
}

const DEFAULT_FILTER: Required<LeaderboardFilter> = {
  minAccountValue: 10_000,
  minAllTimePnl: 10_000,
  minMonthPnl: 1_000,
  minAllTimeRoi: 0.1,
  maxEntries: 200,
};

export async function discoverFromLeaderboard(
  filter?: LeaderboardFilter
): Promise<TraderCandidate[]> {
  const f = { ...DEFAULT_FILTER, ...filter };
  const entries = await fetchLeaderboard();

  const candidates = entries
    .map(parseLeaderboardEntry)
    .filter((c) => {
      const lb = c.leaderboard!;
      return (
        c.accountValue >= f.minAccountValue &&
        lb.allTimePnl >= f.minAllTimePnl &&
        lb.monthPnl >= f.minMonthPnl &&
        lb.allTimeRoi >= f.minAllTimeRoi
      );
    })
    .slice(0, f.maxEntries);

  return candidates;
}

// ─── Source 2: HLP Vault Followers ───────────────────────

const HLP_VAULT = "0xdfc24b077bc1425ad1dea75bcb6f8158e10df303";

export async function discoverFromHlpVault(
  topN = 100
): Promise<TraderCandidate[]> {
  const vault = await getVaultDetails(HLP_VAULT);

  const topFollowers = vault.followers
    .sort((a, b) => parseFloat(b.vaultEquity) - parseFloat(a.vaultEquity))
    .slice(0, topN);

  return topFollowers.map((f) => ({
    address: f.user,
    source: "hlp_vault" as const,
    accountValue: parseFloat(f.vaultEquity),
    hasOpenPositions: false,
    positionCount: 0,
  }));
}

// ─── Source 3: Curated Seed Addresses ────────────────────

// Well-known active traders / whales discovered through on-chain analysis.
// These addresses have been verified to have significant trading history.
const CURATED_ADDRESSES: string[] = [
  // Add manually discovered whale addresses here
];

export function addCuratedAddress(address: string) {
  if (!CURATED_ADDRESSES.includes(address.toLowerCase())) {
    CURATED_ADDRESSES.push(address.toLowerCase());
  }
}

export function discoverFromCurated(): TraderCandidate[] {
  return CURATED_ADDRESSES.map((addr) => ({
    address: addr,
    source: "curated" as const,
    accountValue: 0, // enriched later
    hasOpenPositions: false,
    positionCount: 0,
  }));
}

// ─── Enrichment: Check live on-chain positions ───────────

export async function enrichWithLiveData(
  candidates: TraderCandidate[],
  concurrency = 15
): Promise<TraderCandidate[]> {
  const enriched: TraderCandidate[] = [];

  for (let i = 0; i < candidates.length; i += concurrency) {
    const batch = candidates.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (c) => {
        try {
          const state = await getClearinghouseState(c.address);
          return {
            ...c,
            accountValue:
              c.accountValue ||
              parseFloat(state.marginSummary.accountValue),
            hasOpenPositions: state.assetPositions.length > 0,
            positionCount: state.assetPositions.length,
          };
        } catch {
          return c;
        }
      })
    );
    enriched.push(...results);
  }

  return enriched;
}

// ─── Combined Multi-Source Discovery ─────────────────────

export interface DiscoveryOptions {
  leaderboardFilter?: LeaderboardFilter;
  hlpTopN?: number;
  enrichLive?: boolean;       // default true — check live positions
  onlyWithPositions?: boolean; // default false — filter to those with open positions
}

export async function discoverTraders(
  options: DiscoveryOptions = {}
): Promise<TraderCandidate[]> {
  const {
    leaderboardFilter,
    hlpTopN = 100,
    enrichLive = true,
    onlyWithPositions = false,
  } = options;

  // Fetch from all sources in parallel
  const [leaderboardCandidates, hlpCandidates] = await Promise.all([
    discoverFromLeaderboard(leaderboardFilter),
    discoverFromHlpVault(hlpTopN),
  ]);
  const curatedCandidates = discoverFromCurated();

  // Merge and deduplicate (leaderboard takes priority for data richness)
  const seen = new Map<string, TraderCandidate>();

  // Leaderboard first (richest data)
  for (const c of leaderboardCandidates) {
    seen.set(c.address.toLowerCase(), c);
  }
  // HLP followers (add source tag if already exists)
  for (const c of hlpCandidates) {
    const key = c.address.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, c);
    }
  }
  // Curated
  for (const c of curatedCandidates) {
    const key = c.address.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, c);
    }
  }

  let merged = Array.from(seen.values());

  // Enrich with live on-chain data
  if (enrichLive) {
    merged = await enrichWithLiveData(merged);
  }

  // Filter to those with open positions if requested
  if (onlyWithPositions) {
    merged = merged.filter((c) => c.hasOpenPositions);
  }

  return merged;
}
