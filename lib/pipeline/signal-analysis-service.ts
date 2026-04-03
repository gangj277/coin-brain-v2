import { narrateSignals, type NarratedSignal } from "@/lib/signals/narrator";
import type { BaseSignalSnapshot, SignalAnalysisMap } from "./types";

export interface SignalAnalysisServiceDeps {
  narrate?: (signals: BaseSignalSnapshot["signals"]) => Promise<NarratedSignal[]>;
}

export class SignalAnalysisService {
  private readonly narrate: NonNullable<SignalAnalysisServiceDeps["narrate"]>;

  constructor(deps: SignalAnalysisServiceDeps = {}) {
    this.narrate = deps.narrate ?? narrateSignals;
  }

  async analyze(snapshot: BaseSignalSnapshot): Promise<SignalAnalysisMap> {
    const narrated = await this.narrate(snapshot.signals);
    const analysisMap: SignalAnalysisMap = {};

    for (const signal of narrated) {
      if (!signal.analysis) continue;

      analysisMap[signal.coin] = {
        analysis: signal.analysis,
        narrative: signal.narrative,
      };
    }

    return analysisMap;
  }
}
