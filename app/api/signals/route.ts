import { redis, KEYS } from "@/lib/redis/client";

export async function GET() {
  try {
    const [signalsRaw, analysisRaw, statsRaw, lastUpdate] = await Promise.all([
      redis.get<string>(KEYS.SIGNALS),
      redis.get<string>(KEYS.ANALYSIS),
      redis.get<string>(KEYS.STATS),
      redis.get<number>(KEYS.LAST_UPDATE),
    ]);

    if (!signalsRaw) {
      return Response.json({ error: "No data yet. Waiting for first cron run." }, { status: 503 });
    }

    const signals = typeof signalsRaw === "string" ? JSON.parse(signalsRaw) : signalsRaw;
    const analyses = analysisRaw
      ? (typeof analysisRaw === "string" ? JSON.parse(analysisRaw) : analysisRaw) as { coin: string; analysis: unknown; narrative: string }[]
      : [];
    const stats = statsRaw
      ? (typeof statsRaw === "string" ? JSON.parse(statsRaw) : statsRaw)
      : null;

    // Merge analyses into signals
    const analysisMap = new Map(analyses.map((a: { coin: string; analysis: unknown; narrative: string }) => [a.coin, a]));
    const merged = signals.map((s: { coin: string }) => {
      const a = analysisMap.get(s.coin);
      return {
        ...s,
        analysis: a?.analysis ?? null,
        narrative: a?.narrative ?? "",
      };
    });

    return Response.json({
      signals: merged,
      count: merged.length,
      stats,
      timestamp: lastUpdate ?? Date.now(),
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
