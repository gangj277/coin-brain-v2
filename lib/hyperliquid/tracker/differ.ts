import type { ClearinghouseState } from "../types";
import type { PositionChange, PositionSnapshot, TraderTier } from "./types";

function toSnapshot(pos: ClearinghouseState["assetPositions"][number]): PositionSnapshot {
  const p = pos.position;
  return {
    coin: p.coin,
    szi: parseFloat(p.szi),
    entryPx: parseFloat(p.entryPx),
    leverage: p.leverage.value,
    positionValueUsd: parseFloat(p.positionValue),
  };
}

/**
 * Compare two clearinghouse states and return position changes.
 * Returns empty array if states are identical.
 */
export function diffPositions(
  traderAddress: string,
  traderTier: TraderTier,
  prev: ClearinghouseState | null,
  curr: ClearinghouseState
): PositionChange[] {
  const changes: PositionChange[] = [];
  const now = curr.time;

  // Build lookup maps
  const prevMap = new Map<string, PositionSnapshot>();
  const currMap = new Map<string, PositionSnapshot>();

  if (prev) {
    for (const ap of prev.assetPositions) {
      const snap = toSnapshot(ap);
      if (snap.szi !== 0) prevMap.set(snap.coin, snap);
    }
  }
  for (const ap of curr.assetPositions) {
    const snap = toSnapshot(ap);
    if (snap.szi !== 0) currMap.set(snap.coin, snap);
  }

  // Check all coins in current state
  for (const [coin, currSnap] of currMap) {
    const prevSnap = prevMap.get(coin);

    if (!prevSnap) {
      // New position
      changes.push({
        type: "position_opened",
        traderAddress,
        traderTier,
        coin,
        timestamp: now,
        previous: null,
        current: currSnap,
      });
    } else {
      // Position exists in both — check for changes
      const prevSign = Math.sign(prevSnap.szi);
      const currSign = Math.sign(currSnap.szi);

      if (prevSign !== currSign) {
        // Direction flipped (long→short or short→long)
        changes.push({
          type: "position_flipped",
          traderAddress,
          traderTier,
          coin,
          timestamp: now,
          previous: prevSnap,
          current: currSnap,
        });
      } else if (Math.abs(currSnap.szi) > Math.abs(prevSnap.szi)) {
        changes.push({
          type: "position_increased",
          traderAddress,
          traderTier,
          coin,
          timestamp: now,
          previous: prevSnap,
          current: currSnap,
        });
      } else if (Math.abs(currSnap.szi) < Math.abs(prevSnap.szi)) {
        changes.push({
          type: "position_decreased",
          traderAddress,
          traderTier,
          coin,
          timestamp: now,
          previous: prevSnap,
          current: currSnap,
        });
      }
      // If size identical, skip (entry price / leverage changes ignored for now)
    }
  }

  // Check for closed positions (in prev but not in curr)
  for (const [coin, prevSnap] of prevMap) {
    if (!currMap.has(coin)) {
      changes.push({
        type: "position_closed",
        traderAddress,
        traderTier,
        coin,
        timestamp: now,
        previous: prevSnap,
        current: null,
      });
    }
  }

  return changes;
}
