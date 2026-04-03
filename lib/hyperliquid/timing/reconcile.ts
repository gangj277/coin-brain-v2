import type { Fill } from "../types";
import type {
  ResolveCurrentPositionTimingParams,
  ResolvedCurrentPositionTiming,
} from "./types";

function approxEqual(a: number, b: number) {
  const diff = Math.abs(a - b);
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return diff <= scale * 1e-6 || diff < 1e-8;
}

function fillDelta(fill: Fill) {
  const size = parseFloat(fill.sz);
  if (fill.dir === "Open Long" || fill.dir === "Close Short") return size;
  if (fill.dir === "Open Short" || fill.dir === "Close Long") return -size;
  return 0;
}

export function resolveCurrentPositionTiming({
  currentSzi,
  fills,
}: ResolveCurrentPositionTimingParams): ResolvedCurrentPositionTiming {
  if (approxEqual(currentSzi, 0)) {
    return { openedAt: null, lastAddedAt: null, complete: true };
  }

  const direction = Math.sign(currentSzi);
  // Sort oldest first to find the earliest same-direction fill
  const ordered = [...fills].sort((a, b) => a.time - b.time);

  let openedAt: number | null = null;
  let lastAddedAt: number | null = null;

  for (const fill of ordered) {
    const delta = fillDelta(fill);
    // Same direction as current position = this fill contributed to the position
    const sameDirection = Math.sign(delta) === direction;

    if (sameDirection) {
      // Latest same-direction fill = lastAddedAt
      lastAddedAt = fill.time;
    }
  }

  // If we found a zero-crossing (position went from opposite/zero to current direction),
  // that's a more accurate openedAt
  const chronological = [...fills].sort((a, b) => a.time - b.time);
  let runningPosition = 0;
  // Try to find the most recent time position crossed zero into current direction
  for (const fill of chronological) {
    const start = parseFloat(fill.startPosition);
    const delta = fillDelta(fill);
    const end = start + delta;
    const startDir = Math.sign(start);
    const endDir = Math.sign(end);

    if (endDir === direction && (startDir === 0 || startDir !== direction)) {
      // This fill flipped the position into the current direction
      openedAt = fill.time;
    }
    runningPosition = end;
  }

  return {
    openedAt,
    lastAddedAt,
    complete: openedAt !== null,
  };
}
