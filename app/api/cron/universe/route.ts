import { NextRequest } from "next/server";
import {
  RedisTraderUniverseRepository,
  type TraderUniverseRepository,
} from "@/lib/pipeline/trader-universe-repository";
import { TraderUniverseService } from "@/lib/pipeline/trader-universe-service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface UniverseRouteDeps {
  traderUniverseRepository?: TraderUniverseRepository;
  traderUniverseService?: TraderUniverseService;
  now?: () => number;
}

export function buildUniverseRouteHandler(deps: UniverseRouteDeps = {}) {
  const traderUniverseRepository =
    deps.traderUniverseRepository ?? new RedisTraderUniverseRepository();
  const traderUniverseService =
    deps.traderUniverseService ??
    new TraderUniverseService({
      repository: traderUniverseRepository,
    });
  const now = deps.now ?? Date.now;

  return async function GET(request: NextRequest) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const startedAt = now();

    try {
      const snapshot = await traderUniverseService.refreshActiveUniverse();
      const duration = now() - startedAt;
      return Response.json({
        ok: true,
        traders: snapshot.traders.length,
        duration: `${(duration / 1000).toFixed(1)}s`,
      });
    } catch (error) {
      return Response.json(
        { error: (error as Error).message },
        { status: 500 }
      );
    }
  };
}

export const GET = buildUniverseRouteHandler();
