import { EventEmitter } from "events";
import type { PositionChange, TrackerStats } from "./types";

export interface TrackerEventMap {
  "position:change": [change: PositionChange];
  "position:opened": [change: PositionChange];
  "position:closed": [change: PositionChange];
  "tracker:started": [];
  "tracker:stopped": [];
  "tracker:error": [error: Error];
  "tracker:stats": [stats: TrackerStats];
  "ws:connected": [connId: number];
  "ws:disconnected": [connId: number];
  "poll:cycle": [durationMs: number, tradersPolled: number];
}

export class TrackerEventBus extends EventEmitter {
  emit<K extends keyof TrackerEventMap>(
    event: K,
    ...args: TrackerEventMap[K]
  ): boolean {
    return super.emit(event, ...args);
  }

  on<K extends keyof TrackerEventMap>(
    event: K,
    listener: (...args: TrackerEventMap[K]) => void,
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  off<K extends keyof TrackerEventMap>(
    event: K,
    listener: (...args: TrackerEventMap[K]) => void,
  ): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }
}
