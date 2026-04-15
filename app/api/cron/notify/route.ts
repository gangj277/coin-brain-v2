import { NextRequest } from "next/server";
import { getRedis, KEYS } from "@/lib/redis/client";
import {
  RedisSignalSnapshotRepository,
  type SignalSnapshotRepository,
} from "@/lib/pipeline/signal-snapshot-repository";
import type { ServedSignalSnapshot } from "@/lib/pipeline/types";
import { parseJson } from "@/lib/pipeline/repository-utils";
import {
  applyCooldowns,
  detectEvents,
  ensureDailyBucket,
  incrementDailyCount,
  updateSideStreaks,
  type CooldownState,
  type DailyAlertStats,
  type SideStreakState,
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

    if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHANNEL_ID) {
      return Response.json(
        { error: "Telegram not configured" },
        { status: 503 }
      );
    }

    try {
      const redis = getRedis();
      const currentTime = now();

      const current = await signalSnapshotRepository.loadServed();
      if (!current) {
        return Response.json({ ok: true, skipped: "no_snapshot" });
      }

      const [previousRaw, cooldownsRaw, sideStreaksRaw, dailyStatsRaw] =
        await Promise.all([
          redis.get<string>(KEYS.NOTIFY_LAST_STATE),
          redis.get<string>(KEYS.NOTIFY_COOLDOWNS),
          redis.get<string>(KEYS.NOTIFY_SIDE_STREAKS),
          redis.get<string>(KEYS.NOTIFY_DAILY_STATS),
        ]);

      const previous = parseJson<ServedSignalSnapshot | null>(previousRaw, null);
      const cooldowns = parseJson<CooldownState>(cooldownsRaw, {});
      const sideStreaks = parseJson<SideStreakState>(sideStreaksRaw, {});
      const dailyStats = ensureDailyBucket(
        parseJson<DailyAlertStats | null>(dailyStatsRaw, null),
        currentTime
      );

      // Update side streaks BEFORE detection (so new streak count is visible)
      const updatedSideStreaks = updateSideStreaks(
        sideStreaks,
        current,
        currentTime
      );

      const events = detectEvents(current, previous, {
        sideStreaks: updatedSideStreaks,
        dailyStats,
        cooldowns,
        now: currentTime,
      });

      // Enforce cap while emitting
      const toSend: typeof events = [];
      let bucket = dailyStats;
      for (const event of events) {
        if (bucket.totalSent >= 5) break;
        if ((bucket.perCoin[event.signal.coin] ?? 0) >= 2) continue;
        toSend.push(event);
        bucket = incrementDailyCount(bucket, event.signal.coin);
      }

      if (toSend.length === 0) {
        // Still persist side streak + last state even when nothing sent
        await Promise.all([
          redis.set(KEYS.NOTIFY_LAST_STATE, JSON.stringify(current)),
          redis.set(
            KEYS.NOTIFY_SIDE_STREAKS,
            JSON.stringify(updatedSideStreaks)
          ),
          redis.set(KEYS.NOTIFY_DAILY_STATS, JSON.stringify(bucket)),
        ]);
        return Response.json({
          ok: true,
          events: events.length,
          sent: 0,
          signals: current.signals.length,
          dailySent: bucket.totalSent,
        });
      }

      const messages = formatAlerts(toSend).map((text) => ({ text }));
      const results = await sendMessages(messages);
      const sent = results.filter((r) => r.ok).length;

      const updatedCooldowns = applyCooldowns(cooldowns, toSend, currentTime);

      await Promise.all([
        redis.set(KEYS.NOTIFY_LAST_STATE, JSON.stringify(current)),
        redis.set(KEYS.NOTIFY_COOLDOWNS, JSON.stringify(updatedCooldowns)),
        redis.set(KEYS.NOTIFY_SIDE_STREAKS, JSON.stringify(updatedSideStreaks)),
        redis.set(KEYS.NOTIFY_DAILY_STATS, JSON.stringify(bucket)),
      ]);

      return Response.json({
        ok: true,
        events: events.length,
        sent,
        coins: toSend.map((e) => e.signal.coin),
        dailySent: bucket.totalSent,
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
