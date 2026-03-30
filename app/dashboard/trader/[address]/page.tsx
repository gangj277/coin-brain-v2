"use client";

import Link from "next/link";
import { useEffect, useState, useCallback, useMemo, use } from "react";
import { traderName } from "@/lib/trader-name";

// ─── Types (shared) ──────────────────────────────────────

interface TraderPosition {
  address: string; tier: string; side: "LONG" | "SHORT"; size: number; sizeUsd: number;
  leverage: number; leverageType: string; entryPx: number; liquidationPx: number | null;
  unrealizedPnl: number; returnOnEquity: number; marginUsed: number;
  openedAt: number | null; lastAddedAt: number | null; observedAt: number | null;
  timingSource: "diff" | "fills" | "bootstrap"; timingConfidence: "high" | "medium" | "low"; preexisting: boolean;
}
interface SignalAnalysis {
  marketContext: string; positionAnalysis: string; riskAssessment: string; conclusion: string;
  sentiment: "bullish" | "bearish" | "neutral" | "conflicted"; confidenceLevel: "high" | "medium" | "low";
}
interface MarketData {
  markPx: number; prevDayPx: number; dayChange: number; funding: number; fundingAnnual: number;
  openInterest: number; openInterestUsd: number; dayVolume: number;
}
interface Signal {
  coin: string; type: "consensus" | "divergence" | "emerging"; strength: "strong" | "moderate" | "weak";
  dominantSide: "LONG" | "SHORT" | "SPLIT"; conviction: number; totalTraders: number;
  longTraders: number; shortTraders: number; totalValueUsd: number; longValueUsd: number;
  shortValueUsd: number; avgLeverage: number; totalUnrealizedPnl: number;
  sTierCount: number; aTierCount: number; positions: TraderPosition[];
  narrative: string; analysis: SignalAnalysis | null; market: MarketData | null;
}

interface TraderCoinPosition {
  coin: string;
  position: TraderPosition;
}

const MN = "font-[family-name:var(--font-geist-mono)]";
function fmt(n: number) { if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`; if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}k`; return `$${n.toFixed(0)}`; }
function fmtPnl(n: number) { return `${n >= 0 ? "+" : ""}${fmt(n)}`; }
function fmtPct(n: number, d = 1) { return `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`; }

// ─── Portfolio Bar Colors ────────────────────────────────
const BAR_COLORS = [
  "#34d399", "#60a5fa", "#fbbf24", "#f87171", "#22d3ee",
  "#a78bfa", "#fb923c", "#e879f9", "#4ade80", "#38bdf8",
];

// ─── Main ────────────────────────────────────────────────

export default function TraderDetail({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const r = await fetch("/api/signals");
      if (!r.ok) return;
      const d = await r.json();
      setSignals(d.signals ?? []);
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); const i = setInterval(fetchData, 15_000); return () => clearInterval(i); }, [fetchData]);

  // Aggregate all positions for this trader across all signals
  const traderData = useMemo(() => {
    const positions: TraderCoinPosition[] = [];
    let tier = "C";
    const TIER_ORDER: Record<string, number> = { S: 0, A: 1, B: 2, C: 3 };

    for (const signal of signals) {
      for (const p of signal.positions) {
        if (p.address.toLowerCase() === address.toLowerCase()) {
          positions.push({ coin: signal.coin, position: p });
          if ((TIER_ORDER[p.tier] ?? 99) < (TIER_ORDER[tier] ?? 99)) {
            tier = p.tier;
          }
        }
      }
    }

    const totalValueUsd = positions.reduce((a, cp) => a + cp.position.sizeUsd, 0);
    const totalUnrealizedPnl = positions.reduce((a, cp) => a + cp.position.unrealizedPnl, 0);

    // Sort positions by size descending
    positions.sort((a, b) => b.position.sizeUsd - a.position.sizeUsd);

    return { positions, tier, totalValueUsd, totalUnrealizedPnl };
  }, [signals, address]);

  if (loading) return (
    <div className="flex items-center justify-center h-screen bg-bg">
      <div className="relative w-10 h-10"><div className="absolute inset-0 border border-border rounded-full" /><div className="absolute inset-0 border border-green border-t-transparent rounded-full animate-spin" /></div>
    </div>
  );

  if (traderData.positions.length === 0) return (
    <div className="flex flex-col items-center justify-center h-screen bg-bg gap-4">
      <p className={`text-sm ${MN} text-fg3`}>{traderName(address)} 트레이더를 찾을 수 없습니다</p>
      <Link href="/dashboard" className={`text-xs ${MN} text-green hover:underline`}>← 목록으로</Link>
    </div>
  );

  const { positions, tier, totalValueUsd, totalUnrealizedPnl } = traderData;
  const tierBadge = tier === "S" ? "text-amber border-amber/30 bg-amber-dim"
    : tier === "A" ? "text-blue border-blue/30 bg-blue-dim"
    : tier === "B" ? "text-cyan border-cyan/30 bg-cyan-dim"
    : "text-fg3 border-fg3/15 bg-surface";
  const pnlColor = totalUnrealizedPnl >= 0 ? "text-green" : "text-red";

  return (
    <div className="min-h-screen bg-bg">
      {/* Header */}
      <header className="border-b border-border bg-raised sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className={`text-xs ${MN} text-fg3 hover:text-fg transition-colors flex items-center gap-1`}>
              ← 목록
            </Link>
            <span className="text-border">|</span>
            <span className="text-sm font-semibold tracking-tight">
              <span className="text-fg">coin</span><span className="text-green">brain</span>
            </span>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* ── Hero Header ── */}
        <div className="mb-8">
          <div className="flex items-start justify-between mb-6">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <span className={`text-sm ${MN} px-2.5 py-1 rounded border font-semibold ${tierBadge}`}>{tier}-Tier</span>
                <h1 className="text-2xl font-bold tracking-tight text-fg">
                  {traderName(address)}
                </h1>
              </div>
              <div className={`text-xs ${MN} text-fg3 mt-1`}>{address}</div>
            </div>
            <div className="text-right">
              <div className={`text-[10px] ${MN} text-fg3 uppercase tracking-widest mb-1`}>포트폴리오 가치</div>
              <div className={`text-3xl font-bold ${MN}`}>{fmt(totalValueUsd)}</div>
              <div className={`text-lg ${MN} ${pnlColor}`}>{fmtPnl(totalUnrealizedPnl)}</div>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="rounded-lg bg-raised border border-border-subtle p-4">
              <div className={`text-[10px] ${MN} text-fg3 uppercase tracking-widest mb-1`}>활성 포지션</div>
              <span className={`text-lg font-semibold ${MN}`}>{positions.length}개</span>
            </div>
            <div className="rounded-lg bg-raised border border-border-subtle p-4">
              <div className={`text-[10px] ${MN} text-fg3 uppercase tracking-widest mb-1`}>총 포지션 규모</div>
              <span className={`text-lg font-semibold ${MN}`}>{fmt(totalValueUsd)}</span>
            </div>
            <div className="rounded-lg bg-raised border border-border-subtle p-4">
              <div className={`text-[10px] ${MN} text-fg3 uppercase tracking-widest mb-1`}>미실현 수익</div>
              <span className={`text-lg font-semibold ${MN} ${pnlColor}`}>{fmtPnl(totalUnrealizedPnl)}</span>
            </div>
          </div>

          {/* ── Portfolio Breakdown Bar ── */}
          <div className="rounded-xl border border-border-subtle bg-raised p-5 mb-6">
            <div className={`text-[10px] ${MN} text-fg3 uppercase tracking-widest mb-3`}>포트폴리오 배분</div>
            {/* Stacked bar */}
            <div className="flex h-6 rounded-lg overflow-hidden mb-3">
              {positions.map((cp, i) => {
                const pct = totalValueUsd > 0 ? (cp.position.sizeUsd / totalValueUsd) * 100 : 0;
                if (pct < 0.5) return null;
                return (
                  <div
                    key={`${cp.coin}-${cp.position.side}-${i}`}
                    style={{ width: `${pct}%`, backgroundColor: BAR_COLORS[i % BAR_COLORS.length] }}
                    className="relative group transition-all duration-200 hover:opacity-80 first:rounded-l-lg last:rounded-r-lg"
                    title={`${cp.coin} ${cp.position.side === "LONG" ? "롱" : "숏"} — ${fmt(cp.position.sizeUsd)} (${pct.toFixed(1)}%)`}
                  >
                    {pct > 8 && (
                      <span className={`absolute inset-0 flex items-center justify-center text-[10px] ${MN} font-semibold text-bg`}>
                        {cp.coin}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            {/* Legend */}
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {positions.map((cp, i) => {
                const pct = totalValueUsd > 0 ? (cp.position.sizeUsd / totalValueUsd) * 100 : 0;
                return (
                  <div key={`legend-${cp.coin}-${cp.position.side}-${i}`} className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: BAR_COLORS[i % BAR_COLORS.length] }} />
                    <span className={`text-[11px] ${MN} text-fg2`}>{cp.coin} {cp.position.side === "LONG" ? "롱" : "숏"}</span>
                    <span className={`text-[11px] ${MN} text-fg3`}>{pct.toFixed(1)}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Positions List ── */}
        <div className="rounded-xl border border-border-subtle bg-raised overflow-hidden">
          <div className={`px-5 py-3 border-b border-border-subtle text-xs ${MN} text-fg3 flex items-center justify-between`}>
            <span className="uppercase tracking-widest">포지션 ({positions.length})</span>
            <span className="text-fg3/50">코인 · 방향 · 규모 · 수익률 · 진입가 · 레버리지 · 청산가</span>
          </div>

          {positions.map((cp, i) => {
            const p = cp.position;
            const roe = p.returnOnEquity * 100;
            const roeClamped = Math.min(Math.max(roe, -100), 200);
            const roeBarWidth = Math.abs(roeClamped) / 2;
            const ld = p.liquidationPx && p.entryPx ? Math.abs((p.liquidationPx - p.entryPx) / p.entryPx * 100) : null;
            const levColor = p.leverage >= 20 ? "text-red" : p.leverage >= 10 ? "text-amber" : "text-fg2";
            const levBg = p.leverage >= 20 ? "bg-red/8" : p.leverage >= 10 ? "bg-amber/8" : "bg-surface";
            const liqColor = ld != null && ld < 10 ? "text-red" : ld != null && ld > 30 ? "text-green" : "text-amber";

            return (
              <div key={`${cp.coin}-${p.side}-${i}`} className="px-5 py-4 border-b border-border-subtle/50 hover:bg-surface/30 transition-colors">
                {/* Row 1: Coin name (linked) + side + size */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Link href={`/dashboard/${cp.coin}`} className="text-fg font-semibold hover:text-green transition-colors">{cp.coin}</Link>
                    <span className={`text-[10px] ${MN} px-2 py-0.5 rounded-full ${p.side === "LONG" ? "bg-green/10 text-green" : "bg-red/10 text-red"} font-semibold`}>
                      {p.side === "LONG" ? "롱" : "숏"}
                    </span>
                  </div>
                  <span className={`text-sm ${MN} font-semibold text-fg`}>{fmt(p.sizeUsd)}</span>
                </div>

                {/* ROE bar */}
                <div className="flex items-center gap-3 mb-2">
                  <div className="flex-1 relative h-6 rounded bg-surface overflow-hidden">
                    <div className={`absolute top-0 bottom-0 ${roe >= 0 ? "left-0 bg-green/20" : "right-0 bg-red/20"} rounded transition-all`} style={{ width: `${Math.min(roeBarWidth, 100)}%` }} />
                    <div className={`absolute inset-0 flex items-center justify-between px-3 text-xs ${MN}`}>
                      <span className={roe >= 0 ? "text-green" : "text-red"}>ROE {fmtPct(roe, 0)}</span>
                      <span className={p.unrealizedPnl >= 0 ? "text-green" : "text-red"}>{fmtPnl(p.unrealizedPnl)}</span>
                    </div>
                  </div>
                </div>

                {/* Details row */}
                <div className={`flex items-center gap-2 text-[11px] ${MN}`}>
                  <span className="text-fg3">진입</span>
                  <span className="text-fg2">${p.entryPx.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
                  <span className="text-border mx-1">|</span>
                  <span className={`px-1.5 py-0.5 rounded ${levBg} ${levColor}`}>{p.leverage}배</span>
                  <span className="text-border mx-1">|</span>
                  <span className="text-fg3">증거금</span>
                  <span className="text-fg2">{fmt(p.marginUsed)}</span>
                  {p.liquidationPx != null && (
                    <>
                      <span className="text-border mx-1">|</span>
                      <span className="text-fg3">청산</span>
                      <span className={liqColor}>
                        ${p.liquidationPx.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                        {ld != null && <span className="ml-0.5 opacity-70">({ld.toFixed(0)}%)</span>}
                      </span>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
