import { NextRequest } from "next/server";
import { redis, KEYS } from "@/lib/redis/client";
import { narrateSignals } from "@/lib/signals/narrator";
import type { Signal } from "@/lib/signals/aggregator";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Read current signals from Redis
    const raw = await redis.get<string>(KEYS.SIGNALS);
    if (!raw) {
      return Response.json({ error: "No signals in Redis" }, { status: 404 });
    }

    const signals: Signal[] = typeof raw === "string" ? JSON.parse(raw) : raw;

    // Generate AI analyses
    const narrated = await narrateSignals(signals);

    // Store back with analyses
    await redis.set(KEYS.ANALYSIS, JSON.stringify(
      narrated
        .filter((s) => s.analysis)
        .map((s) => ({ coin: s.coin, analysis: s.analysis, narrative: s.narrative }))
    ));

    const withAnalysis = narrated.filter((s) => s.analysis).length;

    return Response.json({
      ok: true,
      total: signals.length,
      analyzed: withAnalysis,
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
