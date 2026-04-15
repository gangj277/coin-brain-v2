/**
 * One-shot cleanup: reset pre-v2 notify state so the new detector starts clean.
 * Drops old-format cooldowns (coin-only keys) — new format is coin:eventType.
 */
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

async function main() {
  await Promise.all([
    redis.del("notify:cooldowns"),
    redis.del("notify:side-streaks"),
    redis.del("notify:daily-stats"),
  ]);
  console.log("Cleared notify:cooldowns / notify:side-streaks / notify:daily-stats");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
