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
  const servedRaw = await redis.get("signals:served:latest");
  const served = parseJson<any>(servedRaw, null);

  console.log("Top-level keys in served snapshot:", Object.keys(served ?? {}));

  const sig = served?.signals?.[0];
  if (sig) {
    console.log("\nKeys in first signal:", Object.keys(sig));
    console.log("\nFull first signal (truncated positions):");
    const display = { ...sig, positions: `[${sig.positions?.length ?? 0} positions]` };
    console.log(JSON.stringify(display, null, 2));
  }

  const baseRaw = await redis.get("signals:base:latest");
  const base = parseJson<any>(baseRaw, null);
  if (base?.signals?.[0]) {
    console.log("\n\n=== BASE SIGNAL (pre-LLM) ===");
    console.log("Keys:", Object.keys(base.signals[0]));
  }

  const cooldownsRaw = await redis.get("notify:cooldowns");
  console.log("\n\n=== Raw cooldowns sample ===");
  const cooldowns = parseJson<Record<string, number>>(cooldownsRaw, {});
  const entries = Object.entries(cooldowns).slice(0, 5);
  console.log(JSON.stringify(entries, null, 2));

  // SMI check
  const smiRaw = await redis.get("smi:all:latest");
  const smi = parseJson<any>(smiRaw, null);
  console.log("\n\n=== SMI all:latest ===");
  if (smi) {
    console.log("Keys:", Object.keys(smi).slice(0, 20));
    if (Array.isArray(smi)) {
      console.log("Array length:", smi.length);
      console.log("First entry:", JSON.stringify(smi[0], null, 2));
    } else {
      console.log("Sample:", JSON.stringify(smi, null, 2).slice(0, 1500));
    }
  } else {
    console.log("EMPTY — SMI not being persisted");
  }

  // Check SMI history for one coin
  const smiBtcRaw = await redis.get("smi:BTC:history");
  const smiBtc = parseJson<any[]>(smiBtcRaw, []);
  console.log(`\nSMI BTC history length: ${smiBtc.length}`);
  if (smiBtc.length > 0) {
    console.log("Last entry:", JSON.stringify(smiBtc[smiBtc.length - 1]));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
