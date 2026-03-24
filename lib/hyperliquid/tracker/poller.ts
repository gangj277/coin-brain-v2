import { getClearinghouseState } from "../client";
import type { TrackerConfig } from "./types";
import { PositionStore } from "./store";
import { TrackerEventBus } from "./events";

export class RestPoller {
  private store: PositionStore;
  private events: TrackerEventBus;
  private config: TrackerConfig;
  private addresses: string[] = [];
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(store: PositionStore, events: TrackerEventBus, config: TrackerConfig) {
    this.store = store;
    this.events = events;
    this.config = config;
  }

  start(addresses: string[]) {
    this.addresses = [...addresses];
    this.running = true;

    // Run first cycle immediately, then on interval
    this.pollCycle();
    this.intervalHandle = setInterval(
      () => this.pollCycle(),
      this.config.pollIntervalMs
    );

    console.log(
      `[Poller] Started polling ${addresses.length} traders every ${this.config.pollIntervalMs / 1000}s`
    );
  }

  stop() {
    this.running = false;
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  addTraders(addrs: string[]) {
    for (const a of addrs) {
      const key = a.toLowerCase();
      if (!this.addresses.includes(key)) this.addresses.push(key);
    }
  }

  removeTraders(addrs: string[]) {
    const toRemove = new Set(addrs.map((a) => a.toLowerCase()));
    this.addresses = this.addresses.filter((a) => !toRemove.has(a));
  }

  // ─── Poll Cycle ────────────────────────────────────

  private async pollCycle() {
    if (!this.running || this.addresses.length === 0) return;

    const start = Date.now();
    const concurrency = this.config.pollConcurrency;

    for (let i = 0; i < this.addresses.length; i += concurrency) {
      if (!this.running) break;

      const batch = this.addresses.slice(i, i + concurrency);
      const results = await Promise.allSettled(
        batch.map((addr) => this.pollOne(addr))
      );

      // Count errors
      for (const r of results) {
        if (r.status === "rejected") {
          // silently skip individual failures
        }
      }
    }

    const duration = Date.now() - start;
    this.events.emit("poll:cycle", duration, this.addresses.length);
  }

  private async pollOne(address: string) {
    const state = await getClearinghouseState(address);
    const changes = this.store.updateState(address, state);

    for (const change of changes) {
      this.events.emit("position:change", change);
      if (change.type === "position_opened") {
        this.events.emit("position:opened", change);
      } else if (change.type === "position_closed") {
        this.events.emit("position:closed", change);
      }
    }
  }
}
