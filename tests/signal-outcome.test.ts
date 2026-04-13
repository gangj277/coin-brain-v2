import test from "node:test";
import assert from "node:assert/strict";

test("outcome cron resolves pending checkpoints and aggregates forward-return stats", async () => {
  const previousSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "test-secret";
  try {
    const { buildOutcomeRouteHandler } = await import("../app/api/cron/outcome/route");

    let savedPending: unknown = null;
    let savedStats: Record<string, unknown> | null = null;

    const handler = buildOutcomeRouteHandler({
      repository: {
        loadPending: async () => [
          {
            id: "btc-strong-consensus-long",
            coin: "BTC",
            direction: "LONG",
            entryPrice: 100,
            emittedAt: Date.UTC(2026, 3, 12, 10, 0, 0),
            checkpoints: {
              "1h": null,
              "4h": null,
              "24h": null,
            },
            tags: {
              alignmentBand: "consensus",
              strength: "strong",
              smiSignal: "LONG",
              confirmed: true,
            },
          },
        ],
        savePending: async (pending: unknown) => {
          savedPending = pending;
        },
        loadStats: async () => ({}),
        saveStats: async (stats: Record<string, unknown>) => {
          savedStats = stats;
        },
      },
      fetchMarkPrice: async () => 110,
      now: () => Date.UTC(2026, 3, 13, 12, 30, 0),
    });

    const response = await handler(
      new Request("http://localhost/api/cron/outcome", {
        headers: {
          authorization: "Bearer test-secret",
        },
      })
    );

    assert.equal(response.status, 200);
    assert.ok(savedPending, "expected pending queue to be updated");
    assert.ok(
      ((savedStats as unknown) as Record<string, unknown>)?.strong_consensus_LONG,
      "expected grouped outcome stats"
    );

    const body = await response.json();
    assert.equal(body.evaluated, 3);
  } finally {
    if (previousSecret === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = previousSecret;
    }
  }
});
