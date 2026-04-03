import {
  RedisSignalSnapshotRepository,
  type SignalSnapshotRepository,
} from "@/lib/pipeline/signal-snapshot-repository";

export const dynamic = "force-dynamic";

export function buildSignalsRouteHandler(
  repository: Pick<SignalSnapshotRepository, "loadServed">
) {
  return async function GET(request: Request) {
    try {
      const snapshot = await repository.loadServed();
      if (!snapshot) {
        return Response.json(
          { error: "No data yet. Waiting for first cron run." },
          { status: 503 }
        );
      }

      const headers = new Headers({
        "Cache-Control": "private, max-age=0, must-revalidate",
        ETag: snapshot.etag,
      });
      const ifNoneMatch = request.headers.get("if-none-match");
      if (ifNoneMatch === snapshot.etag) {
        return new Response(null, {
          status: 304,
          headers,
        });
      }

      return Response.json(
        {
          signals: snapshot.signals,
          count: snapshot.count,
          stats: snapshot.stats,
          timestamp: snapshot.timestamp,
        },
        { headers }
      );
    } catch (error) {
      return Response.json(
        { error: (error as Error).message },
        { status: 500 }
      );
    }
  };
}

const defaultRepository = new RedisSignalSnapshotRepository();

export const GET = buildSignalsRouteHandler(defaultRepository);
