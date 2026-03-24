/**
 * Test the real-time position tracker end-to-end.
 * Run: npx tsx scripts/test-tracker.ts
 *
 * This tests:
 * 1. Leaderboard discovery + scoring
 * 2. WebSocket connections for S/A tier
 * 3. REST polling for B tier
 * 4. Position change detection
 * 5. Stats tracking
 */

import { PositionTracker } from "../lib/hyperliquid/tracker";

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║   Real-Time Position Tracker — Integration Test         ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  const tracker = PositionTracker.getInstance({
    pollIntervalMs: 15_000,
    pollConcurrency: 15,
    wsSubscriptionsPerConn: 50,
    wsTierThreshold: "B",
  });

  const events = tracker.getEventBus();

  // Track events
  let changeCount = 0;
  const changeSummary: Record<string, number> = {};

  events.on("position:change", (change) => {
    changeCount++;
    changeSummary[change.type] = (changeSummary[change.type] || 0) + 1;

    const side = change.current
      ? (change.current.szi > 0 ? "LONG" : "SHORT")
      : change.previous
        ? (change.previous.szi > 0 ? "LONG" : "SHORT")
        : "?";
    const value = change.current?.positionValueUsd ?? change.previous?.positionValueUsd ?? 0;

    console.log(
      `  [${change.traderTier}] ${change.type.padEnd(20)} | ` +
      `${change.coin.padEnd(8)} ${side.padEnd(5)} | ` +
      `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 }).padStart(12)} | ` +
      `${change.traderAddress.slice(0, 10)}...`
    );
  });

  events.on("ws:connected", (id) => {
    console.log(`  [WS] Connection ${id} established`);
  });

  events.on("poll:cycle", (ms, count) => {
    console.log(`  [Poll] ${count} traders polled in ${(ms / 1000).toFixed(1)}s`);
  });

  // Initialize
  console.log("Initializing tracker...\n");
  await tracker.initialize();

  // Print initial stats
  const stats = tracker.getStats();
  console.log("\n--- Initial Stats ---");
  console.log(`  Total traders:     ${stats.totalTraders}`);
  console.log(`  WS traders:        ${stats.wsTraders}`);
  console.log(`  Poll traders:      ${stats.pollTraders}`);
  console.log(`  WS connections:    ${stats.wsConnections}`);
  console.log(`  WS connected:      ${stats.wsConnected}`);

  // Wait for data to flow in
  console.log("\n--- Waiting 30s for real-time data... ---\n");

  await new Promise((resolve) => setTimeout(resolve, 30_000));

  // Print final stats
  const finalStats = tracker.getStats();
  console.log("\n\n═══════════════════════════════════════════════════════");
  console.log("  FINAL RESULTS (after 30s)");
  console.log("═══════════════════════════════════════════════════════\n");
  console.log(`  Total traders:        ${finalStats.totalTraders}`);
  console.log(`  With positions:       ${finalStats.tradersWithPositions}`);
  console.log(`  Total positions:      ${finalStats.totalPositions}`);
  console.log(`  WS connections:       ${finalStats.wsConnections} (${finalStats.wsConnected} connected)`);
  console.log(`  Poll cycle time:      ${(finalStats.lastPollCycleMs / 1000).toFixed(1)}s`);
  console.log(`  Position changes:     ${finalStats.totalChangesEmitted}`);
  console.log(`  Uptime:               ${(finalStats.uptime / 1000).toFixed(1)}s`);

  if (Object.keys(changeSummary).length > 0) {
    console.log(`\n  Change breakdown:`);
    for (const [type, count] of Object.entries(changeSummary).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${type.padEnd(22)} ${count}`);
    }
  }

  // Show sample positions
  const store = tracker.getStore();
  const allPositions = store.getAllPositions();
  const withPos = allPositions.filter((t) => t.positions.length > 0);

  console.log(`\n  Sample positions (first 5 traders):`);
  for (const trader of withPos.slice(0, 5)) {
    console.log(`\n    ${trader.address.slice(0, 12)}... [${trader.tier}]`);
    for (const p of trader.positions.slice(0, 5)) {
      console.log(
        `      ${p.coin.padEnd(8)} ${p.side.padEnd(5)} | ` +
        `$${p.sizeUsd.toLocaleString(undefined, { maximumFractionDigits: 0 }).padStart(12)} | ` +
        `${p.leverage}x | uPnL: $${p.unrealizedPnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
      );
    }
  }

  // Recent changes
  const recent = store.getRecentChanges(10);
  if (recent.length > 0) {
    console.log(`\n  Last ${recent.length} position changes:`);
    for (const c of recent.reverse()) {
      const side = c.current ? (c.current.szi > 0 ? "L" : "S") : "X";
      const val = c.current?.positionValueUsd ?? c.previous?.positionValueUsd ?? 0;
      console.log(
        `    ${new Date(c.timestamp).toISOString().slice(11, 19)} | ` +
        `${c.type.padEnd(20)} ${c.coin.padEnd(6)} ${side} | ` +
        `$${val.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
      );
    }
  }

  tracker.stop();
  console.log("\nTest complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
