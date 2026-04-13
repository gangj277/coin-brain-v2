"use client";

import Link from "next/link";
import { useEffect, useState, useCallback, use } from "react";
import dynamic from "next/dynamic";
import { formatPositionTiming } from "@/lib/hyperliquid/timing/presentation";
import { traderName } from "@/lib/trader-name";
import type {
  PositionTimingConfidence,
  PositionTimingSource,
} from "@/lib/hyperliquid/timing/types";

const CoinChart = dynamic(() => import("@/app/components/coin-chart"), { ssr: false });

// ─── Types ──────────────────────────────────────────────

interface TraderPosition {
  address: string; tier: string; side: "LONG" | "SHORT"; size: number; sizeUsd: number;
  leverage: number; leverageType: string; entryPx: number; liquidationPx: number | null;
  unrealizedPnl: number; returnOnEquity: number; marginUsed: number;
  openedAt: number | null; lastAddedAt: number | null; observedAt: number | null;
  timingSource: PositionTimingSource; timingConfidence: PositionTimingConfidence; preexisting: boolean;
}
interface SignalAnalysis {
  marketContext: string; positionAnalysis: string; riskAssessment: string; conclusion: string;
  sentiment: "bullish" | "bearish" | "neutral" | "conflicted"; confidenceLevel: "high" | "medium" | "low";
}
interface MarketData {
  markPx: number; prevDayPx: number; dayChange: number; funding: number; fundingAnnual: number;
  openInterest: number; openInterestUsd: number; dayVolume: number;
}
interface SignalScoring {
  v2?: {
    alignmentBand: "consensus" | "near_consensus" | "divergence" | "counter_consensus";
    marketAdjustment: number;
    velocity: { score: number; eventCount: number };
    effectiveTraders: number;
  };
}
interface SignalSmi {
  smi: number; signal: string; confirmed: boolean; persistenceCount: number; confidence: "high" | "medium" | "low";
}
interface Signal {
  coin: string; type: "consensus" | "divergence" | "emerging"; strength: "strong" | "moderate" | "weak";
  dominantSide: "LONG" | "SHORT" | "SPLIT"; conviction: number; totalTraders: number;
  longTraders: number; shortTraders: number; totalValueUsd: number; longValueUsd: number;
  shortValueUsd: number; avgLeverage: number; totalUnrealizedPnl: number;
  sTierCount: number; aTierCount: number; positions: TraderPosition[];
  narrative: string; analysis: SignalAnalysis | null; market: MarketData | null;
  scoring?: SignalScoring; smi?: SignalSmi;
}

const MN = "font-[family-name:var(--font-geist-mono)]";
function fmt(n: number) { if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`; if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}k`; return `$${n.toFixed(0)}`; }
function fmtPnl(n: number) { return `${n >= 0 ? "+" : ""}${fmt(n)}`; }
function fmtPct(n: number, d = 1) { return `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`; }

function alignmentBandLabel(signal: Signal) {
  const band = signal.scoring?.v2?.alignmentBand;
  if (band === "consensus") return "컨센서스";
  if (band === "near_consensus") return "근접합의";
  if (band === "divergence") return "다이버전스";
  if (band === "counter_consensus") return "역합의";
  return signal.type === "consensus" ? "컨센서스" : signal.type === "divergence" ? "다이버전스" : "이머징";
}

// ─── Tier group helpers ─────────────────────────────────

function groupByTier(positions: TraderPosition[]) {
  const groups: Record<string, TraderPosition[]> = { S: [], A: [], B: [] };
  for (const p of positions) {
    const tier = p.tier in groups ? p.tier : "B";
    groups[tier].push(p);
  }
  // Sort within each group by sizeUsd desc
  for (const tier of Object.keys(groups)) {
    groups[tier].sort((a, b) => b.sizeUsd - a.sizeUsd);
  }
  return groups;
}

function tierGroupStats(positions: TraderPosition[]) {
  let longCount = 0, shortCount = 0, longValue = 0, shortValue = 0, totalPnl = 0;
  for (const p of positions) {
    if (p.side === "LONG") { longCount++; longValue += p.sizeUsd; }
    else { shortCount++; shortValue += p.sizeUsd; }
    totalPnl += p.unrealizedPnl;
  }
  return { longCount, shortCount, longValue, shortValue, totalPnl };
}

// ─── Natural language summary ───────────────────────────

function buildSummary(s: Signal): string {
  const sTierPositions = s.positions.filter(p => p.tier === "S");
  const sTierLong = sTierPositions.filter(p => p.side === "LONG").length;
  const sTierShort = sTierPositions.length - sTierLong;

  const parts: string[] = [];

  if (sTierPositions.length > 0) {
    if (sTierLong > sTierShort) {
      parts.push(`S급 ${sTierPositions.length}명 중 ${sTierLong}명이 롱`);
    } else if (sTierShort > sTierLong) {
      parts.push(`S급 ${sTierPositions.length}명 중 ${sTierShort}명이 숏`);
    } else {
      parts.push(`S급 ${sTierPositions.length}명 롱·숏 균등`);
    }
  }

  if (s.longValueUsd > s.shortValueUsd * 2) {
    parts.push(`롱 포지션이 ${(s.longValueUsd / s.shortValueUsd).toFixed(1)}배 우위`);
  } else if (s.shortValueUsd > s.longValueUsd * 2) {
    parts.push(`숏 포지션이 ${(s.shortValueUsd / s.longValueUsd).toFixed(1)}배 우위`);
  }

  if (s.avgLeverage >= 20) {
    parts.push(`평균 레버리지 ${s.avgLeverage}배로 고위험`);
  }

  return parts.length > 0 ? parts.join(" · ") : `${s.totalTraders}명의 트레이더가 주시 중`;
}

// ─── Position Card ──────────────────────────────────────

function PositionRow({ p, isTopTier }: { p: TraderPosition; isTopTier: boolean }) {
  const roe = p.returnOnEquity * 100;
  const roeClamped = Math.min(Math.max(roe, -100), 200);
  const roeBarWidth = Math.abs(roeClamped) / 2;
  const ld = p.liquidationPx && p.entryPx ? Math.abs((p.liquidationPx - p.entryPx) / p.entryPx * 100) : null;
  const levColor = p.leverage >= 20 ? "text-red" : p.leverage >= 10 ? "text-amber" : "text-fg2";
  const levBg = p.leverage >= 20 ? "bg-red/8" : p.leverage >= 10 ? "bg-amber/8" : "bg-surface";
  const liqColor = ld != null && ld < 10 ? "text-red" : ld != null && ld > 30 ? "text-green" : "text-amber";
  const timing = formatPositionTiming({
    openedAt: p.openedAt, lastAddedAt: p.lastAddedAt, observedAt: p.observedAt,
    timingConfidence: p.timingConfidence, preexisting: p.preexisting,
  });

  return (
    <div className={`px-5 border-b border-border-subtle/50 hover:bg-surface/30 transition-colors ${isTopTier ? "py-4" : "py-3"}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Link href={`/dashboard/trader/${p.address}`} className={`text-xs ${MN} text-fg3 hover:text-green transition-colors`}>{traderName(p.address)}</Link>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] ${MN} px-2 py-0.5 rounded-full ${p.side === "LONG" ? "bg-green/10 text-green" : "bg-red/10 text-red"} font-semibold`}>
            {p.side === "LONG" ? "롱" : "숏"}
          </span>
          <span className={`text-sm ${MN} font-semibold text-fg`}>{fmt(p.sizeUsd)}</span>
        </div>
      </div>

      {isTopTier && (
        <div className="flex items-center gap-3 mb-2">
          <div className="flex-1 relative h-6 rounded bg-surface overflow-hidden">
            <div className={`absolute top-0 bottom-0 ${roe >= 0 ? "left-0 bg-green/20" : "right-0 bg-red/20"} rounded transition-all`} style={{ width: `${Math.min(roeBarWidth, 100)}%` }} />
            <div className={`absolute inset-0 flex items-center justify-between px-3 text-xs ${MN}`}>
              <span className={roe >= 0 ? "text-green" : "text-red"}>ROE {fmtPct(roe, 0)}</span>
              <span className={p.unrealizedPnl >= 0 ? "text-green" : "text-red"}>{fmtPnl(p.unrealizedPnl)}</span>
            </div>
          </div>
        </div>
      )}

      <div className={`flex items-center gap-2 text-[11px] ${MN} flex-wrap`}>
        <span className="text-fg3">진입</span>
        <span className="text-fg2">${p.entryPx.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
        <span className="text-border mx-0.5">|</span>
        <span className={`px-1.5 py-0.5 rounded ${levBg} ${levColor}`}>{p.leverage}배</span>
        {!isTopTier && (
          <>
            <span className="text-border mx-0.5">|</span>
            <span className={p.unrealizedPnl >= 0 ? "text-green" : "text-red"}>{fmtPnl(p.unrealizedPnl)}</span>
          </>
        )}
        {isTopTier && (
          <>
            <span className="text-border mx-0.5">|</span>
            <span className="text-fg3">증거금</span>
            <span className="text-fg2">{fmt(p.marginUsed)}</span>
          </>
        )}
        {p.liquidationPx != null && (
          <>
            <span className="text-border mx-0.5">|</span>
            <span className="text-fg3">청산</span>
            <span className={liqColor}>
              ${p.liquidationPx.toLocaleString(undefined, { maximumFractionDigits: 1 })}
              {ld != null && <span className="ml-0.5 opacity-70">({ld.toFixed(0)}%)</span>}
            </span>
          </>
        )}
      </div>

      {isTopTier && (
        <div className={`mt-1.5 flex items-center gap-3 text-[11px] ${MN} text-fg3`}>
          <span>{timing.primary}</span>
          {timing.secondary && <span className="text-fg3/70">{timing.secondary}</span>}
        </div>
      )}
    </div>
  );
}

// ─── Tier Group Section ─────────────────────────────────

function TierGroup({
  tier,
  positions,
  defaultOpen,
}: {
  tier: string;
  positions: TraderPosition[];
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const stats = tierGroupStats(positions);
  const lr = (stats.longValue + stats.shortValue) > 0
    ? (stats.longValue / (stats.longValue + stats.shortValue)) * 100 : 50;

  if (positions.length === 0) return null;

  const tierStyle = tier === "S"
    ? { label: "S 티어", color: "text-amber", borderColor: "border-amber/20", bgColor: "bg-amber/5", dot: "bg-amber" }
    : tier === "A"
    ? { label: "A 티어", color: "text-blue", borderColor: "border-blue/20", bgColor: "bg-blue/5", dot: "bg-blue" }
    : { label: "B 티어", color: "text-fg3", borderColor: "border-fg3/10", bgColor: "bg-surface/50", dot: "bg-fg3" };

  return (
    <div className={`rounded-xl border ${tierStyle.borderColor} overflow-hidden mb-3`}>
      <button
        onClick={() => setOpen(!open)}
        className={`w-full px-5 py-3.5 flex items-center justify-between ${tierStyle.bgColor} cursor-pointer hover:brightness-110 transition-all`}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${tierStyle.dot}`} />
            <span className={`text-sm font-semibold ${MN} ${tierStyle.color}`}>{tierStyle.label}</span>
          </div>
          <span className={`text-xs ${MN} text-fg3`}>{positions.length}명</span>
          <span className={`text-xs ${MN} text-fg3`}>·</span>
          <span className={`text-xs ${MN} text-green`}>롱 {stats.longCount} · {fmt(stats.longValue)}</span>
          <span className={`text-xs ${MN} text-fg3`}>/</span>
          <span className={`text-xs ${MN} text-red`}>숏 {stats.shortCount} · {fmt(stats.shortValue)}</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-24 ratio-bar h-[3px]"><span style={{ width: `${lr}%` }} /></div>
          <span className={`text-xs ${MN} ${stats.totalPnl >= 0 ? "text-green" : "text-red"}`}>{fmtPnl(stats.totalPnl)}</span>
          <span className={`text-xs text-fg3 transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
        </div>
      </button>

      {open && (
        <div className="bg-raised">
          {positions.map((p, i) => (
            <PositionRow key={`${p.address}-${i}`} p={p} isTopTier={tier === "S" || tier === "A"} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main ───────────────────────────────────────────────

export default function CoinDetail({ params }: { params: Promise<{ coin: string }> }) {
  const { coin } = use(params);
  const [signal, setSignal] = useState<Signal | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const r = await fetch("/api/signals");
      if (!r.ok) return;
      const d = await r.json();
      const found = (d.signals as Signal[]).find(s => s.coin.toUpperCase() === coin.toUpperCase());
      if (found) setSignal(found);
    } catch {}
    finally { setLoading(false); }
  }, [coin]);

  useEffect(() => { fetchData(); const i = setInterval(fetchData, 15_000); return () => clearInterval(i); }, [fetchData]);

  if (loading) return (
    <div className="flex items-center justify-center h-screen bg-bg">
      <div className="relative w-10 h-10"><div className="absolute inset-0 border border-border rounded-full" /><div className="absolute inset-0 border border-green border-t-transparent rounded-full animate-spin" /></div>
    </div>
  );

  if (!signal) return (
    <div className="flex flex-col items-center justify-center h-screen bg-bg gap-4">
      <p className={`text-sm ${MN} text-fg3`}>{coin} 시그널을 찾을 수 없습니다</p>
      <Link href="/dashboard" className={`text-xs ${MN} text-green hover:underline`}>← 목록으로</Link>
    </div>
  );

  const s = signal;
  const m = s.market;
  const tierGroups = groupByTier(s.positions);
  const summary = buildSummary(s);

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
          {/* Compact market pills in header */}
          {m && (
            <div className={`flex items-center gap-4 text-[11px] ${MN}`}>
              <span className="text-fg3">펀딩 <span className={m.funding >= 0 ? "text-green" : "text-red"}>{(m.funding * 100).toFixed(4)}%</span></span>
              <span className="text-fg3">OI <span className="text-fg2">{fmt(m.openInterestUsd)}</span></span>
              <span className="text-fg3">거래량 <span className="text-fg2">{fmt(m.dayVolume)}</span></span>
            </div>
          )}
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* ── At-a-Glance Hero ── */}
        <div className="mb-8">
          {/* Price line */}
          <div className="flex items-baseline gap-4 mb-3">
            <h1 className="text-4xl font-bold tracking-tight text-fg">{s.coin}</h1>
            {m && (
              <div className={`text-xl ${MN} text-fg2`}>
                ${m.markPx.toLocaleString()}
                <span className={`ml-2 text-base ${m.dayChange >= 0 ? "text-green" : "text-red"}`}>{fmtPct(m.dayChange)}</span>
              </div>
            )}
          </div>

          {/* Natural language summary — the key insight */}
          <p className={`text-base ${MN} text-fg2 mb-4 leading-relaxed`}>{summary}</p>

          {/* AI conclusion — pulled up front */}
          {s.analysis && (
            <div className={`rounded-lg p-4 mb-5 border ${
              s.analysis.sentiment === "bullish" ? "border-green/15 bg-green/[0.03]"
              : s.analysis.sentiment === "bearish" ? "border-red/15 bg-red/[0.03]"
              : "border-amber/15 bg-amber/[0.03]"
            }`}>
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-[10px] ${MN} uppercase tracking-widest ${
                  s.analysis.sentiment === "bullish" ? "text-green"
                  : s.analysis.sentiment === "bearish" ? "text-red"
                  : "text-amber"
                }`}>
                  AI 판단 ·
                  {s.analysis.sentiment === "bullish" ? " 강세" : s.analysis.sentiment === "bearish" ? " 약세" : " 혼조"}
                </span>
                <span className={`text-[10px] ${MN} px-2 py-0.5 rounded border ${
                  s.analysis.confidenceLevel === "high" ? "border-green/20 text-green"
                  : s.analysis.confidenceLevel === "medium" ? "border-amber/20 text-amber"
                  : "border-red/20 text-red"
                }`}>{s.analysis.confidenceLevel === "high" ? "높은 신뢰" : s.analysis.confidenceLevel === "medium" ? "보통 신뢰" : "낮은 신뢰"}</span>
              </div>
              <p className="text-sm text-fg leading-relaxed">{s.analysis.conclusion}</p>
            </div>
          )}

          {/* Compact stats row */}
          <div className="flex items-center gap-6 flex-wrap">
            {/* Conviction */}
            <div className="flex items-center gap-2">
              <span className={`text-[10px] ${MN} text-fg3 uppercase`}>확신도</span>
              <div className="w-20 h-1.5 rounded-full bg-surface overflow-hidden">
                <div className={`h-full rounded-full ${s.conviction >= 80 ? "bg-green" : s.conviction >= 60 ? "bg-amber" : "bg-fg3"}`} style={{ width: `${s.conviction}%` }} />
              </div>
              <span className={`text-sm font-semibold ${MN} ${s.conviction >= 80 ? "text-green" : s.conviction >= 60 ? "text-fg" : "text-fg3"}`}>{s.conviction}%</span>
            </div>

            <span className="text-border">·</span>

            {/* Traders */}
            <div className="flex items-center gap-2">
              <span className={`text-[10px] ${MN} text-fg3 uppercase`}>트레이더</span>
              <span className={`text-sm font-semibold ${MN}`}>{s.totalTraders}명</span>
              {s.sTierCount > 0 && <span className={`text-xs ${MN} text-amber`}>S×{s.sTierCount}</span>}
              {s.aTierCount > 0 && <span className={`text-xs ${MN} text-blue`}>A×{s.aTierCount}</span>}
            </div>

            <span className="text-border">·</span>

            {/* Leverage */}
            <div className="flex items-center gap-2">
              <span className={`text-[10px] ${MN} text-fg3 uppercase`}>평균 레버리지</span>
              <span className={`text-sm font-semibold ${MN} ${s.avgLeverage >= 20 ? "text-red" : s.avgLeverage >= 10 ? "text-amber" : "text-fg"}`}>{s.avgLeverage}배</span>
            </div>

            <span className="text-border">·</span>

            {/* Total value + PnL */}
            <div className="flex items-center gap-2">
              <span className={`text-[10px] ${MN} text-fg3 uppercase`}>총 포지션</span>
              <span className={`text-sm font-semibold ${MN}`}>{fmt(s.totalValueUsd)}</span>
              <span className={`text-xs ${MN} ${s.totalUnrealizedPnl >= 0 ? "text-green" : "text-red"}`}>{fmtPnl(s.totalUnrealizedPnl)}</span>
            </div>
          </div>

          {/* Long/Short bar — full width for clarity */}
          <div className="mt-4 flex items-center gap-3">
            <span className={`text-xs ${MN} text-green shrink-0`}>롱 {s.longTraders}명 · {fmt(s.longValueUsd)}</span>
            <div className="flex-1 ratio-bar h-[4px]">
              <span style={{ width: `${s.totalValueUsd > 0 ? (s.longValueUsd / s.totalValueUsd) * 100 : 50}%` }} />
            </div>
            <span className={`text-xs ${MN} text-red shrink-0`}>{fmt(s.shortValueUsd)} · 숏 {s.shortTraders}명</span>
          </div>

          {(s.scoring?.v2 || s.smi) && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
              <div className="rounded-lg border border-border-subtle bg-raised p-3">
                <div className={`text-[10px] ${MN} text-fg3 uppercase tracking-widest mb-1`}>정렬</div>
                <div className={`text-sm ${MN} text-fg`}>{alignmentBandLabel(s)}</div>
                {s.scoring?.v2 && <div className={`text-[10px] ${MN} text-fg3 mt-1`}>유효 {s.scoring.v2.effectiveTraders.toFixed(1)}명</div>}
              </div>
              <div className="rounded-lg border border-border-subtle bg-raised p-3">
                <div className={`text-[10px] ${MN} text-fg3 uppercase tracking-widest mb-1`}>Velocity</div>
                <div className={`text-sm ${MN} ${s.scoring?.v2 && s.scoring.v2.velocity.score >= 70 ? "text-cyan" : "text-fg"}`}>
                  {s.scoring?.v2?.velocity.score ?? 0}
                </div>
                {s.scoring?.v2 && <div className={`text-[10px] ${MN} text-fg3 mt-1`}>이벤트 {s.scoring.v2.velocity.eventCount}</div>}
              </div>
              <div className="rounded-lg border border-border-subtle bg-raised p-3">
                <div className={`text-[10px] ${MN} text-fg3 uppercase tracking-widest mb-1`}>Market Adj</div>
                <div className={`text-sm ${MN} ${((s.scoring?.v2?.marketAdjustment ?? 0) >= 0) ? "text-green" : "text-red"}`}>
                  {(s.scoring?.v2?.marketAdjustment ?? 0) >= 0 ? "+" : ""}{s.scoring?.v2?.marketAdjustment ?? 0}
                </div>
                <div className={`text-[10px] ${MN} text-fg3 mt-1`}>펀딩/확장 반영</div>
              </div>
              <div className="rounded-lg border border-border-subtle bg-raised p-3">
                <div className={`text-[10px] ${MN} text-fg3 uppercase tracking-widest mb-1`}>SMI</div>
                <div className={`text-sm ${MN} ${s.smi?.confirmed ? "text-cyan" : "text-fg"}`}>
                  {s.smi?.smi ?? 0} {s.smi?.signal ?? "NEUTRAL"}
                </div>
                {s.smi && <div className={`text-[10px] ${MN} text-fg3 mt-1`}>{s.smi.confirmed ? "확정" : "관찰"} · {s.smi.persistenceCount}회</div>}
              </div>
            </div>
          )}
        </div>

        {/* ── AI Analysis Detail (collapsible) ── */}
        {s.analysis && <AnalysisDetail analysis={s.analysis} />}

        {/* ── Chart ── */}
        <div className="mb-6">
          <CoinChart
            coin={s.coin}
            positions={s.positions.map(p => ({
              address: p.address, tier: p.tier, side: p.side, entryPx: p.entryPx,
              sizeUsd: p.sizeUsd, leverage: p.leverage, unrealizedPnl: p.unrealizedPnl,
              returnOnEquity: p.returnOnEquity, liquidationPx: p.liquidationPx,
              openedAt: p.openedAt, timingConfidence: p.timingConfidence,
            }))}
            markPx={m?.markPx}
          />
        </div>

        {/* ── Tiered Positions ── */}
        <div>
          <div className={`text-[10px] ${MN} text-fg3 uppercase tracking-widest mb-3`}>
            포지션 ({s.positions.length})
          </div>
          <TierGroup tier="S" positions={tierGroups.S} defaultOpen={true} />
          <TierGroup tier="A" positions={tierGroups.A} defaultOpen={false} />
          <TierGroup tier="B" positions={tierGroups.B} defaultOpen={false} />
        </div>
      </div>
    </div>
  );
}

// ─── AI Analysis expandable detail ──────────────────────

function AnalysisDetail({ analysis }: { analysis: SignalAnalysis }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mb-6">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`text-[11px] ${MN} text-blue hover:text-blue/80 cursor-pointer transition-colors flex items-center gap-1.5`}
      >
        <span className={`transition-transform ${expanded ? "rotate-90" : ""}`}>▸</span>
        AI 분석 상세 보기
      </button>
      {expanded && (
        <div className="grid grid-cols-3 gap-4 mt-3">
          {([
            { key: "marketContext" as const, label: "시장 분석", color: "text-cyan", dot: "bg-cyan", border: "border-cyan/15" },
            { key: "positionAnalysis" as const, label: "포지션 분석", color: "text-blue", dot: "bg-blue", border: "border-blue/15" },
            { key: "riskAssessment" as const, label: "리스크 평가", color: "text-amber", dot: "bg-amber", border: "border-amber/15" },
          ] as const).map(({ key, label, color, dot, border }) => (
            <div key={key} className={`rounded-lg border ${border} bg-inset p-4`}>
              <div className={`flex items-center gap-1.5 text-xs ${MN} ${color} mb-2`}>
                <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                {label}
              </div>
              <p className="text-xs text-fg2 leading-relaxed">{analysis[key]}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
