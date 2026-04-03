import { NextRequest } from "next/server";
import { getRedis, KEYS } from "@/lib/redis/client";
import {
  RedisSignalSnapshotRepository,
  type SignalSnapshotRepository,
} from "@/lib/pipeline/signal-snapshot-repository";
import type { ServedSignalSnapshot } from "@/lib/pipeline/types";
import { parseJson } from "@/lib/pipeline/repository-utils";
import {
  detectEvents,
  applyCooldowns,
  type CooldownState,
} from "@/lib/telegram/detector";
import { formatAlerts } from "@/lib/telegram/formatter";
import { sendMessages } from "@/lib/telegram/client";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface NotifyRouteDeps {
  signalSnapshotRepository?: SignalSnapshotRepository;
  now?: () => number;
}

export function buildNotifyRouteHandler(deps: NotifyRouteDeps = {}) {
  const signalSnapshotRepository =
    deps.signalSnapshotRepository ?? new RedisSignalSnapshotRepository();
  const now = deps.now ?? Date.now;

  return async function GET(request: NextRequest) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check that Telegram is configured
    if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHANNEL_ID) {
      return Response.json(
        { error: "Telegram not configured" },
        { status: 503 }
      );
    }

    try {
      const redis = getRedis();

      // Load current served snapshot
      const current = await signalSnapshotRepository.loadServed();
      if (!current) {
        return Response.json({ ok: true, skipped: "no_snapshot" });
      }

      // Load previous state and cooldowns
      const [previousRaw, cooldownsRaw] = await Promise.all([
        redis.get<string>(KEYS.NOTIFY_LAST_STATE),
        redis.get<string>(KEYS.NOTIFY_COOLDOWNS),
      ]);

      const previous = parseJson<ServedSignalSnapshot | null>(previousRaw, null);
      const cooldowns = parseJson<CooldownState>(cooldownsRaw, {});

      // Detect events
      const currentTime = now();
      const events = detectEvents(current, previous, cooldowns, currentTime);

      if (events.length === 0) {
        return Response.json({
          ok: true,
          events: 0,
          signals: current.signals.length,
        });
      }

      // Cap at 5 alerts per cycle to avoid spam
      const toSend = events.slice(0, 5);

      // Format and send
      const messages = formatAlerts(toSend).map((text) => ({ text }));
      const results = await sendMessages(messages);
      const sent = results.filter((r) => r.ok).length;

      // Update state
      const updatedCooldowns = applyCooldowns(cooldowns, toSend, currentTime);
      await Promise.all([
        redis.set(KEYS.NOTIFY_LAST_STATE, JSON.stringify(current)),
        redis.set(KEYS.NOTIFY_COOLDOWNS, JSON.stringify(updatedCooldowns)),
      ]);

      return Response.json({
        ok: true,
        events: events.length,
        sent,
        coins: toSend.map((e) => e.signal.coin),
      });
    } catch (error) {
      console.error("[Notify]", error);
      return Response.json(
        { error: (error as Error).message },
        { status: 500 }
      );
    }
  };
}

export const GET = buildNotifyRouteHandler();
