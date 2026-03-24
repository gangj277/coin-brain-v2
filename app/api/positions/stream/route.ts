import { PositionTracker } from "@/lib/hyperliquid/tracker";
import type { PositionChange } from "@/lib/hyperliquid/tracker";

export const dynamic = "force-dynamic";

export async function GET() {
  const tracker = PositionTracker.getInstance();
  if (!tracker.isInitialized()) {
    return Response.json({ error: "Tracker not initialized" }, { status: 503 });
  }

  const eventBus = tracker.getEventBus();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send initial stats
      const stats = tracker.getStats();
      controller.enqueue(
        encoder.encode(`event: stats\ndata: ${JSON.stringify(stats)}\n\n`)
      );

      const handler = (change: PositionChange) => {
        try {
          controller.enqueue(
            encoder.encode(
              `event: position\ndata: ${JSON.stringify(change)}\n\n`
            )
          );
        } catch {
          // stream closed
          eventBus.off("position:change", handler);
        }
      };

      eventBus.on("position:change", handler);

      // Periodic stats every 30s
      const statsInterval = setInterval(() => {
        try {
          const s = tracker.getStats();
          controller.enqueue(
            encoder.encode(`event: stats\ndata: ${JSON.stringify(s)}\n\n`)
          );
        } catch {
          clearInterval(statsInterval);
        }
      }, 30_000);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
