import fs from "node:fs/promises";
import path from "node:path";

import type { BaseSignalSnapshot } from "@/lib/pipeline/types";
import { RedisSignalSnapshotRepository } from "@/lib/pipeline/signal-snapshot-repository";

function parseArgs(argv: string[]) {
  return Object.fromEntries(
    argv
      .filter((arg) => arg.startsWith("--"))
      .map((arg) => {
        const [key, value] = arg.slice(2).split("=", 2);
        return [key, value ?? "true"];
      })
  ) as Record<string, string>;
}

function legacyScore(signal: BaseSignalSnapshot["signals"][number]) {
  const legacy = signal.scoring?.legacy;
  if (!legacy) return 0;
  const strengthOrder = { strong: 3, moderate: 2, weak: 1 };
  return (
    strengthOrder[legacy.strength] * 1000 +
    legacy.conviction +
    (signal.totalValueUsd >= 10_000_000
      ? 30
      : signal.totalValueUsd >= 1_000_000
        ? 20
        : signal.totalValueUsd >= 100_000
          ? 10
          : 0)
  );
}

function v2Score(signal: BaseSignalSnapshot["signals"][number]) {
  const v2 = signal.scoring?.v2;
  if (!v2) return 0;
  const strengthOrder = { strong: 3, moderate: 2, weak: 1 };
  return (
    strengthOrder[v2.strength] * 1000 +
    v2.conviction +
    v2.velocity.score / 10 +
    (signal.totalValueUsd >= 10_000_000
      ? 30
      : signal.totalValueUsd >= 1_000_000
        ? 20
        : signal.totalValueUsd >= 100_000
          ? 10
          : 0)
  );
}

async function loadSnapshot(snapshotPath?: string) {
  if (snapshotPath) {
    const absolutePath = path.resolve(snapshotPath);
    const raw = await fs.readFile(absolutePath, "utf8");
    return JSON.parse(raw) as BaseSignalSnapshot;
  }

  const repository = new RedisSignalSnapshotRepository();
  const snapshot = await repository.loadBase();
  if (!snapshot) {
    throw new Error("No base snapshot available in Redis and no --snapshot file was provided.");
  }
  return snapshot;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const snapshot = await loadSnapshot(args.snapshot);

  const legacyRanked = [...snapshot.signals]
    .sort((left, right) => legacyScore(right) - legacyScore(left))
    .map((signal, index) => ({ signal, index: index + 1 }));
  const v2Ranked = [...snapshot.signals]
    .sort((left, right) => v2Score(right) - v2Score(left))
    .map((signal, index) => ({ signal, index: index + 1 }));

  const legacyByCoin = new Map(legacyRanked.map((entry) => [entry.signal.coin, entry]));
  const v2ByCoin = new Map(v2Ranked.map((entry) => [entry.signal.coin, entry]));

  const rows = snapshot.signals.map((signal) => {
    const legacy = signal.scoring?.legacy;
    const v2 = signal.scoring?.v2;
    return {
      coin: signal.coin,
      legacyRank: legacyByCoin.get(signal.coin)?.index ?? 0,
      v2Rank: v2ByCoin.get(signal.coin)?.index ?? 0,
      legacyDirection: legacy?.dominantSide ?? "N/A",
      v2Direction: v2?.dominantSide ?? "N/A",
      legacyStrength: legacy?.strength ?? "N/A",
      v2Strength: v2?.strength ?? "N/A",
      alignmentBand: v2?.alignmentBand ?? "N/A",
      smi: signal.smi?.smi ?? 0,
    };
  });

  console.log(`Replay snapshot timestamp: ${new Date(snapshot.timestamp).toISOString()}`);
  console.log(`Signals: ${snapshot.signals.length}`);
  console.log("");
  console.table(rows);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
