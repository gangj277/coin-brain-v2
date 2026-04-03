import { NextRequest } from "next/server";
import { SignalAnalysisService } from "@/lib/pipeline/signal-analysis-service";
import {
  RedisSignalSnapshotRepository,
  type SignalSnapshotRepository,
} from "@/lib/pipeline/signal-snapshot-repository";
import { SignalAssemblyService } from "@/lib/pipeline/signal-assembly-service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface AnalyzeRouteDeps {
  signalSnapshotRepository?: SignalSnapshotRepository;
  signalAnalysisService?: SignalAnalysisService;
  signalAssemblyService?: SignalAssemblyService;
}

export function buildAnalyzeRouteHandler(deps: AnalyzeRouteDeps = {}) {
  const signalSnapshotRepository =
    deps.signalSnapshotRepository ?? new RedisSignalSnapshotRepository();
  const signalAnalysisService =
    deps.signalAnalysisService ?? new SignalAnalysisService();
  const signalAssemblyService =
    deps.signalAssemblyService ?? new SignalAssemblyService();

  return async function GET(request: NextRequest) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      const baseSnapshot = await signalSnapshotRepository.loadBase();
      if (!baseSnapshot) {
        return Response.json({ error: "No base snapshot in Redis" }, { status: 404 });
      }

      const analysisMap = await signalAnalysisService.analyze(baseSnapshot);
      const servedSnapshot = signalAssemblyService.buildServedSnapshot(
        baseSnapshot,
        analysisMap
      );
      await signalSnapshotRepository.saveServed(servedSnapshot);

      return Response.json({
        ok: true,
        total: baseSnapshot.signals.length,
        analyzed: Object.keys(analysisMap).length,
      });
    } catch (error) {
      return Response.json(
        { error: (error as Error).message },
        { status: 500 }
      );
    }
  };
}

export const GET = buildAnalyzeRouteHandler();
