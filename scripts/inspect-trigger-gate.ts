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
  const raw = await redis.get("signals:served:latest");
  const data = parseJson<any>(raw, null);
  if (!data) {
    console.log("no snapshot");
    return;
  }

  const gate = { pass: 0, fail: 0 };
  const byStrength: Record<string, { pass: number; fail: number; total: number }> = {};
  for (const s of data.signals) {
    const trig = s.scoring?.v2?.tradeTrigger;
    if (!trig) continue;
    gate[trig.gate as "pass" | "fail"]++;
    byStrength[s.strength] = byStrength[s.strength] ?? { pass: 0, fail: 0, total: 0 };
    byStrength[s.strength].total++;
    if (trig.gate === "pass") byStrength[s.strength].pass++;
    else byStrength[s.strength].fail++;
  }

  console.log("Trade trigger gate distribution:", gate);
  console.log("By strength:", byStrength);

  const passing = data.signals
    .filter((s: any) => s.scoring?.v2?.tradeTrigger?.gate === "pass")
    .sort(
      (a: any, b: any) =>
        b.scoring.v2.tradeTrigger.score - a.scoring.v2.tradeTrigger.score
    );

  // Also show top 20 by trigger score regardless of gate
  const sorted = [...data.signals]
    .filter((s: any) => s.scoring?.v2?.tradeTrigger)
    .sort(
      (a: any, b: any) =>
        b.scoring.v2.tradeTrigger.score - a.scoring.v2.tradeTrigger.score
    );
  console.log(`\nTop 20 signals by trade trigger score:`);
  for (const s of sorted.slice(0, 20)) {
    const t = s.scoring.v2.tradeTrigger;
    const cs = s.scoring.v2.crossSectional;
    console.log(
      `  ${s.coin.padEnd(8)} ${s.strength.padEnd(8)} ${s.dominantSide.padEnd(5)} ` +
      `T:${String(s.totalTraders).padStart(2)} (L:${s.longTraders} S:${s.shortTraders}) ` +
      `Str:${s.sTierCount} $${(s.totalValueUsd / 1e6).toFixed(1)}M ` +
      `trig:${String(t.score).padStart(5)} [${t.gate}] ` +
      `(core:${t.coreQuality} idio:${t.idiosyncraticAlpha} smi:${t.smiAlignment} vel:${t.velocity}) ` +
      `idio-α:${cs.idiosyncraticAlpha} tilt:${cs.marketTilt} v2total:${s.scoring.v2.totalScore}`
    );
  }
  console.log(`\nSignals passing trade trigger gate: ${passing.length}`);
  for (const s of passing.slice(0, 20)) {
    const t = s.scoring.v2.tradeTrigger;
    const cs = s.scoring.v2.crossSectional;
    console.log(
      `  ${s.coin.padEnd(8)} ${s.strength.padEnd(8)} ${s.dominantSide.padEnd(5)} ` +
      `T:${String(s.totalTraders).padStart(2)} (L:${s.longTraders} S:${s.shortTraders}) ` +
      `S:${s.sTierCount} $${(s.totalValueUsd / 1e6).toFixed(1)}M ` +
      `trig:${String(t.score).padStart(4)} ` +
      `(core:${t.coreQuality} idio:${t.idiosyncraticAlpha} smi:${t.smiAlignment} vel:${t.velocity}) ` +
      `idio-α:${cs.idiosyncraticAlpha}`
    );
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
