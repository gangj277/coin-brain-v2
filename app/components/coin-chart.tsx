"use client";

import { useEffect, useRef, useState } from "react";
import { createChart, createSeriesMarkers, CandlestickSeries, type IChartApi, type ISeriesApi, type ISeriesMarkersPluginApi, type SeriesMarker, type Time, ColorType, CrosshairMode } from "lightweight-charts";
import { buildEntryMarkers, getEntryMarkerKey } from "@/lib/hyperliquid/timing/presentation";
import type { PositionTimingConfidence } from "@/lib/hyperliquid/timing/types";
import { traderName } from "@/lib/trader-name";

interface TraderMarker {
  address: string;
  tier: string;
  side: "LONG" | "SHORT";
  entryPx: number;
  sizeUsd: number;
  leverage: number;
  unrealizedPnl: number;
  returnOnEquity: number;
  liquidationPx: number | null;
  openedAt: number | null;
  timingConfidence: PositionTimingConfidence;
}

interface CoinChartProps {
  coin: string;
  positions: TraderMarker[];
  markPx?: number;
}

const MN = "font-[family-name:var(--font-geist-mono)]";

function fmt(n: number) {
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}k`;
  return `$${n.toFixed(0)}`;
}
function fmtPnl(n: number) { return `${n >= 0 ? "+" : ""}${fmt(n)}`; }

// Map sizeUsd to lineWidth 1-4
function sizeToWidth(sizeUsd: number): 1 | 2 | 3 | 4 {
  if (sizeUsd >= 5_000_000) return 4;
  if (sizeUsd >= 1_000_000) return 3;
  if (sizeUsd >= 100_000) return 2;
  return 1;
}

export default function CoinChart({ coin, positions, markPx }: CoinChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const candlesRef = useRef<{ time: number; open: number; high: number; low: number; close: number }[]>([]);
  const baseLinesRef = useRef<ReturnType<ISeriesApi<"Candlestick">["createPriceLine"]>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [candlesVersion, setCandlesVersion] = useState(0);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [selectedEntryKey, setSelectedEntryKey] = useState<string | null>(null);
  const highlightLinesRef = useRef<ReturnType<ISeriesApi<"Candlestick">["createPriceLine"]>[]>([]);
  const [interval, setInterval] = useState<"15m" | "30m" | "1h" | "4h">("4h");

  const topBySize = [...positions].sort((a, b) => b.sizeUsd - a.sizeUsd).slice(0, 15);
  const markersSignature = topBySize
    .map((position) => [
      getEntryMarkerKey(position),
      position.sizeUsd,
      position.entryPx,
      position.leverage,
      position.unrealizedPnl,
      position.returnOnEquity,
      position.liquidationPx ?? "none",
      position.openedAt ?? "na",
      position.timingConfidence,
    ].join(":"))
    .join("|");
  const longCount = positions.filter(p => p.side === "LONG").length;
  const shortCount = positions.filter(p => p.side === "SHORT").length;
  const selectedPosition = selectedEntryKey
    ? topBySize.find((position) => getEntryMarkerKey(position) === selectedEntryKey) ?? null
    : null;

  function clearLines(
    series: ISeriesApi<"Candlestick">,
    linesRef: typeof baseLinesRef | typeof highlightLinesRef
  ) {
    for (const line of linesRef.current) {
      series.removePriceLine(line);
    }
    linesRef.current = [];
  }

  function syncMarkers(series: ISeriesApi<"Candlestick">) {
    const markers = buildEntryMarkers({
      candles: candlesRef.current,
      positions: topBySize,
      selectedEntryKey,
    }).map((marker) => ({
      ...marker,
      time: marker.time as Time,
    })) as SeriesMarker<Time>[];

    if (!markersPluginRef.current) {
      markersPluginRef.current = createSeriesMarkers(series, markers);
      return;
    }

    markersPluginRef.current.setMarkers(markers);
  }

  function syncBaseLines(series: ISeriesApi<"Candlestick">) {
    clearLines(series, baseLinesRef);

    for (const position of topBySize) {
      const width = sizeToWidth(position.sizeUsd);
      const opacity = position.tier === "S" ? 0.8 : position.tier === "A" ? 0.5 : 0.3;
      baseLinesRef.current.push(series.createPriceLine({
        price: position.entryPx,
        color: position.side === "LONG" ? `rgba(52,211,153,${opacity})` : `rgba(248,113,113,${opacity})`,
        lineWidth: width,
        lineStyle: position.tier === "S" ? 0 : 2,
        axisLabelVisible: true,
        title: `[${position.tier}] ${position.side === "LONG" ? "롱" : "숏"} ${fmt(position.sizeUsd)} ${position.leverage}배`,
      }));
    }

    if (markPx) {
      baseLinesRef.current.push(series.createPriceLine({
        price: markPx,
        color: "rgba(34,211,238,0.5)",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "현재가",
      }));
    }
  }

  function syncHighlightLines(series: ISeriesApi<"Candlestick">) {
    clearLines(series, highlightLinesRef);
    if (!selectedPosition) return;

    const isLong = selectedPosition.side === "LONG";
    const color = isLong ? "rgba(52,211,153,0.6)" : "rgba(248,113,113,0.6)";
    const roe = selectedPosition.unrealizedPnl >= 0 ? "+" : "";

    highlightLinesRef.current.push(series.createPriceLine({
      price: selectedPosition.entryPx,
      color,
      lineWidth: 2,
      lineStyle: 0,
      axisLabelVisible: true,
      title: `진입 $${selectedPosition.entryPx.toLocaleString(undefined, { maximumFractionDigits: 4 })}`,
    }));

    if (markPx) {
      highlightLinesRef.current.push(series.createPriceLine({
        price: markPx,
        color: selectedPosition.unrealizedPnl >= 0 ? "rgba(52,211,153,0.4)" : "rgba(248,113,113,0.4)",
        lineWidth: 1,
        lineStyle: 1,
        axisLabelVisible: true,
        title: `${roe}${fmt(selectedPosition.unrealizedPnl)} (${(selectedPosition.returnOnEquity * 100).toFixed(0)}%)`,
      }));
    }

    if (selectedPosition.liquidationPx != null) {
      highlightLinesRef.current.push(series.createPriceLine({
        price: selectedPosition.liquidationPx,
        color: "rgba(248,113,113,0.3)",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: `청산 $${selectedPosition.liquidationPx.toLocaleString(undefined, { maximumFractionDigits: 1 })}`,
      }));
    }
  }

  function toggleSelectedPosition(position: TraderMarker) {
    const entryKey = getEntryMarkerKey(position);
    const isSameSelection = selectedEntryKey === entryKey;
    setSelectedEntryKey(isSameSelection ? null : entryKey);

    if (!isSameSelection) {
      scrollToPrice(position.entryPx);
    }
  }

  // Find the candle whose range contains (or is nearest to) a given price, then scroll there
  function scrollToPrice(price: number) {
    if (!seriesRef.current || !chartRef.current || candlesRef.current.length === 0) return;
    const candles = candlesRef.current;

    // Find candle that contains this price, or nearest
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      if (price >= c.low && price <= c.high) {
        bestIdx = i;
        bestDist = 0;
        break;
      }
      const dist = Math.min(Math.abs(price - c.high), Math.abs(price - c.low));
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }

    // Show a range of ~20 candles centered on the found candle
    const halfRange = 10;
    const from = Math.max(0, bestIdx - halfRange);
    const to = Math.min(candles.length - 1, bestIdx + halfRange);

    chartRef.current.timeScale().setVisibleRange({
      from: candles[from].time as unknown as import("lightweight-charts").Time,
      to: candles[to].time as unknown as import("lightweight-charts").Time,
    });

    // Set crosshair to the price
    if (seriesRef.current) {
      chartRef.current.setCrosshairPosition(
        price,
        candles[bestIdx].time as unknown as import("lightweight-charts").Time,
        seriesRef.current
      );
    }

    // Clear crosshair after 2s
    setTimeout(() => {
      chartRef.current?.clearCrosshairPosition();
    }, 2000);
  }

  // Create chart
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#0a0a10" },
        textColor: "#5a5a66",
        fontFamily: "var(--font-geist-mono), monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.03)" },
        horzLines: { color: "rgba(255,255,255,0.03)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(255,255,255,0.1)", width: 1, style: 2 },
        horzLine: { color: "rgba(255,255,255,0.1)", width: 1, style: 2 },
      },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.06)",
        scaleMargins: { top: 0.1, bottom: 0.2 },
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.06)",
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: { vertTouchDrag: false },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#34d399",
      downColor: "#f87171",
      borderUpColor: "#34d399",
      borderDownColor: "#f87171",
      wickUpColor: "#34d39980",
      wickDownColor: "#f8717180",
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Fetch candle data — destroys old series to clear all price lines/markers
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // Remove old series completely (clears all price lines + markers)
    if (seriesRef.current) {
      clearLines(seriesRef.current, baseLinesRef);
      clearLines(seriesRef.current, highlightLinesRef);
      markersPluginRef.current?.detach();
      markersPluginRef.current = null;
      chart.removeSeries(seriesRef.current);
      seriesRef.current = null;
    }

    // Create fresh series
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#34d399",
      downColor: "#f87171",
      borderUpColor: "#34d399",
      borderDownColor: "#f87171",
      wickUpColor: "#34d39980",
      wickDownColor: "#f8717180",
    });
    seriesRef.current = series;
    setLoading(true);

    async function fetchCandles() {
      try {
        const r = await fetch(`/api/candles/${coin}?interval=${interval}`);
        if (!r.ok) throw new Error("Failed to fetch");
        const d = await r.json();
        if (d.candles?.length > 0) {
          series.setData(d.candles);
          candlesRef.current = d.candles;
          setCandlesVersion((version) => version + 1);
          chart?.timeScale().fitContent();
        }
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }
    fetchCandles();
  }, [coin, interval]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    if (!selectedPosition && selectedEntryKey !== null) {
      setSelectedEntryKey(null);
      return;
    }

    syncMarkers(series);
    syncBaseLines(series);
    syncHighlightLines(series);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candlesVersion, markersSignature, selectedEntryKey, markPx]);

  return (
    <div className="rounded-xl border border-border-subtle bg-raised overflow-hidden">
      {/* Chart header */}
      <div className={`px-5 py-3 border-b border-border-subtle flex items-center justify-between text-xs ${MN}`}>
        <div className="flex items-center gap-3">
          <span className="text-fg3 uppercase tracking-widest text-[10px]">차트</span>
          <span className="text-fg2">{coin}/USD</span>
          {/* Interval selector */}
          <div className="flex items-center gap-0.5 ml-2">
            {(["15m", "30m", "1h", "4h"] as const).map(iv => (
              <button
                key={iv}
                onClick={() => setInterval(iv)}
                className={`px-2 py-0.5 rounded text-[10px] cursor-pointer transition-colors ${
                  interval === iv ? "bg-surface text-fg" : "text-fg3 hover:text-fg hover:bg-surface/50"
                }`}
              >
                {iv}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-4 text-[10px]">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-[3px] bg-green rounded" /> 롱 {longCount}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-[3px] bg-red rounded" /> 숏 {shortCount}
          </span>
          <span className="flex items-center gap-1.5 text-fg3">
            굵기 = 규모
          </span>
        </div>
      </div>

      {/* Chart */}
      <div className="relative">
        <div ref={containerRef} style={{ width: "100%", height: 420 }} />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-raised/80">
            <div className={`text-xs ${MN} text-fg3`}>차트 로딩 중...</div>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-raised/80">
            <div className={`text-xs ${MN} text-red`}>차트 로드 실패</div>
          </div>
        )}
        {/* Selected position overlay card */}
        {selectedPosition && (() => {
          const p = selectedPosition;
          const isLong = p.side === "LONG";
          const pnlPct = (p.returnOnEquity * 100).toFixed(1);
          const borderColor = isLong ? "border-green/30" : "border-red/30";
          const ld = p.liquidationPx && p.entryPx
            ? Math.abs((p.liquidationPx - p.entryPx) / p.entryPx * 100) : null;

          return (
            <div className={`absolute top-3 left-3 z-20 rounded-lg border ${borderColor} bg-[#0a0a10]/95 backdrop-blur-sm p-3 max-w-[260px]`}
              style={{ animation: "fade-in-up 0.15s ease-out" }}>
              {/* Header: tier + address + close */}
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="flex items-center gap-1.5">
                  <span className={`text-[10px] ${MN} px-1.5 py-0.5 rounded border font-medium ${
                    p.tier === "S" ? "text-amber border-amber/20 bg-amber-dim"
                    : p.tier === "A" ? "text-blue border-blue/20 bg-blue-dim"
                    : "text-fg3 border-fg3/10 bg-surface"
                  }`}>{p.tier}</span>
                  <span className={`text-[11px] ${MN} text-fg3`}>{traderName(p.address)}</span>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); toggleSelectedPosition(p); }}
                  className="text-fg3 hover:text-fg text-xs cursor-pointer">✕</button>
              </div>

              {/* Direction + Size */}
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-xs ${MN} px-2 py-0.5 rounded-full font-semibold ${isLong ? "bg-green/10 text-green" : "bg-red/10 text-red"}`}>
                  {isLong ? "롱" : "숏"}
                </span>
                <span className={`text-sm ${MN} font-semibold text-fg`}>{fmt(p.sizeUsd)}</span>
                <span className={`text-[11px] ${MN} px-1.5 py-0.5 rounded ${p.leverage >= 20 ? "bg-red/8 text-red" : p.leverage >= 10 ? "bg-amber/8 text-amber" : "bg-surface text-fg2"}`}>
                  {p.leverage}배
                </span>
              </div>

              {/* PnL bar */}
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-xs ${MN} font-semibold ${p.unrealizedPnl >= 0 ? "text-green" : "text-red"}`}>
                  {fmtPnl(p.unrealizedPnl)}
                </span>
                <span className={`text-[10px] ${MN} px-1.5 py-0.5 rounded ${p.unrealizedPnl >= 0 ? "bg-green/10 text-green" : "bg-red/10 text-red"}`}>
                  {p.returnOnEquity >= 0 ? "+" : ""}{pnlPct}%
                </span>
              </div>

              {/* Entry + Liq */}
              <div className={`flex items-center gap-3 text-[10px] ${MN} text-fg3`}>
                <span>진입 <span className="text-fg2">${p.entryPx.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span></span>
                {p.liquidationPx != null && (
                  <span>청산 <span className={ld != null && ld < 10 ? "text-red" : "text-fg2"}>
                    ${p.liquidationPx.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                    {ld != null && <span className="opacity-70 ml-0.5">({ld.toFixed(0)}%)</span>}
                  </span></span>
                )}
              </div>
            </div>
          );
        })()}
      </div>

      {/* Interactive entry point legend */}
      {topBySize.length > 0 && (
        <div className="border-t border-border-subtle">
          <div className={`px-5 py-2 text-[10px] ${MN} text-fg3 uppercase tracking-widest`}>
            진입 포인트 (클릭하여 차트에서 확인)
          </div>
          <div className="px-5 pb-3 space-y-0.5">
            {topBySize.map((p, i) => {
              const w = sizeToWidth(p.sizeUsd);
              const isHovered = hoveredIdx === i;
              const isSelected = selectedEntryKey === getEntryMarkerKey(p);
              const pnlColor = p.unrealizedPnl >= 0 ? "text-green" : "text-red";

              return (
                <button
                  key={`${p.address}-${i}`}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all cursor-pointer ${
                    isSelected ? "bg-surface ring-1 ring-inset ring-white/10" : isHovered ? "bg-surface" : "hover:bg-surface/50"
                  }`}
                  onMouseEnter={() => setHoveredIdx(i)}
                  onMouseLeave={() => setHoveredIdx(null)}
                  onClick={() => toggleSelectedPosition(p)}
                >
                  {/* Size indicator bar */}
                  <div className="w-5 flex justify-center">
                    <div
                      className={`rounded-full ${p.side === "LONG" ? "bg-green" : "bg-red"}`}
                      style={{ width: `${w * 3}px`, height: `${w * 3}px` }}
                    />
                  </div>

                  {/* Tier */}
                  <span className={`text-[10px] ${MN} px-1.5 py-0.5 rounded border ${
                    p.tier === "S" ? "text-amber border-amber/20 bg-amber-dim"
                    : p.tier === "A" ? "text-blue border-blue/20 bg-blue-dim"
                    : "text-fg3 border-fg3/10 bg-surface"
                  }`}>{p.tier}</span>

                  {/* Side */}
                  <span className={`text-[10px] ${MN} px-2 py-0.5 rounded-full font-semibold ${p.side === "LONG" ? "bg-green/10 text-green" : "bg-red/10 text-red"}`}>
                    {p.side === "LONG" ? "롱" : "숏"}
                  </span>

                  {/* Entry price */}
                  <span className={`text-xs ${MN} text-fg2`}>
                    ${p.entryPx.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </span>

                  {/* Size */}
                  <span className={`text-xs ${MN} text-fg font-semibold`}>{fmt(p.sizeUsd)}</span>

                  {/* Expanded info on hover */}
                  {isHovered && (
                    <div className={`flex items-center gap-3 ml-auto text-[11px] ${MN}`}>
                      <span className={`px-1.5 py-0.5 rounded ${p.leverage >= 20 ? "bg-red/8 text-red" : p.leverage >= 10 ? "bg-amber/8 text-amber" : "bg-surface text-fg2"}`}>
                        {p.leverage}배
                      </span>
                      <span className={pnlColor}>{fmtPnl(p.unrealizedPnl)}</span>
                      <span className="text-fg3">{traderName(p.address)}</span>
                      <span className="text-fg3/50">→</span>
                    </div>
                  )}

                  {!isHovered && (
                    <span className={`ml-auto text-[11px] ${MN} ${pnlColor}`}>{fmtPnl(p.unrealizedPnl)}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
