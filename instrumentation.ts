export async function register() {
  // Only run tracker on the Node.js server, not in Edge or browser
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { PositionTracker } = await import("./lib/hyperliquid/tracker");
    const tracker = PositionTracker.getInstance();

    // Log position changes
    tracker.getEventBus().on("position:change", (change) => {
      const side = change.current
        ? (change.current.szi > 0 ? "LONG" : "SHORT")
        : change.previous
          ? (change.previous.szi > 0 ? "LONG" : "SHORT")
          : "?";
      const value = change.current?.positionValueUsd ?? change.previous?.positionValueUsd ?? 0;
      console.log(
        `[${change.traderTier}] ${change.type.padEnd(20)} | ${change.coin.padEnd(8)} ${side.padEnd(5)} | $${value.toLocaleString(undefined, { maximumFractionDigits: 0 }).padStart(12)} | ${change.traderAddress.slice(0, 10)}...`
      );
    });

    tracker.getEventBus().on("poll:cycle", (ms, count) => {
      console.log(`[Poller] Cycle completed: ${count} traders in ${(ms / 1000).toFixed(1)}s`);
    });

    // Initialize async — don't block server startup
    tracker.initialize().catch((err) => {
      console.error("[Tracker] Initialization failed:", err);
    });
  }
}
