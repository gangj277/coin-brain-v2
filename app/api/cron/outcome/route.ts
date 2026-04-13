import { NextRequest } from "next/server";
import {
  RedisSignalOutcomeRepository,
  type PendingSignalOutcome,
  type SignalOutcomeRepository,
  upsertOutcomeStat,
} from "@/lib/pipeline/signal-outcome-repository";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const HORIZONS = {
  "1h": 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
} as const;

interface OutcomeRouteDeps {
  repository?: SignalOutcomeRepository;
  fetchMarkPrice?: (coin: string) => Promise<number | null>;
  now?: () => number;
}

function buildDefaultFetchMarkPrice() {
  return async (_coin: string) => null;
}

function computeReturnPct(
  pending: PendingSignalOutcome,
  exitPrice: number
) {
  const rawReturn = (exitPrice - pending.entryPrice) / pending.entryPrice;
  return pending.direction === "LONG" ? rawReturn * 100 : -rawReturn * 100;
}

export function buildOutcomeRouteHandler(deps: OutcomeRouteDeps = {}) {
  const repository = deps.repository ?? new RedisSignalOutcomeRepository();
  const fetchMarkPrice = deps.fetchMarkPrice ?? buildDefaultFetchMarkPrice();
  const now = deps.now ?? Date.now;

  return async function GET(request: NextRequest | Request) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const currentTime = now();
    const pending = await repository.loadPending();
    const stats = await repository.loadStats();

    const priceCache = new Map<string, number | null>();
    let evaluated = 0;

    for (const entry of pending) {
      const elapsed = currentTime - entry.emittedAt;
      const dueHorizons = (Object.keys(HORIZONS) as Array<keyof typeof HORIZONS>).filter(
        (horizon) => elapsed >= HORIZONS[horizon] && entry.checkpoints[horizon] === null
      );
      if (dueHorizons.length === 0) continue;

      if (!priceCache.has(entry.coin)) {
        priceCache.set(entry.coin, await fetchMarkPrice(entry.coin));
      }
      const exitPrice = priceCache.get(entry.coin);
      if (!exitPrice) continue;

      for (const horizon of dueHorizons) {
        const returnPct = computeReturnPct(entry, exitPrice);
        entry.checkpoints[horizon] = {
          evaluatedAt: currentTime,
          exitPrice,
          returnPct,
        };
        upsertOutcomeStat(stats, entry, horizon, returnPct);
        evaluated += 1;
      }
    }

    await Promise.all([
      repository.savePending(pending),
      repository.saveStats(stats),
    ]);

    return Response.json({
      ok: true,
      evaluated,
      pending: pending.length,
    });
  };
}

export const GET = buildOutcomeRouteHandler();
