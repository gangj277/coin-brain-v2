import { createHash } from "node:crypto";
import type {
  BaseSignalSnapshot,
  ServedSignalSnapshot,
  SignalAnalysisMap,
  ServedSignal,
} from "./types";

interface ServedSignalBody {
  signals: ServedSignalSnapshot["signals"];
  count: number;
  stats: ServedSignalSnapshot["stats"];
  timestamp: number;
}

function buildBody(snapshot: BaseSignalSnapshot, analysisMap: SignalAnalysisMap): ServedSignalBody {
  const signals = snapshot.signals.map((signal) => ({
    ...signal,
    analysis: analysisMap[signal.coin]?.analysis ?? null,
    narrative: analysisMap[signal.coin]?.narrative ?? "",
  }));

  return {
    signals,
    count: signals.length,
    stats: snapshot.stats,
    timestamp: snapshot.timestamp,
  };
}

export class SignalAssemblyService {
  buildServedSnapshot(
    snapshot: BaseSignalSnapshot,
    analysisMap: SignalAnalysisMap = {}
  ): ServedSignalSnapshot {
    const body = buildBody(snapshot, analysisMap);
    return {
      ...body,
      etag: this.createEtag(body),
    };
  }

  extractAnalysisMap(
    snapshot: ServedSignalSnapshot | null | undefined
  ): SignalAnalysisMap {
    if (!snapshot) return {};

    return Object.fromEntries(
      snapshot.signals
        .filter((signal) => signal.analysis)
        .map((signal) => [
          signal.coin,
          {
            analysis: signal.analysis!,
            narrative: signal.narrative,
          },
        ])
    );
  }

  private createEtag(body: ServedSignalBody): string {
    const hash = createHash("sha1").update(JSON.stringify(body)).digest("base64url");
    return `"${hash}"`;
  }
}
