/**
 * Integration test: Multi-source trader discovery + scoring pipeline
 * Run: npx tsx scripts/test-discovery-engine.ts
 */

// Inline implementation to avoid ts module resolution issues with scripts
const INFO_URL = "https://api.hyperliquid.xyz/info";
const LEADERBOARD_URL = "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard";
const HLP_VAULT = "0xdfc24b077bc1425ad1dea75bcb6f8158e10df303";

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch(INFO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

// ─── Types ───────────────────────────────────────────────

interface LeaderboardEntry {
  ethAddress: string;
  accountValue: string;
  displayName: string | null;
  windowPerformances: [string, { pnl: string; roi: string; vlm: string }][];
}

interface TraderCandidate {
  address: string;
  source: "leaderboard" | "hlp_vault";
  accountValue: number;
  leaderboard?: {
    displayName: string | null;
    dayPnl: number; weekPnl: number; monthPnl: number; allTimePnl: number;
    dayRoi: number; weekRoi: number; monthRoi: number; allTimeRoi: number;
    monthVolume: number; allTimeVolume: number;
  };
  hasOpenPositions: boolean;
  positionCount: number;
}

interface TraderScore {
  address: string;
  totalScore: number;
  dimensions: { profitability: number; consistency: number; riskManagement: number; activity: number; scale: number };
  tier: "S" | "A" | "B" | "C" | "D";
  flags: string[];
  candidate: TraderCandidate;
}

// ─── Source 1: Leaderboard ───────────────────────────────

async function fetchFromLeaderboard(): Promise<TraderCandidate[]> {
  console.log("  Fetching leaderboard...");
  const res = await fetch(LEADERBOARD_URL);
  const data = await res.json() as { leaderboardRows: LeaderboardEntry[] };
  console.log(`  Raw entries: ${data.leaderboardRows.length}`);

  return data.leaderboardRows.map((entry) => {
    const perfs: Record<string, { pnl: string; roi: string; vlm: string }> = {};
    for (const [w, d] of entry.windowPerformances) perfs[w] = d;

    return {
      address: entry.ethAddress,
      source: "leaderboard" as const,
      accountValue: parseFloat(entry.accountValue),
      leaderboard: {
        displayName: entry.displayName,
        dayPnl: parseFloat(perfs.day?.pnl ?? "0"),
        weekPnl: parseFloat(perfs.week?.pnl ?? "0"),
        monthPnl: parseFloat(perfs.month?.pnl ?? "0"),
        allTimePnl: parseFloat(perfs.allTime?.pnl ?? "0"),
        dayRoi: parseFloat(perfs.day?.roi ?? "0"),
        weekRoi: parseFloat(perfs.week?.roi ?? "0"),
        monthRoi: parseFloat(perfs.month?.roi ?? "0"),
        allTimeRoi: parseFloat(perfs.allTime?.roi ?? "0"),
        monthVolume: parseFloat(perfs.month?.vlm ?? "0"),
        allTimeVolume: parseFloat(perfs.allTime?.vlm ?? "0"),
      },
      hasOpenPositions: false,
      positionCount: 0,
    };
  });
}

// ─── Source 2: HLP Vault ─────────────────────────────────

async function fetchFromHlpVault(): Promise<TraderCandidate[]> {
  console.log("  Fetching HLP vault followers...");
  const vault = await post<{
    followers: { user: string; vaultEquity: string; allTimePnl: string }[];
  }>({ type: "vaultDetails", vaultAddress: HLP_VAULT });

  console.log(`  HLP followers: ${vault.followers.length}`);

  return vault.followers
    .sort((a, b) => parseFloat(b.vaultEquity) - parseFloat(a.vaultEquity))
    .slice(0, 100)
    .map((f) => ({
      address: f.user,
      source: "hlp_vault" as const,
      accountValue: parseFloat(f.vaultEquity),
      hasOpenPositions: false,
      positionCount: 0,
    }));
}

// ─── Filter ──────────────────────────────────────────────

function filterLeaderboard(candidates: TraderCandidate[]): TraderCandidate[] {
  return candidates.filter((c) => {
    const lb = c.leaderboard;
    if (!lb) return false;
    return (
      c.accountValue >= 50_000 &&       // Min $50k account
      lb.allTimePnl >= 50_000 &&        // Min $50k all-time PnL
      lb.monthPnl > 0 &&               // Profitable this month
      lb.allTimeRoi >= 0.2 &&          // Min 20% all-time ROI
      lb.monthVolume >= 500_000        // Active trader (min $500k monthly volume)
    );
  });
}

// ─── Scoring ─────────────────────────────────────────────

function scoreTrader(c: TraderCandidate): TraderScore {
  const lb = c.leaderboard;
  const flags: string[] = [];

  if (!lb) {
    return {
      address: c.address, totalScore: 0, tier: "D", flags: ["no_data"],
      dimensions: { profitability: 0, consistency: 0, riskManagement: 50, activity: 0, scale: 0 },
      candidate: c,
    };
  }

  // Profitability (30%): All-time ROI
  const roiPct = lb.allTimeRoi * 100;
  const profitability = Math.min(100, Math.max(0,
    roiPct <= 0 ? 0 : roiPct <= 100 ? roiPct * 0.7 : 70 + Math.min(30, (roiPct - 100) / 30)
  ));

  // Consistency (25%): Multiple timeframes positive
  let consistencyPts = 0;
  if (lb.dayPnl > 0) consistencyPts += 15;
  if (lb.weekPnl > 0) consistencyPts += 25;
  if (lb.monthPnl > 0) consistencyPts += 35;
  if (lb.allTimePnl > 0) consistencyPts += 25;
  if (lb.monthRoi > 0.05 && lb.allTimePnl > 0) consistencyPts += 10;
  const consistency = Math.min(100, consistencyPts);

  if (lb.weekPnl < 0) flags.push("recent_week_loss");

  // Risk Management (15%): ROI stability
  const monthVsAllRatio = lb.allTimeRoi !== 0 ? Math.abs(lb.monthRoi / lb.allTimeRoi) : 0;
  const riskManagement = monthVsAllRatio <= 0.5 ? 80 : monthVsAllRatio <= 1.0 ? 60 : monthVsAllRatio <= 2.0 ? 40 : 20;

  // Activity (15%): Monthly volume
  const volLog = lb.monthVolume > 0 ? Math.log10(lb.monthVolume) : 0;
  const activity = Math.min(100, Math.max(0, (volLog - 4) * 16.67));
  if (lb.monthVolume < 100_000) flags.push("low_activity");

  // Scale (15%): Account size
  const acctLog = c.accountValue > 0 ? Math.log10(c.accountValue) : 0;
  const scale = Math.min(100, Math.max(0, (acctLog - 3) * 20));

  const totalScore = profitability * 0.30 + consistency * 0.25 + riskManagement * 0.15 + activity * 0.15 + scale * 0.15;
  const tier = totalScore >= 80 ? "S" : totalScore >= 65 ? "A" : totalScore >= 50 ? "B" : totalScore >= 35 ? "C" : "D";

  return {
    address: c.address,
    totalScore: Math.round(totalScore * 10) / 10,
    dimensions: {
      profitability: Math.round(profitability * 10) / 10,
      consistency: Math.round(consistency * 10) / 10,
      riskManagement: Math.round(riskManagement * 10) / 10,
      activity: Math.round(activity * 10) / 10,
      scale: Math.round(scale * 10) / 10,
    },
    tier, flags, candidate: c,
  };
}

// ─── Enrich with live positions ──────────────────────────

async function enrichTopTraders(scores: TraderScore[], topN = 20): Promise<TraderScore[]> {
  console.log(`\n  Enriching top ${topN} with live position data...`);
  const top = scores.slice(0, topN);

  const enriched = await Promise.all(
    top.map(async (s) => {
      try {
        const state = await post<{
          assetPositions: {
            position: {
              coin: string; szi: string; entryPx: string; positionValue: string;
              leverage: { value: number }; unrealizedPnl: string; returnOnEquity: string;
            };
          }[];
          marginSummary: { accountValue: string };
        }>({ type: "clearinghouseState", user: s.address });

        s.candidate.hasOpenPositions = state.assetPositions.length > 0;
        s.candidate.positionCount = state.assetPositions.length;

        return { score: s, positions: state.assetPositions, liveAccountValue: parseFloat(state.marginSummary.accountValue) };
      } catch {
        return { score: s, positions: [], liveAccountValue: 0 };
      }
    })
  );

  return enriched.map((e) => e.score);
}

// ─── Main ────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║   Multi-Source Trader Discovery & Scoring Engine        ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  // ── Step 1: Fetch from all sources ──
  console.log("STEP 1: Fetching from multiple sources...\n");

  const [leaderboardRaw, hlpRaw] = await Promise.all([
    fetchFromLeaderboard(),
    fetchFromHlpVault(),
  ]);

  console.log(`\n  Leaderboard: ${leaderboardRaw.length} traders`);
  console.log(`  HLP Vault:   ${hlpRaw.length} followers`);

  // ── Step 2: Filter leaderboard to quality traders ──
  console.log("\nSTEP 2: Filtering for quality traders...\n");

  const filtered = filterLeaderboard(leaderboardRaw);
  console.log(`  After filter: ${filtered.length} quality traders (from ${leaderboardRaw.length})`);
  console.log(`  Filter criteria: AcctValue >= $50k, AllTime PnL >= $50k, Month PnL > 0, ROI >= 20%, Volume >= $500k/mo`);

  // ── Step 3: Merge and deduplicate ──
  console.log("\nSTEP 3: Merging and deduplicating...\n");

  const seen = new Map<string, TraderCandidate>();
  for (const c of filtered) seen.set(c.address.toLowerCase(), c);
  const hlpNotInLeaderboard = hlpRaw.filter((c) => !seen.has(c.address.toLowerCase()));
  for (const c of hlpNotInLeaderboard) seen.set(c.address.toLowerCase(), c);

  console.log(`  Merged unique: ${seen.size} traders`);
  console.log(`  From leaderboard: ${filtered.length}`);
  console.log(`  HLP-only (not in leaderboard): ${hlpNotInLeaderboard.length}`);

  // ── Step 4: Score all candidates ──
  console.log("\nSTEP 4: Scoring traders...\n");

  const allCandidates = Array.from(seen.values());
  const scores = allCandidates
    .map(scoreTrader)
    .sort((a, b) => b.totalScore - a.totalScore);

  // Tier distribution
  const tierCounts = { S: 0, A: 0, B: 0, C: 0, D: 0 };
  for (const s of scores) tierCounts[s.tier]++;
  console.log(`  Tier distribution:`);
  console.log(`    S-tier: ${tierCounts.S} | A-tier: ${tierCounts.A} | B-tier: ${tierCounts.B} | C-tier: ${tierCounts.C} | D-tier: ${tierCounts.D}`);

  // ── Step 5: Enrich top traders with live data ──
  console.log("\nSTEP 5: Enriching with live positions...");

  const topScores = scores.filter((s) => s.tier === "S" || s.tier === "A").slice(0, 30);
  await enrichTopTraders(topScores, 30);

  // ── Step 6: Final output ──
  console.log("\n\n═══════════════════════════════════════════════════════════════════════════════════════════════════");
  console.log("  TOP TRADERS — S & A Tier");
  console.log("═══════════════════════════════════════════════════════════════════════════════════════════════════\n");

  const fmtUsd = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;

  console.log(
    `  # | Tier | Score |    Address     |      AcctValue |   AllTime PnL |   Month PnL | Month ROI | Positions | Flags`
  );
  console.log("-".repeat(130));

  for (let i = 0; i < topScores.length; i++) {
    const s = topScores[i];
    const lb = s.candidate.leaderboard;
    if (!lb) continue;

    console.log(
      `${(i + 1).toString().padStart(3)} | ` +
      `  ${s.tier}  | ` +
      `${s.totalScore.toFixed(1).padStart(5)} | ` +
      `${s.address.slice(0, 6)}...${s.address.slice(-4)} | ` +
      `${fmtUsd(s.candidate.accountValue).padStart(14)} | ` +
      `${fmtUsd(lb.allTimePnl).padStart(14)} | ` +
      `${fmtUsd(lb.monthPnl).padStart(12)} | ` +
      `${fmtPct(lb.monthRoi).padStart(9)} | ` +
      `${s.candidate.positionCount.toString().padStart(9)} | ` +
      `${s.flags.join(", ") || "-"}`
    );
  }

  // ── Detail view of top 5 ──
  console.log("\n\n═══════════════════════════════════════════════════════════════════════════════════════════════════");
  console.log("  TOP 5 DETAILED VIEW");
  console.log("═══════════════════════════════════════════════════════════════════════════════════════════════════\n");

  for (const s of topScores.slice(0, 5)) {
    const lb = s.candidate.leaderboard!;
    console.log(`Trader: ${s.address}`);
    console.log(`  Tier: ${s.tier} | Score: ${s.totalScore}`);
    console.log(`  Dimensions: Prof=${s.dimensions.profitability} Cons=${s.dimensions.consistency} Risk=${s.dimensions.riskManagement} Act=${s.dimensions.activity} Scale=${s.dimensions.scale}`);
    console.log(`  Account:    ${fmtUsd(s.candidate.accountValue)}`);
    console.log(`  AllTime:    PnL ${fmtUsd(lb.allTimePnl)} | ROI ${fmtPct(lb.allTimeRoi)} | Vol ${fmtUsd(lb.allTimeVolume)}`);
    console.log(`  Month:      PnL ${fmtUsd(lb.monthPnl)} | ROI ${fmtPct(lb.monthRoi)} | Vol ${fmtUsd(lb.monthVolume)}`);
    console.log(`  Week:       PnL ${fmtUsd(lb.weekPnl)} | ROI ${fmtPct(lb.weekRoi)}`);
    console.log(`  Day:        PnL ${fmtUsd(lb.dayPnl)} | ROI ${fmtPct(lb.dayRoi)}`);
    console.log(`  Positions:  ${s.candidate.positionCount} open`);
    console.log(`  Flags:      ${s.flags.join(", ") || "none"}`);

    // Fetch live positions for top 5
    if (s.candidate.hasOpenPositions) {
      const state = await post<{
        assetPositions: {
          position: {
            coin: string; szi: string; entryPx: string; positionValue: string;
            leverage: { value: number }; unrealizedPnl: string; returnOnEquity: string;
            liquidationPx: string | null;
          };
        }[];
      }>({ type: "clearinghouseState", user: s.address });

      for (const ap of state.assetPositions.slice(0, 10)) {
        const p = ap.position;
        const side = parseFloat(p.szi) > 0 ? "LONG" : "SHORT";
        const liq = p.liquidationPx ? `$${parseFloat(p.liquidationPx).toLocaleString()}` : "N/A";
        console.log(
          `    ${p.coin.padEnd(8)} ${side.padEnd(5)} | ` +
          `${fmtUsd(parseFloat(p.positionValue)).padStart(12)} | ` +
          `${p.leverage.value}x | ` +
          `Entry: $${parseFloat(p.entryPx).toLocaleString()} | ` +
          `uPnL: ${fmtUsd(parseFloat(p.unrealizedPnl))} | ` +
          `ROE: ${fmtPct(parseFloat(p.returnOnEquity))} | ` +
          `Liq: ${liq}`
        );
      }
    }
    console.log();
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nCompleted in ${elapsed}s`);
}

main().catch(console.error);
