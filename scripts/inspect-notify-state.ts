import { readFileSync } from "node:fs";
import { Redis } from "@upstash/redis";

try {
  const envFile = readFileSync(".env.local", "utf-8");
  for (const line of envFile.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) {
      const [, key, val] = m;
      if (!process.env[key!]) process.env[key!] = val!.replace(/^["']|["']$/g, "");
    }
  }
} catch {}

const redis = Redis.fromEnv();

function parseJson<T>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback;
  if (typeof raw === "object") return raw as T;
  if (typeof raw === "string") {
    try { return JSON.parse(raw) as T; } catch { return fallback; }
  }
  return fallback;
}

async function main() {
  const [cooldowns, daily, streaks] = await Promise.all([
    redis.get("notify:cooldowns").then((r) => parseJson<Record<string, number>>(r, {})),
    redis.get("notify:daily-stats").then((r) => parseJson<any>(r, null)),
    redis.get("notify:side-streaks").then((r) => parseJson<Record<string, any>>(r, {})),
  ]);

  console.log("=== notify:daily-stats ===");
  console.log(JSON.stringify(daily, null, 2));
  console.log("\n=== notify:cooldowns (recent, v2 format only) ===");
  const now = Date.now();
  const entries = Object.entries(cooldowns).sort((a, b) => b[1] - a[1]);
  for (const [key, ts] of entries.slice(0, 15)) {
    const ageMin = ((now - ts) / 60000).toFixed(1);
    console.log(`  ${ageMin.padStart(6)}m ago — ${key}`);
  }
  console.log(`\n  total cooldowns: ${entries.length}`);

  console.log("\n=== notify:side-streaks (top 20 by streak count) ===");
  const streakEntries = Object.entries(streaks).sort(
    (a: any, b: any) => (b[1].count ?? 0) - (a[1].count ?? 0)
  );
  for (const [coin, entry] of streakEntries.slice(0, 20)) {
    console.log(`  ${coin.padEnd(10)} ${(entry as any).side} × ${(entry as any).count}`);
  }
  console.log(`  total tracked: ${streakEntries.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
