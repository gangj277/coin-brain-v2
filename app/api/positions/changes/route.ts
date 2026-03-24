import { NextRequest } from "next/server";
import { PositionTracker } from "@/lib/hyperliquid/tracker";

export async function GET(request: NextRequest) {
  const tracker = PositionTracker.getInstance();
  if (!tracker.isInitialized()) {
    return Response.json({ error: "Tracker not initialized" }, { status: 503 });
  }

  const { searchParams } = request.nextUrl;
  const limitStr = searchParams.get("limit");
  const coin = searchParams.get("coin");
  const type = searchParams.get("type");
  const limit = Math.min(500, parseInt(limitStr ?? "50"));

  let changes = tracker.getStore().getRecentChanges(limit);

  if (coin) {
    changes = changes.filter((c) => c.coin === coin.toUpperCase());
  }
  if (type) {
    changes = changes.filter((c) => c.type === type);
  }

  return Response.json({
    changes: changes.reverse(), // newest first
    count: changes.length,
  });
}
