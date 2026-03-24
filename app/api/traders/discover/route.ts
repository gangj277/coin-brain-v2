import { NextRequest } from "next/server";
import {
  discoverTraders,
  scoreFromLeaderboard,
  rankTraders,
} from "@/lib/hyperliquid";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const minTier = (searchParams.get("minTier") ?? "B") as "S" | "A" | "B" | "C" | "D";
    const limit = Math.min(100, parseInt(searchParams.get("limit") ?? "30"));
    const onlyWithPositions = searchParams.get("withPositions") === "true";

    const candidates = await discoverTraders({
      leaderboardFilter: {
        minAccountValue: 50_000,
        minAllTimePnl: 50_000,
        minMonthPnl: 1_000,
        minAllTimeRoi: 0.2,
        maxEntries: 300,
      },
      hlpTopN: 100,
      enrichLive: onlyWithPositions,
      onlyWithPositions,
    });

    const scores = candidates
      .map(scoreFromLeaderboard)
      .filter((s) => s.totalScore > 0);

    const ranked = rankTraders(scores, {
      minTier,
      maxResults: limit,
    });

    const results = ranked.map((s) => {
      const c = candidates.find((c) => c.address === s.address);
      return {
        ...s,
        leaderboard: c?.leaderboard ?? null,
        hasOpenPositions: c?.hasOpenPositions ?? false,
        positionCount: c?.positionCount ?? 0,
      };
    });

    return Response.json({
      traders: results,
      count: results.length,
      totalCandidates: candidates.length,
    });
  } catch (e) {
    return Response.json(
      { error: (e as Error).message },
      { status: 500 }
    );
  }
}
