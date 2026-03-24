/**
 * Trader scoring and ranking system.
 *
 * Scores traders on multiple dimensions to find consistently profitable ones,
 * not just lucky gamblers. Each dimension is scored 0–100 and weighted.
 */

import type { TraderCandidate } from "./discovery";
import type { TraderAnalysis } from "./analysis";

// ─── Score Dimensions ────────────────────────────────────

export interface TraderScore {
  address: string;
  totalScore: number; // 0–100 composite
  dimensions: {
    profitability: number;  // All-time PnL relative to account size
    consistency: number;    // Month-over-month positive performance
    riskManagement: number; // Leverage discipline + drawdown control
    activity: number;       // Active trading volume + position count
    scale: number;          // Account size (bigger = more conviction/skill)
  };
  tier: "S" | "A" | "B" | "C" | "D";
  flags: string[]; // warnings like "high_leverage", "recent_loss"
}

// ─── Scoring from Leaderboard Data (fast, no extra API calls) ──

export function scoreFromLeaderboard(candidate: TraderCandidate): TraderScore {
  const lb = candidate.leaderboard;
  const flags: string[] = [];

  if (!lb) {
    return {
      address: candidate.address,
      totalScore: 0,
      dimensions: {
        profitability: 0,
        consistency: 0,
        riskManagement: 50, // unknown
        activity: 0,
        scale: 0,
      },
      tier: "D",
      flags: ["no_leaderboard_data"],
    };
  }

  // 1. Profitability (0-100): All-time ROI
  //    < 0% → 0, 50% → 50, 100% → 70, 500% → 90, 1000%+ → 100
  const roiPct = lb.allTimeRoi * 100;
  const profitability = Math.min(100, Math.max(0,
    roiPct <= 0 ? 0 :
    roiPct <= 100 ? roiPct * 0.7 :
    70 + Math.min(30, (roiPct - 100) / 30)
  ));

  // 2. Consistency (0-100): All timeframes positive = good
  //    Score based on how many windows are profitable
  let consistencyPoints = 0;
  if (lb.dayPnl > 0) consistencyPoints += 15;
  if (lb.weekPnl > 0) consistencyPoints += 25;
  if (lb.monthPnl > 0) consistencyPoints += 35;
  if (lb.allTimePnl > 0) consistencyPoints += 25;
  // Bonus: month ROI > 5% while allTime also positive
  if (lb.monthRoi > 0.05 && lb.allTimePnl > 0) consistencyPoints += 10;
  const consistency = Math.min(100, consistencyPoints);

  if (lb.monthPnl < 0) flags.push("recent_month_loss");
  if (lb.weekPnl < 0) flags.push("recent_week_loss");

  // 3. Risk Management (0-100): Inferred from ROI stability
  //    If allTime ROI is positive but month ROI has huge swings, risky
  const monthVsAllTimeRatio = lb.allTimeRoi !== 0
    ? Math.abs(lb.monthRoi / lb.allTimeRoi)
    : 0;
  // Ratio close to 0-0.5 is stable, >2 is volatile
  const riskManagement = Math.min(100, Math.max(0,
    monthVsAllTimeRatio <= 0.5 ? 80 :
    monthVsAllTimeRatio <= 1.0 ? 60 :
    monthVsAllTimeRatio <= 2.0 ? 40 :
    20
  ));

  // 4. Activity (0-100): Based on monthly volume
  //    $0 → 0, $1M → 30, $10M → 50, $100M → 70, $1B → 90, $10B+ → 100
  const volLog = lb.monthVolume > 0 ? Math.log10(lb.monthVolume) : 0;
  const activity = Math.min(100, Math.max(0, (volLog - 4) * 16.67));

  if (lb.monthVolume < 100_000) flags.push("low_activity");

  // 5. Scale (0-100): Account size
  //    $1k → 0, $10k → 20, $100k → 40, $1M → 60, $10M → 80, $100M → 100
  const acctLog = candidate.accountValue > 0
    ? Math.log10(candidate.accountValue)
    : 0;
  const scale = Math.min(100, Math.max(0, (acctLog - 3) * 20));

  if (candidate.accountValue < 50_000) flags.push("small_account");

  // Weighted composite
  const totalScore =
    profitability * 0.30 +
    consistency * 0.25 +
    riskManagement * 0.15 +
    activity * 0.15 +
    scale * 0.15;

  // Tier
  const tier =
    totalScore >= 80 ? "S" :
    totalScore >= 65 ? "A" :
    totalScore >= 50 ? "B" :
    totalScore >= 35 ? "C" : "D";

  return {
    address: candidate.address,
    totalScore: Math.round(totalScore * 10) / 10,
    dimensions: {
      profitability: Math.round(profitability * 10) / 10,
      consistency: Math.round(consistency * 10) / 10,
      riskManagement: Math.round(riskManagement * 10) / 10,
      activity: Math.round(activity * 10) / 10,
      scale: Math.round(scale * 10) / 10,
    },
    tier,
    flags,
  };
}

// ─── Enhanced Scoring with Full Analysis Data ────────────

export function scoreFromAnalysis(
  candidate: TraderCandidate,
  analysis: TraderAnalysis
): TraderScore {
  const base = scoreFromLeaderboard(candidate);

  // Override risk management with actual data
  if (analysis.metrics.avgLeverage > 0) {
    // Avg leverage: 1-5x → 90, 5-10x → 70, 10-20x → 50, 20-50x → 30, 50x+ → 10
    const levScore =
      analysis.metrics.avgLeverage <= 5 ? 90 :
      analysis.metrics.avgLeverage <= 10 ? 70 :
      analysis.metrics.avgLeverage <= 20 ? 50 :
      analysis.metrics.avgLeverage <= 50 ? 30 : 10;

    // Win rate bonus
    const winRateScore = analysis.metrics.winRate * 100;

    // Profit factor
    const pfScore =
      analysis.metrics.profitFactor >= 3 ? 90 :
      analysis.metrics.profitFactor >= 2 ? 70 :
      analysis.metrics.profitFactor >= 1.5 ? 55 :
      analysis.metrics.profitFactor >= 1 ? 35 : 10;

    base.dimensions.riskManagement = Math.round(
      (levScore * 0.4 + winRateScore * 0.3 + pfScore * 0.3) * 10
    ) / 10;

    if (analysis.metrics.avgLeverage > 25) base.flags.push("high_leverage");
    if (analysis.metrics.winRate < 0.4) base.flags.push("low_win_rate");
    if (analysis.metrics.profitFactor < 1) base.flags.push("negative_expectancy");
  }

  // Recalculate total
  const d = base.dimensions;
  base.totalScore = Math.round(
    (d.profitability * 0.30 +
     d.consistency * 0.25 +
     d.riskManagement * 0.15 +
     d.activity * 0.15 +
     d.scale * 0.15) * 10
  ) / 10;

  base.tier =
    base.totalScore >= 80 ? "S" :
    base.totalScore >= 65 ? "A" :
    base.totalScore >= 50 ? "B" :
    base.totalScore >= 35 ? "C" : "D";

  return base;
}

// ─── Rank and Filter ─────────────────────────────────────

export interface RankingOptions {
  minTier?: "S" | "A" | "B" | "C" | "D";
  minScore?: number;
  maxResults?: number;
  excludeFlags?: string[]; // exclude traders with these flags
}

export function rankTraders(
  scores: TraderScore[],
  options: RankingOptions = {}
): TraderScore[] {
  const {
    minTier = "C",
    minScore = 0,
    maxResults = 50,
    excludeFlags = [],
  } = options;

  const tierRank = { S: 5, A: 4, B: 3, C: 2, D: 1 };
  const minTierRank = tierRank[minTier];

  return scores
    .filter((s) => {
      if (tierRank[s.tier] < minTierRank) return false;
      if (s.totalScore < minScore) return false;
      if (excludeFlags.length > 0) {
        for (const flag of excludeFlags) {
          if (s.flags.includes(flag)) return false;
        }
      }
      return true;
    })
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, maxResults);
}
