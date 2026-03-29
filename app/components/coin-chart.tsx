"use client";

import { useEffect, useRef, useState } from "react";
import { createChart, createSeriesMarkers, CandlestickSeries, type IChartApi, type ISeriesApi, type SeriesMarker, type Time, ColorType, CrosshairMode } from "lightweight-charts";

interface TraderMarker {
  address: string;
  tier: string;
  side: "LONG" | "SHORT";
  entryPx: number;
  sizeUsd: number;
  leverage: number;
  unrealizedPnl: number;
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
  const candlesRef = useRef<{ time: number; open: number; high: number; low: number; close: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [interval, setInterval] = useState<"15m" | "30m" | "1h" | "4h">("4h");

  const topBySize = [...positions].sort((a, b) => b.sizeUsd - a.sizeUsd).slice(0, 15);
  const longCount = positions.filter(p => p.side === "LONG").length;
  const shortCount = positions.filter(p => p.side === "SHORT").length;

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
    seriesRef.current && chartRef.current.setCrosshairPosition(
      price,
      candles[bestIdx].time as unknown as import("lightweight-charts").Time,
      seriesRef.current
    );

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

          // Markers at entry points — tiered visual hierarchy
          const markers: SeriesMarker<Time>[] = [];
          for (const p of topBySize) {
            let bestIdx = d.candles.length - 1;
            let bestDist = Infinity;
            for (let ci = 0; ci < d.candles.length; ci++) {
              const c = d.candles[ci];
              if (p.entryPx >= c.low && p.entryPx <= c.high) { bestIdx = ci; bestDist = 0; break; }
              const dist = Math.min(Math.abs(p.entryPx - c.high), Math.abs(p.entryPx - c.low));
              if (dist < bestDist) { bestDist = dist; bestIdx = ci; }
            }

            // S-tier: gold/amber arrows, large, prominent label
            // A-tier: standard green/red arrows, medium
            // B/C-tier: muted circles, small, minimal label
            const isS = p.tier === "S";
            const isA = p.tier === "A";
            const isLong = p.side === "LONG";

            let color: string;
            let shape: "arrowUp" | "arrowDown" | "circle";
            let size: number;
            let text: string;

            if (isS) {
              color = "#fbbf24"; // amber — stands out from candles
              shape = isLong ? "arrowUp" : "arrowDown";
              size = p.sizeUsd >= 1_000_000 ? 4 : 3;
              text = `★ ${fmt(p.sizeUsd)} ${p.leverage}×`;
            } else if (isA) {
              color = isLong ? "#34d399" : "#f87171";
              shape = isLong ? "arrowUp" : "arrowDown";
              size = p.sizeUsd >= 1_000_000 ? 3 : 2;
              text = `${fmt(p.sizeUsd)}`;
            } else {
              color = isLong ? "rgba(52,211,153,0.5)" : "rgba(248,113,113,0.5)";
              shape = "circle";
              size = 1;
              text = "";
            }

            markers.push({
              time: d.candles[bestIdx].time as Time,
              position: isLong ? "belowBar" : "aboveBar",
              color, shape, size, text,
            });
          }
          markers.sort((a, b) => (a.time as number) - (b.time as number));
          createSeriesMarkers(series, markers);

          // Price lines
          for (const p of topBySize) {
            const w = sizeToWidth(p.sizeUsd);
            const opacity = p.tier === "S" ? 0.8 : p.tier === "A" ? 0.5 : 0.3;
            series.createPriceLine({
              price: p.entryPx,
              color: p.side === "LONG" ? `rgba(52,211,153,${opacity})` : `rgba(248,113,113,${opacity})`,
              lineWidth: w,
              lineStyle: p.tier === "S" ? 0 : 2,
              axisLabelVisible: true,
              title: `[${p.tier}] ${p.side === "LONG" ? "롱" : "숏"} ${fmt(p.sizeUsd)} ${p.leverage}배`,
            });
          }

          // Single mark price line
          if (markPx) {
            series.createPriceLine({
              price: markPx, color: "rgba(34,211,238,0.5)",
              lineWidth: 1, lineStyle: 2,
              axisLabelVisible: true, title: "현재가",
            });
          }

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coin, interval]);

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
              const pnlColor = p.unrealizedPnl >= 0 ? "text-green" : "text-red";

              return (
                <button
                  key={`${p.address}-${i}`}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all cursor-pointer ${isHovered ? "bg-surface" : "hover:bg-surface/50"}`}
                  onMouseEnter={() => setHoveredIdx(i)}
                  onMouseLeave={() => setHoveredIdx(null)}
                  onClick={() => scrollToPrice(p.entryPx)}
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
                      <span className="text-fg3">{p.address.slice(0, 6)}…{p.address.slice(-4)}</span>
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
