import { diffPositions } from "../tracker/differ";
import type { TraderTier } from "../tracker/types";
import type { ClearinghouseState } from "../types";
import type {
  PositionBackfillStrategy,
  PositionBackfillTask,
  PositionTimingRecord,
  PositionTimingState,
  ResolvedCurrentPositionTiming,
} from "./types";

const BOOTSTRAP_BACKFILL_TIERS = new Set<TraderTier>(["S", "A"]);

function normalizeAddress(address: string) {
  return address.toLowerCase();
}

function normalizeCoin(coin: string) {
  return coin.toUpperCase();
}

export function getPositionTimingKey(address: string, coin: string) {
  return `${normalizeAddress(address)}:${normalizeCoin(coin)}`;
}

export function createEmptyTimingState(
  initial?: Partial<PositionTimingState>
): PositionTimingState {
  return {
    snapshots: initial?.snapshots ?? {},
    records: initial?.records ?? {},
    queue: initial?.queue ?? [],
  };
}

function removeTasksForPosition(
  timingState: PositionTimingState,
  positionKey: string
) {
  timingState.queue = timingState.queue.filter(
    (task) => task.positionKey !== positionKey
  );
}

export function removeBackfillTask(
  timingState: PositionTimingState,
  task: PositionBackfillTask
) {
  timingState.queue = timingState.queue.filter(
    (queued) =>
      !(
        queued.positionKey === task.positionKey &&
        queued.strategy === task.strategy &&
        queued.enqueuedAt === task.enqueuedAt
      )
  );
}

function enqueueBackfillTask(
  timingState: PositionTimingState,
  task: PositionBackfillTask
) {
  removeTasksForPosition(timingState, task.positionKey);
  if (task.strategy === "incremental") {
    timingState.queue.unshift(task);
    return;
  }
  timingState.queue.push(task);
}

function makeRecord(
  address: string,
  coin: string,
  observedAt: number,
  source: PositionTimingRecord["timingSource"],
  confidence: PositionTimingRecord["timingConfidence"],
  preexisting: boolean,
  backfillStatus: PositionTimingRecord["backfillStatus"]
): PositionTimingRecord {
  return {
    address: normalizeAddress(address),
    coin: normalizeCoin(coin),
    openedAt: null,
    lastAddedAt: null,
    lastChangedAt: observedAt,
    observedAt,
    timingSource: source,
    timingConfidence: confidence,
    preexisting,
    backfillStatus,
  };
}

function createTask(
  positionKey: string,
  address: string,
  coin: string,
  strategy: PositionBackfillStrategy,
  traderTier: TraderTier,
  enqueuedAt: number,
  startTime?: number,
  endTime?: number
): PositionBackfillTask {
  return {
    positionKey,
    address: normalizeAddress(address),
    coin: normalizeCoin(coin),
    strategy,
    startTime,
    endTime,
    enqueuedAt,
    traderTier,
  };
}

function maybeBootstrapRecord(
  timingState: PositionTimingState,
  address: string,
  tier: TraderTier,
  currentState: ClearinghouseState
) {
  for (const assetPosition of currentState.assetPositions) {
    const szi = parseFloat(assetPosition.position.szi);
    if (szi === 0) continue;

    const coin = assetPosition.position.coin;
    const positionKey = getPositionTimingKey(address, coin);
    const shouldBackfill = BOOTSTRAP_BACKFILL_TIERS.has(tier);
    const record =
      timingState.records[positionKey] ??
      makeRecord(
        address,
        coin,
        currentState.time,
        "bootstrap",
        "low",
        true,
        shouldBackfill ? "pending" : "exhausted"
      );

    record.observedAt = currentState.time;
    record.lastChangedAt = currentState.time;
    record.preexisting = true;
    record.timingSource = "bootstrap";
    record.timingConfidence = "low";
    record.backfillStatus = shouldBackfill ? "pending" : "exhausted";
    timingState.records[positionKey] = record;

    if (shouldBackfill) {
      enqueueBackfillTask(
        timingState,
        createTask(positionKey, address, coin, "1d", tier, currentState.time)
      );
    } else {
      removeTasksForPosition(timingState, positionKey);
    }
  }
}

function nextStrategy(
  strategy: PositionBackfillTask["strategy"]
): PositionBackfillTask["strategy"] | null {
  if (strategy === "incremental") return "1d";
  if (strategy === "1d") return "7d";
  if (strategy === "7d") return "30d";
  return null;
}

function ensureRecord(
  timingState: PositionTimingState,
  address: string,
  coin: string,
  observedAt: number
) {
  const positionKey = getPositionTimingKey(address, coin);
  if (!timingState.records[positionKey]) {
    timingState.records[positionKey] = makeRecord(
      address,
      coin,
      observedAt,
      "bootstrap",
      "low",
      true,
      "exhausted"
    );
  }
  return timingState.records[positionKey];
}

export function syncPositionTimingForTrader({
  address,
  tier,
  prevState,
  currentState,
  timingState,
}: {
  address: string;
  tier: TraderTier;
  prevState: ClearinghouseState | null;
  currentState: ClearinghouseState;
  timingState: PositionTimingState;
}) {
  const normalizedAddress = normalizeAddress(address);
  timingState.snapshots[normalizedAddress] = currentState;

  if (!prevState) {
    maybeBootstrapRecord(timingState, normalizedAddress, tier, currentState);
    return;
  }

  const changes = diffPositions(normalizedAddress, tier, prevState, currentState);

  for (const change of changes) {
    const positionKey = getPositionTimingKey(normalizedAddress, change.coin);

    if (change.type === "position_closed") {
      delete timingState.records[positionKey];
      removeTasksForPosition(timingState, positionKey);
      continue;
    }

    if (change.type === "position_opened" || change.type === "position_flipped") {
      const record = makeRecord(
        normalizedAddress,
        change.coin,
        change.timestamp,
        "diff",
        "medium",
        false,
        "pending"
      );
      record.lastAddedAt = change.timestamp;
      timingState.records[positionKey] = record;
      enqueueBackfillTask(
        timingState,
        createTask(
          positionKey,
          normalizedAddress,
          change.coin,
          "incremental",
          tier,
          change.timestamp,
          prevState.time,
          currentState.time
        )
      );
      continue;
    }

    const record = ensureRecord(
      timingState,
      normalizedAddress,
      change.coin,
      currentState.time
    );
    record.lastChangedAt = change.timestamp;

    if (change.type === "position_increased") {
      record.lastAddedAt = change.timestamp;
      record.preexisting = false;
      if (!record.openedAt) {
        record.timingSource = "diff";
        record.timingConfidence = "medium";
      }
      record.backfillStatus = "pending";
      enqueueBackfillTask(
        timingState,
        createTask(
          positionKey,
          normalizedAddress,
          change.coin,
          "incremental",
          tier,
          change.timestamp,
          prevState.time,
          currentState.time
        )
      );
    }
  }

  const currentKeys = new Set(
    currentState.assetPositions
      .filter((assetPosition) => parseFloat(assetPosition.position.szi) !== 0)
      .map((assetPosition) =>
        getPositionTimingKey(normalizedAddress, assetPosition.position.coin)
      )
  );

  for (const recordKey of Object.keys(timingState.records)) {
    if (
      recordKey.startsWith(`${normalizedAddress}:`) &&
      !currentKeys.has(recordKey)
    ) {
      delete timingState.records[recordKey];
      removeTasksForPosition(timingState, recordKey);
    }
  }
}

export function applyBackfillResult({
  timingState,
  task,
  result,
  now = Date.now(),
}: {
  timingState: PositionTimingState;
  task: PositionBackfillTask;
  result: ResolvedCurrentPositionTiming;
  now?: number;
}) {
  removeBackfillTask(timingState, task);
  const record = timingState.records[task.positionKey];
  if (!record) return;

  if (result.lastAddedAt !== null) {
    record.lastAddedAt = result.lastAddedAt;
    record.timingSource = "fills";
    record.timingConfidence = result.openedAt !== null ? "high" : "medium";
  }

  if (result.openedAt !== null) {
    record.openedAt = result.openedAt;
    record.timingSource = "fills";
    record.timingConfidence = "high";
    record.backfillStatus = "done";
    return;
  }

  if (result.complete) {
    record.backfillStatus = "done";
    return;
  }

  const strategy = nextStrategy(task.strategy);
  if (!strategy) {
    record.backfillStatus = "exhausted";
    return;
  }

  record.backfillStatus = "pending";
  enqueueBackfillTask(
    timingState,
    createTask(
      task.positionKey,
      task.address,
      task.coin,
      strategy,
      task.traderTier,
      now
    )
  );
}
