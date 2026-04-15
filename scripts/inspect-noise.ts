import { readFileSync } from "node:fs";
import { Redis } from "@upstash/redis";

// Load .env.local manually
try {
  const envFile = readFileSync(".env.local", "utf-8");
  for (const line of envFile.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) {
      const [, key, val] = m;
      if (!process.env[key!]) {
        process.env[key!] = val!.replace(/^["']|["']$/g, "");
      }
    }
  }
} catch {}

const redis = Redis.fromEnv();

const KEYS = {
  SIGNALS_SERVED: "signals:served:latest",
  SIGNALS_BASE: "signals:base:latest",
  NOTIFY_LAST_STATE: "notify:last-state",
  NOTIFY_COOLDOWNS: "notify:cooldowns",
  SIGNAL_OUTCOMES_STATS: "signals:outcomes:stats",
  SIGNAL_OUTCOMES_PENDING: "signals:outcomes:pending",
  TRADER_UNIVERSE: "traders:universe:active",
};

function parseJson<T>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback;
  if (typeof raw === "object") return raw as T;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

async function main() {
  console.log("=".repeat(80));
  console.log("NOISE INSPECTION REPORT");
  console.log("=".repeat(80));

  // 1. Current served snapshot
  const servedRaw = await redis.get(KEYS.SIGNALS_SERVED);
  const served = parseJson<any>(servedRaw, null);

  if (served) {
    console.log("\n[1] CURRENT SERVED SNAPSHOT");
    console.log(`  timestamp: ${new Date(served.timestamp).toISOString()}`);
    console.log(`  total signals: ${served.signals?.length ?? 0}`);

    const byStrength: Record<string, number> = {};
    const byType: Record<string, number> = {};
    const byBand: Record<string, number> = {};
    const distrib = { traders: [] as number[], conviction: [] as number[], totalValue: [] as number[], sTier: [] as number[] };

    for (const s of served.signals ?? []) {
      byStrength[s.strength] = (byStrength[s.strength] ?? 0) + 1;
      byType[s.type] = (byType[s.type] ?? 0) + 1;
      const band = s.scoring?.v2?.alignmentBand ?? "n/a";
      byBand[band] = (byBand[band] ?? 0) + 1;
      distrib.traders.push(s.totalTraders);
      distrib.conviction.push(s.conviction);
      distrib.totalValue.push(s.totalValueUsd);
      distrib.sTier.push(s.sTierCount);
    }

    console.log(`  by strength: ${JSON.stringify(byStrength)}`);
    console.log(`  by type: ${JSON.stringify(byType)}`);
    console.log(`  by alignment band: ${JSON.stringify(byBand)}`);

    const pct = (arr: number[], p: number) => {
      const sorted = [...arr].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length * p)] ?? 0;
    };
    console.log(`\n  distributions:`);
    console.log(`    totalTraders   p50/p75/p90/max: ${pct(distrib.traders, 0.5)} / ${pct(distrib.traders, 0.75)} / ${pct(distrib.traders, 0.9)} / ${Math.max(...distrib.traders)}`);
    console.log(`    conviction     p50/p75/p90/max: ${pct(distrib.conviction, 0.5)} / ${pct(distrib.conviction, 0.75)} / ${pct(distrib.conviction, 0.9)} / ${Math.max(...distrib.conviction)}`);
    console.log(`    totalValueUsd  p50/p75/p90/max: $${pct(distrib.totalValue, 0.5).toLocaleString()} / $${pct(distrib.totalValue, 0.75).toLocaleString()} / $${pct(distrib.totalValue, 0.9).toLocaleString()} / $${Math.max(...distrib.totalValue).toLocaleString()}`);
    console.log(`    sTierCount     p50/p75/p90/max: ${pct(distrib.sTier, 0.5)} / ${pct(distrib.sTier, 0.75)} / ${pct(distrib.sTier, 0.9)} / ${Math.max(...distrib.sTier)}`);

    // Show top 10 strong/moderate
    const meaningful = (served.signals ?? [])
      .filter((s: any) => s.strength !== "weak")
      .slice(0, 15);

    console.log(`\n  TOP 15 NON-WEAK SIGNALS (in order):`);
    for (const s of meaningful) {
      const v2 = s.scoring?.v2;
      const smi = s.smi;
      console.log(
        `    ${s.coin.padEnd(8)} ${s.strength.padEnd(8)} ${s.type.padEnd(11)} ${s.dominantSide.padEnd(5)} ` +
        `T:${String(s.totalTraders).padStart(2)} S:${s.sTierCount} ` +
        `conv:${String(s.conviction).padStart(3)} ` +
        `$${(s.totalValueUsd / 1e6).toFixed(1)}M ` +
        `vel:${String(v2?.velocity?.score ?? 0).padStart(3)} ` +
        `mAdj:${String(v2?.marketAdjustment ?? 0).padStart(4)} ` +
        `eff:${String(v2?.effectiveTraders?.toFixed?.(1) ?? "n/a").padStart(4)} ` +
        `band:${(v2?.alignmentBand ?? "n/a").padEnd(15)} ` +
        `SMI:${String(smi?.smi ?? 0).padStart(4)} ${smi?.signal ?? "?"} ${smi?.confirmed ? "C" : "-"}`
      );
    }
  }

  // 2. Cooldowns - what fired recently?
  const cooldownsRaw = await redis.get(KEYS.NOTIFY_COOLDOWNS);
  const cooldowns = parseJson<Record<string, number>>(cooldownsRaw, {});

  console.log(`\n[2] RECENT NOTIFICATIONS (from cooldowns)`);
  console.log(`  total entries: ${Object.keys(cooldowns).length}`);
  const now = Date.now();
  const sorted = Object.entries(cooldowns).sort((a, b) => b[1] - a[1]);
  console.log(`  most recent 30:`);
  const eventTypeCounts: Record<string, number> = {};
  const coinCounts: Record<string, number> = {};
  for (const [key, ts] of sorted) {
    const ageMin = ((now - ts) / 60000).toFixed(1);
    const [coin, eventType] = key.split(":");
    eventTypeCounts[eventType ?? "?"] = (eventTypeCounts[eventType ?? "?"] ?? 0) + 1;
    coinCounts[coin ?? "?"] = (coinCounts[coin ?? "?"] ?? 0) + 1;
  }
  for (const [key, ts] of sorted.slice(0, 30)) {
    const ageMin = ((now - ts) / 60000).toFixed(1);
    console.log(`    ${ageMin.padStart(6)}m ago — ${key}`);
  }

  console.log(`\n  notification distribution by event type (last 2h):`);
  for (const [type, count] of Object.entries(eventTypeCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${type.padEnd(20)} ${count}`);
  }

  console.log(`\n  notification distribution by coin (last 2h):`);
  for (const [coin, count] of Object.entries(coinCounts).sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`    ${coin.padEnd(10)} ${count}`);
  }

  // 3. Outcomes if available
  const outcomesStatsRaw = await redis.get(KEYS.SIGNAL_OUTCOMES_STATS);
  const outcomesStats = parseJson<any>(outcomesStatsRaw, null);
  if (outcomesStats) {
    console.log(`\n[3] OUTCOME STATS (post-signal price tracking)`);
    console.log(JSON.stringify(outcomesStats, null, 2).slice(0, 4000));
  } else {
    console.log(`\n[3] OUTCOME STATS: none yet`);
  }

  const pendingRaw = await redis.get(KEYS.SIGNAL_OUTCOMES_PENDING);
  const pending = parseJson<any[]>(pendingRaw, []);
  console.log(`  pending outcome evaluations: ${Array.isArray(pending) ? pending.length : 0}`);

  // 4. Universe stats
  const universeRaw = await redis.get(KEYS.TRADER_UNIVERSE);
  const universe = parseJson<any>(universeRaw, null);
  if (universe) {
    console.log(`\n[4] TRADER UNIVERSE`);
    console.log(`  refreshed: ${new Date(universe.refreshedAt).toISOString()}`);
    console.log(`  total: ${universe.traders?.length ?? 0}`);
    const tierCounts: Record<string, number> = {};
    for (const t of universe.traders ?? []) {
      tierCounts[t.tier] = (tierCounts[t.tier] ?? 0) + 1;
    }
    console.log(`  by tier: ${JSON.stringify(tierCounts)}`);
  }

  // 5. Previous notify state for diff insight
  const prevRaw = await redis.get(KEYS.NOTIFY_LAST_STATE);
  const prev = parseJson<any>(prevRaw, null);
  if (prev && served) {
    console.log(`\n[5] DIFF — current vs notify last-state`);
    const prevCoins = new Set((prev.signals ?? []).filter((s: any) => s.strength !== "weak").map((s: any) => s.coin));
    const currCoins = new Set((served.signals ?? []).filter((s: any) => s.strength !== "weak").map((s: any) => s.coin));
    const newCoins = [...currCoins].filter((c) => !prevCoins.has(c));
    const droppedCoins = [...prevCoins].filter((c) => !currCoins.has(c));
    console.log(`  prev non-weak signals: ${prevCoins.size}`);
    console.log(`  curr non-weak signals: ${currCoins.size}`);
    console.log(`  newly appeared: ${newCoins.join(", ") || "(none)"}`);
    console.log(`  dropped: ${droppedCoins.join(", ") || "(none)"}`);

    // For coins in both, check what changed
    const prevByCoin = new Map((prev.signals ?? []).map((s: any) => [s.coin, s]));
    const churnExamples: string[] = [];
    for (const curr of served.signals ?? []) {
      if (curr.strength === "weak") continue;
      const p = prevByCoin.get(curr.coin) as any;
      if (!p) continue;
      const deltas: string[] = [];
      if (p.totalTraders !== curr.totalTraders) deltas.push(`traders ${p.totalTraders}→${curr.totalTraders}`);
      if (p.sTierCount !== curr.sTierCount) deltas.push(`sTier ${p.sTierCount}→${curr.sTierCount}`);
      if (p.strength !== curr.strength) deltas.push(`strength ${p.strength}→${curr.strength}`);
      if (p.dominantSide !== curr.dominantSide) deltas.push(`side ${p.dominantSide}→${curr.dominantSide}`);
      if (Math.abs((p.conviction ?? 0) - (curr.conviction ?? 0)) >= 5) deltas.push(`conv ${p.conviction}→${curr.conviction}`);
      if (deltas.length > 0) churnExamples.push(`${curr.coin}: ${deltas.join(", ")}`);
    }
    console.log(`  churn (non-trivial changes): ${churnExamples.length}`);
    for (const c of churnExamples.slice(0, 20)) console.log(`    ${c}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
