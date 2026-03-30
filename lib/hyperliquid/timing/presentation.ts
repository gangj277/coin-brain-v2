import type { PositionTimingConfidence } from "./types";

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface MarkerPosition {
  address: string;
  tier: string;
  side: "LONG" | "SHORT";
  entryPx: number;
  sizeUsd: number;
  leverage: number;
  unrealizedPnl: number;
  openedAt: number | null;
  timingConfidence: PositionTimingConfidence;
}

interface BuiltMarker {
  id: string;
  time: number;
  position: "belowBar" | "aboveBar";
  color: string;
  shape: "arrowUp" | "arrowDown" | "circle";
  size: number;
  text: string;
}

function findCandleByPrice(candles: Candle[], price: number): number {
  // Search from newest to oldest — prefer the most recent candle that contains this price
  let bestIdx = candles.length - 1;
  let bestDist = Infinity;
  for (let i = candles.length - 1; i >= 0; i--) {
    const candle = candles[i];
    if (price >= candle.low && price <= candle.high) return i;
    const dist = Math.min(
      Math.abs(price - candle.high),
      Math.abs(price - candle.low)
    );
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function fmtUsd(n: number) {
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}k`;
  return `$${n.toFixed(0)}`;
}

function formatTimestamp(timestamp: number) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function toRgba(color: string, alpha: number) {
  if (color.startsWith("rgba(")) {
    const parts = color.slice(5, -1).split(",").map((part) => part.trim());
    return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
  }

  if (color.startsWith("rgb(")) {
    const parts = color.slice(4, -1).split(",").map((part) => part.trim());
    return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
  }

  if (color.startsWith("#")) {
    const hex = color.slice(1);
    const normalized = hex.length === 3
      ? hex.split("").map((char) => `${char}${char}`).join("")
      : hex;
    const r = parseInt(normalized.slice(0, 2), 16);
    const g = parseInt(normalized.slice(2, 4), 16);
    const b = parseInt(normalized.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  return color;
}

export function getEntryMarkerKey(position: Pick<MarkerPosition, "address" | "side" | "entryPx">) {
  return `${position.address.toLowerCase()}:${position.side}:${position.entryPx}`;
}

function baseMarkerStyle(position: MarkerPosition) {
  const isS = position.tier === "S";
  const isA = position.tier === "A";
  const isLong = position.side === "LONG";

  if (isS) {
    return {
      color: "#fbbf24",
      shape: isLong ? ("arrowUp" as const) : ("arrowDown" as const),
      size: 2,
      text: `★ ${fmtUsd(position.sizeUsd)} ${position.leverage}×`,
    };
  }

  if (isA) {
    return {
      color: isLong ? "#34d399" : "#f87171",
      shape: isLong ? ("arrowUp" as const) : ("arrowDown" as const),
      size: 1,
      text: `${fmtUsd(position.sizeUsd)}`,
    };
  }

  return {
    color: isLong ? "rgba(52,211,153,0.5)" : "rgba(248,113,113,0.5)",
    shape: "circle" as const,
    size: 0,
    text: "",
  };
}

function markerStyle(
  position: MarkerPosition,
  selectedEntryKey?: string | null
) {
  const base = baseMarkerStyle(position);
  const hasSelection = selectedEntryKey != null;
  const isSelected =
    hasSelection && getEntryMarkerKey(position) === selectedEntryKey;

  if (!hasSelection) return base;

  if (isSelected) {
    return {
      ...base,
      color: toRgba(base.color, 1),
      size: Math.min(base.size + 1, 4),
      text: base.text ? `◉ ${base.text}` : "◉",
    };
  }

  return {
    ...base,
    color: toRgba(base.color, position.tier === "S" ? 0.3 : 0.2),
    text: "",
  };
}

export function buildEntryMarkers({
  candles,
  positions,
  selectedEntryKey,
}: {
  candles: Candle[];
  positions: MarkerPosition[];
  selectedEntryKey?: string | null;
}): BuiltMarker[] {
  if (candles.length === 0) return [];

  const firstTime = candles[0].time;
  const lastTime = candles[candles.length - 1].time;
  const markers: BuiltMarker[] = [];

  for (const position of positions) {
    let bestIndex = 0;

    if (position.openedAt !== null && position.timingConfidence === "high") {
      const targetTime = Math.floor(position.openedAt / 1000);
      if (targetTime >= firstTime && targetTime <= lastTime) {
        let bestDistance = Infinity;
        for (let index = 0; index < candles.length; index++) {
          const distance = Math.abs(candles[index].time - targetTime);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = index;
          }
        }
      } else {
        bestIndex = findCandleByPrice(candles, position.entryPx);
      }
    } else {
      bestIndex = findCandleByPrice(candles, position.entryPx);
    }

    const style = markerStyle(position, selectedEntryKey);
    markers.push({
      id: getEntryMarkerKey(position),
      time: candles[bestIndex].time,
      position: position.side === "LONG" ? "belowBar" : "aboveBar",
      ...style,
    });
  }

  return markers.sort((a, b) => a.time - b.time);
}

export function formatPositionTiming({
  openedAt,
  lastAddedAt,
  observedAt,
  timingConfidence,
  preexisting,
}: {
  openedAt: number | null;
  lastAddedAt: number | null;
  observedAt: number | null;
  timingConfidence: PositionTimingConfidence;
  preexisting: boolean;
}) {
  const exactPrefix = timingConfidence === "high" ? "" : "~ ";

  if (openedAt !== null) {
    return {
      primary: `${exactPrefix}최초 진입 ${formatTimestamp(openedAt)}`,
      secondary:
        lastAddedAt !== null && lastAddedAt !== openedAt
          ? `${exactPrefix}최근 추가 ${formatTimestamp(lastAddedAt)}`
          : null,
    };
  }

  if (preexisting) {
    return {
      primary: "추적 시작 전부터 보유 (pre-existing)",
      secondary:
        observedAt !== null
          ? `추적 시작 ${formatTimestamp(observedAt)} (tracked since)`
          : null,
    };
  }

  if (observedAt !== null) {
    return {
      primary: `관측 시작 ${formatTimestamp(observedAt)} (tracked since)`,
      secondary:
        lastAddedAt !== null
          ? `최근 추가 ${formatTimestamp(lastAddedAt)}`
          : null,
    };
  }

  return {
    primary: "진입 시점 미확인",
    secondary: null,
  };
}
