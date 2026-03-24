import { NextRequest } from "next/server";
import { PositionTracker } from "@/lib/hyperliquid/tracker";

export async function GET(request: NextRequest) {
  const tracker = PositionTracker.getInstance();
  if (!tracker.isInitialized()) {
    return Response.json({ error: "Tracker not initialized" }, { status: 503 });
  }

  const { searchParams } = request.nextUrl;
  const coin = searchParams.get("coin");
  const store = tracker.getStore();

  if (coin) {
    const traders = store.getTradersByCoin(coin.toUpperCase());
    return Response.json({
      coin: coin.toUpperCase(),
      traders: traders.map((t) => ({
        address: t.address,
        tier: t.tier,
        positions: t.state?.assetPositions
          .filter((ap) => ap.position.coin === coin.toUpperCase())
          .map((ap) => {
            const p = ap.position;
            return {
              coin: p.coin,
              side: parseFloat(p.szi) > 0 ? "LONG" : "SHORT",
              size: Math.abs(parseFloat(p.szi)),
              sizeUsd: parseFloat(p.positionValue),
              leverage: p.leverage.value,
              entryPx: parseFloat(p.entryPx),
              unrealizedPnl: parseFloat(p.unrealizedPnl),
            };
          }) ?? [],
      })),
    });
  }

  const all = store.getAllPositions();
  const stats = store.getStats();

  return Response.json({
    stats,
    trackerStats: tracker.getStats(),
    traders: all,
  });
}
