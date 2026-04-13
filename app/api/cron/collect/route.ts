import { NextRequest } from "next/server";
import { PositionCollectionService } from "@/lib/pipeline/position-collection-service";
import {
  RedisSignalEngineStateRepository,
  type SignalEngineStateRepository,
} from "@/lib/pipeline/signal-engine-state-repository";
import {
  RedisSignalOutcomeRepository,
  registerPendingServedSignals,
  type SignalOutcomeRepository,
} from "@/lib/pipeline/signal-outcome-repository";
import {
  RedisSignalSnapshotRepository,
  type SignalSnapshotRepository,
} from "@/lib/pipeline/signal-snapshot-repository";
import { SignalAssemblyService } from "@/lib/pipeline/signal-assembly-service";
import {
  RedisTraderUniverseRepository,
  type TraderUniverseRepository,
} from "@/lib/pipeline/trader-universe-repository";
import { TraderUniverseService } from "@/lib/pipeline/trader-universe-service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface CollectRouteDeps {
  traderUniverseRepository?: TraderUniverseRepository;
  signalSnapshotRepository?: SignalSnapshotRepository;
  signalEngineStateRepository?: SignalEngineStateRepository;
  signalOutcomeRepository?: SignalOutcomeRepository;
  traderUniverseService?: TraderUniverseService;
  positionCollectionService?: PositionCollectionService;
  signalAssemblyService?: SignalAssemblyService;
  now?: () => number;
}

export function buildCollectRouteHandler(deps: CollectRouteDeps = {}) {
  const traderUniverseRepository =
    deps.traderUniverseRepository ?? new RedisTraderUniverseRepository();
  const signalSnapshotRepository =
    deps.signalSnapshotRepository ?? new RedisSignalSnapshotRepository();
  const signalEngineStateRepository =
    deps.signalEngineStateRepository ?? new RedisSignalEngineStateRepository();
  const signalOutcomeRepository =
    deps.signalOutcomeRepository ?? new RedisSignalOutcomeRepository();
  const traderUniverseService =
    deps.traderUniverseService ??
    new TraderUniverseService({
      repository: traderUniverseRepository,
    });
  const positionCollectionService =
    deps.positionCollectionService ??
    new PositionCollectionService({
      loadRecentPositionEvents: () =>
        signalEngineStateRepository.loadRecentPositionEvents(),
      saveRecentPositionEvents: (events) =>
        signalEngineStateRepository.saveRecentPositionEvents(events),
      loadSmiHistory: (coins) => signalEngineStateRepository.loadSmiHistory(coins),
      saveSmiHistory: (historyByCoin) =>
        signalEngineStateRepository.saveSmiHistory(historyByCoin),
      saveLatestSmi: (latestByCoin) =>
        signalEngineStateRepository.saveLatestSmi(latestByCoin),
      loadMarketContextHistory: (coins) =>
        signalEngineStateRepository.loadMarketContextHistory(coins),
      saveMarketContextHistory: (historyByCoin) =>
        signalEngineStateRepository.saveMarketContextHistory(historyByCoin),
    });
  const signalAssemblyService =
    deps.signalAssemblyService ?? new SignalAssemblyService();
  const now = deps.now ?? Date.now;

  return async function GET(request: NextRequest) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const startedAt = now();

    try {
      const { snapshot: universe, refreshedInline } =
        await traderUniverseService.ensureActiveUniverse();
      const baseSnapshot = await positionCollectionService.collect(universe, {
        fallbackUniverseRefresh: refreshedInline,
      });
      await signalSnapshotRepository.saveBase(baseSnapshot);

      const previousServed = await signalSnapshotRepository.loadServed();
      const carriedAnalysis = signalAssemblyService.extractAnalysisMap(previousServed);
      const servedSnapshot = signalAssemblyService.buildServedSnapshot(
        baseSnapshot,
        carriedAnalysis
      );
      await signalSnapshotRepository.saveServed(servedSnapshot);
      await registerPendingServedSignals({
        repository: signalOutcomeRepository,
        snapshot: servedSnapshot,
      });

      const duration = now() - startedAt;
      return Response.json({
        ok: true,
        traders: universe.traders.length,
        signals: baseSnapshot.signals.length,
        positions: baseSnapshot.stats.totalPositions,
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

export const GET = buildCollectRouteHandler();
