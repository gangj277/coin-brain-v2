"use client";

import Link from "next/link";
import { useEffect, useState, useCallback, useMemo } from "react";
import { traderName } from "@/lib/trader-name";

// ─── Types ───────────────────────────────────────────────

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
interface SignalScoring {
  v2?: {
    alignmentBand: "consensus" | "near_consensus" | "divergence" | "counter_consensus";
    marketAdjustment: number;
    velocity: { score: number };
  };
}
interface SignalSmi {
  smi: number; signal: string; confirmed: boolean; persistenceCount: number;
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
interface Stats { totalTraders: number; tradersWithPositions: number; totalPositions: number; }
interface AggregatedTrader {
  address: string; tier: string; totalValueUsd: number; totalUnrealizedPnl: number;
  positionCount: number; positions: { coin: string; side: "LONG" | "SHORT"; sizeUsd: number }[];
}

interface YouTuberPosition {
  coin: string; side: "롱" | "숏" | "중립";
  targetPrice?: number; stopLoss?: number; comment: string;
  sourceUrl: string; updatedAt: string;
}
interface YouTuber {
  id: string; name: string; channelUrl: string; profileImage: string;
  subscribers: string; positions: YouTuberPosition[];
}

const MN = "font-[family-name:var(--font-geist-mono)]";
function fmt(n: number) { if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`; if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}k`; return `$${n.toFixed(0)}`; }
function fmtPnl(n: number) { return `${n >= 0 ? "+" : ""}${fmt(n)}`; }
function fmtPct(n: number) { return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`; }
function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "어제";
  if (days < 7) return `${days}일 전`;
  return dateStr;
}
const TIER_ORDER: Record<string, number> = { S: 0, A: 1, B: 2, C: 3 };

function aggregateTraders(signals: Signal[]): AggregatedTrader[] {
  const map = new Map<string, AggregatedTrader>();
  for (const signal of signals) {
    for (const p of signal.positions) {
      let trader = map.get(p.address);
      if (!trader) { trader = { address: p.address, tier: p.tier, totalValueUsd: 0, totalUnrealizedPnl: 0, positionCount: 0, positions: [] }; map.set(p.address, trader); }
      if ((TIER_ORDER[p.tier] ?? 99) < (TIER_ORDER[trader.tier] ?? 99)) trader.tier = p.tier;
      trader.totalValueUsd += p.sizeUsd; trader.totalUnrealizedPnl += p.unrealizedPnl; trader.positionCount += 1;
      trader.positions.push({ coin: signal.coin, side: p.side, sizeUsd: p.sizeUsd });
    }
  }
  const traders = Array.from(map.values());
  traders.sort((a, b) => { const td = (TIER_ORDER[a.tier] ?? 99) - (TIER_ORDER[b.tier] ?? 99); return td !== 0 ? td : b.totalValueUsd - a.totalValueUsd; });
  return traders;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className={`text-[10px] ${MN} text-fg3 uppercase tracking-widest mb-3`}>{children}</div>;
}

function alignmentBandLabel(signal: Signal) {
  const band = signal.scoring?.v2?.alignmentBand;
  if (band === "consensus") return "컨센서스";
  if (band === "near_consensus") return "근접합의";
  if (band === "divergence") return "다이버전스";
  if (band === "counter_consensus") return "역합의";
  return signal.type === "consensus" ? "컨센서스" : signal.type === "divergence" ? "다이버전스" : "이머징";
}

function alignmentBandTone(signal: Signal) {
  const band = signal.scoring?.v2?.alignmentBand;
  if (band === "consensus") return "text-green bg-green/10";
  if (band === "near_consensus") return "text-blue bg-blue/10";
  if (band === "counter_consensus") return "text-red bg-red/10";
  return signal.type === "divergence" ? "text-amber bg-amber/10" : "text-blue bg-blue/10";
}

// ─── Pulse Strip (Enhanced) ─────────────────────────────

function Pulse({ signals, stats, topSTier, fundingAlertCount }: {
  signals: Signal[]; stats: Stats | null;
  topSTier: { coin: string; count: number } | null; fundingAlertCount: number;
}) {
  const tl = signals.reduce((a, s) => a + s.longValueUsd, 0);
  const ts = signals.reduce((a, s) => a + s.shortValueUsd, 0);
  const tv = tl + ts;
  const lb = tv > 0 ? (tl / tv) * 100 : 50;
  const tp = signals.reduce((a, s) => a + s.totalUnrealizedPnl, 0);
  const strong = signals.filter(s => s.strength === "strong").length;

  return (
    <div className="border-b border-border bg-raised">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-8">
        <div>
          <div className={`text-[10px] ${MN} text-fg3 uppercase tracking-widest mb-1`}>롱/숏 비율</div>
          <div className="flex items-baseline gap-2">
            <span className={`text-xl font-semibold ${MN} ${lb > 55 ? "text-green" : lb < 45 ? "text-red" : "text-fg"}`}>{lb.toFixed(0)}%</span>
            <span className={`text-xs ${MN} text-fg3`}>롱</span>
          </div>
          <div className="ratio-bar mt-1.5 w-24"><span style={{ width: `${lb}%` }} /></div>
        </div>
        <div>
          <div className={`text-[10px] ${MN} text-fg3 uppercase tracking-widest mb-1`}>추적 자본</div>
          <span className={`text-xl font-semibold ${MN}`}>{fmt(tv)}</span>
          <div className={`text-xs ${MN} mt-0.5 ${tp >= 0 ? "text-green" : "text-red"}`}>{fmtPnl(tp)}</div>
        </div>
        <div>
          <div className={`text-[10px] ${MN} text-fg3 uppercase tracking-widest mb-1`}>강한 시그널</div>
          <span className={`text-xl font-semibold ${MN}`}>{strong}</span>
        </div>
        {topSTier && (
          <div>
            <div className={`text-[10px] ${MN} text-fg3 uppercase tracking-widest mb-1`}>S-tier 집중</div>
            <span className={`text-lg font-semibold ${MN} text-amber`}>{topSTier.coin}</span>
            <span className={`text-xs ${MN} text-amber ml-1`}>S×{topSTier.count}</span>
          </div>
        )}
        {fundingAlertCount > 0 && (
          <div>
            <div className={`text-[10px] ${MN} text-fg3 uppercase tracking-widest mb-1`}>펀딩 경고</div>
            <span className={`text-lg font-semibold ${MN} text-amber`}>{fundingAlertCount}</span>
            <div className={`text-[10px] ${MN} text-amber/60 mt-0.5`}>괴리 감지</div>
          </div>
        )}
        <div className="ml-auto">
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inset-0 rounded-full bg-green animate-ping opacity-75" />
              <span className="relative rounded-full h-1.5 w-1.5 bg-green" />
            </span>
            <span className={`text-sm ${MN}`}>{stats?.tradersWithPositions ?? 0}명</span>
          </div>
          <div className={`text-xs ${MN} text-fg3 mt-0.5`}>{stats?.totalPositions ?? 0}개 포지션</div>
        </div>
      </div>
    </div>
  );
}

// ─── Spotlight Card (Tier 1) ────────────────────────────

function SpotlightCard({ signal: s, featured }: { signal: Signal; featured?: boolean }) {
  const lr = s.totalValueUsd > 0 ? (s.longValueUsd / s.totalValueUsd) * 100 : 50;
  const pc = s.totalUnrealizedPnl >= 0 ? "text-green" : "text-red";
  const borderColor = s.dominantSide === "LONG" ? "border-l-green" : s.dominantSide === "SHORT" ? "border-l-red" : "border-l-amber";
  const glowColor = s.dominantSide === "LONG" ? "shadow-[inset_0_0_40px_rgba(52,211,153,0.03)]"
    : s.dominantSide === "SHORT" ? "shadow-[inset_0_0_40px_rgba(248,113,113,0.03)]"
    : "shadow-[inset_0_0_40px_rgba(251,191,36,0.03)]";
  const m = s.market;
  const hasFundingDivergence = m && (
    (m.fundingAnnual > 30 && s.dominantSide === "LONG" && s.sTierCount >= 2) ||
    (m.fundingAnnual < -30 && s.dominantSide === "SHORT" && s.sTierCount >= 2)
  );

  return (
    <Link href={`/dashboard/${s.coin}`} className="block">
      <div className={`rounded-xl border border-border-subtle bg-raised hover:bg-surface transition-all duration-150 cursor-pointer border-l-[4px] ${borderColor} ${glowColor}`}>
        <div className={featured ? "p-6" : "p-4"}>
          {/* Row 1: Coin + side + value */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`${featured ? "text-2xl" : "text-lg"} font-bold tracking-tight text-fg shrink-0`}>{s.coin}</span>
              <span className={`text-[10px] ${MN} px-1.5 py-0.5 rounded-full font-semibold shrink-0 ${s.dominantSide === "LONG" ? "bg-green/10 text-green" : s.dominantSide === "SHORT" ? "bg-red/10 text-red" : "bg-amber/10 text-amber"}`}>
                {s.dominantSide === "LONG" ? "롱" : s.dominantSide === "SHORT" ? "숏" : "양방향"}
              </span>
              <span className={`text-[10px] ${MN} px-1.5 py-0.5 rounded shrink-0 ${alignmentBandTone(s)}`}>
                {alignmentBandLabel(s)}
              </span>
              {s.smi && (
                <span className={`text-[10px] ${MN} px-1.5 py-0.5 rounded shrink-0 ${s.smi.confirmed ? "bg-cyan/10 text-cyan" : "bg-fg3/10 text-fg3"}`}>
                  SMI {s.smi.smi}
                </span>
              )}
              {s.analysis && (
                <span className={`text-[10px] ${MN} px-1.5 py-0.5 rounded shrink-0 ${
                  s.analysis.sentiment === "bullish" ? "bg-green-dim text-green"
                  : s.analysis.sentiment === "bearish" ? "bg-red-dim text-red"
                  : "bg-amber-dim text-amber"
                }`}>{s.analysis.sentiment === "bullish" ? "강세" : s.analysis.sentiment === "bearish" ? "약세" : "혼조"}</span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`${featured ? "text-xl" : "text-base"} font-semibold ${MN}`}>{fmt(s.totalValueUsd)}</span>
              <span className={`text-xs ${MN} ${pc}`}>{fmtPnl(s.totalUnrealizedPnl)}</span>
            </div>
          </div>

          {/* Row 2: Conviction + tier counts */}
          <div className="flex items-center gap-3 mb-2">
            <div className="flex items-center gap-1.5">
              <div className={`${featured ? "w-24" : "w-16"} h-1.5 rounded-full bg-surface overflow-hidden`}>
                <div className={`h-full rounded-full ${s.conviction >= 80 ? "bg-green" : s.conviction >= 60 ? "bg-amber" : "bg-fg3"}`} style={{ width: `${s.conviction}%` }} />
              </div>
              <span className={`text-xs font-semibold ${MN} ${s.conviction >= 80 ? "text-green" : "text-fg3"}`}>{s.conviction}%</span>
            </div>
            <span className={`text-xs ${MN} text-fg3`}>{s.totalTraders}명</span>
            {s.sTierCount > 0 && <span className={`text-xs ${MN} text-amber font-semibold`}>S×{s.sTierCount}</span>}
            {s.aTierCount > 0 && <span className={`text-xs ${MN} text-blue`}>A×{s.aTierCount}</span>}
            {s.scoring?.v2 && (
              <span className={`text-[10px] ${MN} ${s.scoring.v2.velocity.score >= 70 ? "text-cyan" : "text-fg3"}`}>
                V {s.scoring.v2.velocity.score}
              </span>
            )}
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <span className={`text-[10px] ${MN} text-green shrink-0`}>{s.longTraders}</span>
              <div className="flex-1 ratio-bar h-[2px]"><span style={{ width: `${lr}%` }} /></div>
              <span className={`text-[10px] ${MN} text-red shrink-0`}>{s.shortTraders}</span>
            </div>
          </div>

          {/* Row 3: Market + AI (featured only shows both, compact shows one) */}
          {featured ? (
            <div className={`grid ${m && s.analysis?.conclusion ? "grid-cols-2 gap-4" : "grid-cols-1"}`}>
              {m && (
                <div className={`flex items-center gap-2 text-xs ${MN} flex-wrap`}>
                  <span className="text-fg2">${m.markPx.toLocaleString()}</span>
                  <span className={m.dayChange >= 0 ? "text-green" : "text-red"}>{fmtPct(m.dayChange)}</span>
                  <span className="text-fg3">펀딩</span>
                  <span className={Math.abs(m.fundingAnnual) > 30 ? "text-amber" : m.funding >= 0 ? "text-green" : "text-red"}>
                    {m.fundingAnnual.toFixed(1)}%
                  </span>
                </div>
              )}
              {s.analysis?.conclusion && (
                <p className="text-sm text-fg2 leading-relaxed line-clamp-2">{s.analysis.conclusion}</p>
              )}
            </div>
          ) : (
            <>
              {s.analysis?.conclusion && (
                <p className="text-xs text-fg3 leading-relaxed line-clamp-1">{s.analysis.conclusion}</p>
              )}
              {!s.analysis?.conclusion && m && (
                <div className={`flex items-center gap-2 text-[11px] ${MN} text-fg3`}>
                  <span>${m.markPx.toLocaleString()}</span>
                  <span className={m.dayChange >= 0 ? "text-green" : "text-red"}>{fmtPct(m.dayChange)}</span>
                </div>
              )}
            </>
          )}

          {(s.scoring?.v2 || s.smi) && (
            <div className={`mt-3 flex items-center gap-3 flex-wrap text-[10px] ${MN} text-fg3`}>
              {s.scoring?.v2 && <span>정렬 {alignmentBandLabel(s)}</span>}
              {s.scoring?.v2 && <span>Velocity {s.scoring.v2.velocity.score}</span>}
              {s.scoring?.v2 && <span>Adj {s.scoring.v2.marketAdjustment >= 0 ? "+" : ""}{s.scoring.v2.marketAdjustment}</span>}
              {s.smi && <span>SMI {s.smi.smi} {s.smi.confirmed ? "확정" : "관찰"}</span>}
            </div>
          )}

          {/* Funding divergence alert (featured only) */}
          {featured && hasFundingDivergence && m && (
            <div className={`mt-3 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber/5 border border-amber/15 text-xs ${MN} text-amber`}>
              <span>◆</span>
              <span>펀딩 {m.fundingAnnual > 0 ? "+" : ""}{m.fundingAnnual.toFixed(0)}% 연율 — S-tier {s.sTierCount}명 {s.dominantSide === "LONG" ? "롱" : "숏"}</span>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

// ─── Signal Card (Tier 2, compact) ──────────────────────

function CompactSignalCard({ signal: s }: { signal: Signal }) {
  const lr = s.totalValueUsd > 0 ? (s.longValueUsd / s.totalValueUsd) * 100 : 50;
  const pc = s.totalUnrealizedPnl >= 0 ? "text-green" : "text-red";
  const borderColor = s.dominantSide === "LONG" ? "border-l-green" : s.dominantSide === "SHORT" ? "border-l-red" : "border-l-amber";

  return (
    <Link href={`/dashboard/${s.coin}`} className="block">
      <div className={`rounded-xl border border-border-subtle bg-raised hover:bg-surface transition-all duration-150 cursor-pointer border-l-[3px] ${borderColor}`}>
        <div className="p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold tracking-tight text-fg">{s.coin}</span>
              <span className={`text-[10px] ${MN} px-1.5 py-0.5 rounded-full font-semibold ${s.dominantSide === "LONG" ? "bg-green/10 text-green" : s.dominantSide === "SHORT" ? "bg-red/10 text-red" : "bg-amber/10 text-amber"}`}>
                {s.dominantSide === "LONG" ? "롱" : s.dominantSide === "SHORT" ? "숏" : "양방향"}
              </span>
              <span className={`text-[10px] ${MN} px-1.5 py-0.5 rounded ${alignmentBandTone(s)}`}>
                {alignmentBandLabel(s)}
              </span>
              {s.sTierCount > 0 && <span className={`text-[10px] ${MN} text-amber`}>S×{s.sTierCount}</span>}
              {s.smi && <span className={`text-[10px] ${MN} ${s.smi.confirmed ? "text-cyan" : "text-fg3"}`}>SMI {s.smi.smi}</span>}
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-sm font-semibold ${MN}`}>{fmt(s.totalValueUsd)}</span>
              <span className={`text-xs ${MN} ${pc}`}>{fmtPnl(s.totalUnrealizedPnl)}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <div className="w-16 h-1.5 rounded-full bg-surface overflow-hidden">
                <div className={`h-full rounded-full ${s.conviction >= 80 ? "bg-green" : s.conviction >= 60 ? "bg-amber" : "bg-fg3"}`} style={{ width: `${s.conviction}%` }} />
              </div>
              <span className={`text-xs ${MN} ${s.conviction >= 80 ? "text-green" : "text-fg3"}`}>{s.conviction}%</span>
            </div>
            <span className={`text-[10px] ${MN} text-fg3`}>{s.totalTraders}명</span>
            {s.scoring?.v2 && <span className={`text-[10px] ${MN} text-cyan`}>V{s.scoring.v2.velocity.score}</span>}
            <div className="flex items-center gap-1.5 flex-1">
              <div className="flex-1 ratio-bar h-[2px]"><span style={{ width: `${lr}%` }} /></div>
            </div>
          </div>
          {s.analysis?.conclusion && (
            <p className="text-xs text-fg3 leading-relaxed line-clamp-1 mt-2">{s.analysis.conclusion}</p>
          )}
        </div>
      </div>
    </Link>
  );
}

// ─── Signal Table (Tier 3, dense) ───────────────────────

function SignalTable({ signals }: { signals: Signal[] }) {
  return (
    <div className="rounded-xl border border-border-subtle bg-raised overflow-hidden">
      <div className={`grid grid-cols-[1fr_70px_90px_60px_70px_80px_55px_55px] gap-x-2 px-4 py-2 border-b border-border-subtle text-[10px] ${MN} text-fg3 uppercase tracking-wider`}>
        <span>코인</span><span>유형</span><span>확신도</span><span>트레이더</span>
        <span className="text-right">가치</span><span className="text-center">롱/숏</span>
        <span className="text-right">24h</span><span className="text-right">펀딩</span>
      </div>
      {signals.map(s => {
        const lr = s.totalValueUsd > 0 ? (s.longValueUsd / s.totalValueUsd) * 100 : 50;
        return (
          <Link key={s.coin} href={`/dashboard/${s.coin}`} className="block">
            <div className={`grid grid-cols-[1fr_70px_90px_60px_70px_80px_55px_55px] gap-x-2 px-4 items-center h-9 border-b border-border-subtle/30 hover:bg-surface/30 transition-colors cursor-pointer text-xs ${MN}`}>
              {/* Coin + side dot */}
              <div className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full ${s.dominantSide === "LONG" ? "bg-green" : s.dominantSide === "SHORT" ? "bg-red" : "bg-amber"}`} />
                <span className="text-fg font-medium">{s.coin}</span>
                {s.sTierCount > 0 && <span className="text-amber text-[10px]">S×{s.sTierCount}</span>}
              </div>
              {/* Type */}
              <span className={`text-[10px] ${
                alignmentBandLabel(s) === "컨센서스" ? "text-green" : alignmentBandLabel(s) === "다이버전스" ? "text-amber" : "text-blue"
              }`}>
                {alignmentBandLabel(s)}
              </span>
              {/* Conviction */}
              <div className="flex items-center gap-1.5">
                <div className="w-10 h-1 rounded-full bg-surface overflow-hidden">
                  <div className={`h-full rounded-full ${s.conviction >= 80 ? "bg-green" : s.conviction >= 60 ? "bg-amber" : "bg-fg3"}`} style={{ width: `${s.conviction}%` }} />
                </div>
                <span className={s.conviction >= 80 ? "text-green" : "text-fg3"}>{s.conviction}%</span>
              </div>
              {/* Traders */}
              <span className="text-fg3">{s.totalTraders}</span>
              {/* Value */}
              <span className="text-right text-fg2">{fmt(s.totalValueUsd)}</span>
              {/* L/S bar */}
              <div className="px-1"><div className="ratio-bar h-[2px]"><span style={{ width: `${lr}%` }} /></div></div>
              {/* 24h */}
              <span className={`text-right ${s.market ? (s.market.dayChange >= 0 ? "text-green" : "text-red") : "text-fg3"}`}>
                {s.market ? fmtPct(s.market.dayChange) : "—"}
              </span>
              {/* Funding */}
              <span className={`text-right ${s.market ? (Math.abs(s.market.fundingAnnual) > 30 ? "text-amber" : s.market.funding >= 0 ? "text-green" : "text-red") : "text-fg3"}`}>
                {s.market ? `${s.market.fundingAnnual.toFixed(0)}%` : "—"}
              </span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

// ─── Trader Card ────────────────────────────────────────

function TraderCard({ trader, compact }: { trader: AggregatedTrader; compact?: boolean }) {
  const tierBadge = trader.tier === "S" ? "text-amber border-amber/30 bg-amber-dim"
    : trader.tier === "A" ? "text-blue border-blue/30 bg-blue-dim"
    : trader.tier === "B" ? "text-cyan border-cyan/30 bg-cyan-dim"
    : "text-fg3 border-fg3/15 bg-surface";
  const pnlColor = trader.totalUnrealizedPnl >= 0 ? "text-green" : "text-red";
  const borderAccent = trader.tier === "S" ? "border-l-amber" : trader.tier === "A" ? "border-l-blue" : "border-l-border";
  const maxTags = compact ? 4 : 8;

  return (
    <Link href={`/dashboard/trader/${trader.address}`} className="block">
      <div className={`rounded-xl border border-border-subtle bg-raised hover:bg-surface transition-all duration-150 cursor-pointer border-l-[3px] ${borderAccent}`}>
        <div className={compact ? "p-4" : "p-5"}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2.5">
              <span className={`text-[11px] ${MN} px-2 py-0.5 rounded border font-semibold ${tierBadge}`}>{trader.tier}</span>
              <span className={`${compact ? "text-xs" : "text-sm"} ${MN} text-fg`}>{traderName(trader.address)}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className={`${compact ? "text-base" : "text-lg"} font-semibold ${MN}`}>{fmt(trader.totalValueUsd)}</span>
              <span className={`text-xs ${MN} ${pnlColor}`}>{fmtPnl(trader.totalUnrealizedPnl)}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs ${MN} text-fg3`}>{trader.positionCount}개</span>
            <span className="text-border">|</span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {trader.positions.slice(0, maxTags).map((pos, i) => (
                <span key={`${pos.coin}-${pos.side}-${i}`}
                  className={`text-[10px] ${MN} px-1.5 py-0.5 rounded ${pos.side === "LONG" ? "bg-green/8 text-green" : "bg-red/8 text-red"}`}>
                  {pos.coin} {pos.side === "LONG" ? "롱" : "숏"}
                </span>
              ))}
              {trader.positions.length > maxTags && (
                <span className={`text-[10px] ${MN} text-fg3`}>+{trader.positions.length - maxTags}</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}

// ─── Trader Table (Tier 3, dense) ───────────────────────

function TraderTable({ traders }: { traders: AggregatedTrader[] }) {
  return (
    <div className="rounded-xl border border-border-subtle bg-raised overflow-hidden">
      <div className={`grid grid-cols-[40px_1fr_60px_70px_70px_1fr] gap-x-2 px-4 py-2 border-b border-border-subtle text-[10px] ${MN} text-fg3 uppercase tracking-wider`}>
        <span>티어</span><span>닉네임</span><span>포지션</span>
        <span className="text-right">가치</span><span className="text-right">수익</span><span>주요 코인</span>
      </div>
      {traders.map(t => (
        <Link key={t.address} href={`/dashboard/trader/${t.address}`} className="block">
          <div className={`grid grid-cols-[40px_1fr_60px_70px_70px_1fr] gap-x-2 px-4 items-center h-9 border-b border-border-subtle/30 hover:bg-surface/30 transition-colors cursor-pointer text-xs ${MN}`}>
            <span className={`text-[10px] px-1.5 py-0.5 rounded border text-center ${
              t.tier === "B" ? "text-cyan border-cyan/20 bg-cyan-dim" : "text-fg3 border-fg3/10 bg-surface"
            }`}>{t.tier}</span>
            <span className="text-fg2 truncate">{traderName(t.address)}</span>
            <span className="text-fg3">{t.positionCount}</span>
            <span className="text-right text-fg2">{fmt(t.totalValueUsd)}</span>
            <span className={`text-right ${t.totalUnrealizedPnl >= 0 ? "text-green" : "text-red"}`}>{fmtPnl(t.totalUnrealizedPnl)}</span>
            <div className="flex items-center gap-1 overflow-hidden">
              {t.positions.slice(0, 3).map((pos, i) => (
                <span key={`${pos.coin}-${i}`} className={`text-[10px] px-1 py-px rounded ${pos.side === "LONG" ? "bg-green/8 text-green" : "bg-red/8 text-red"}`}>
                  {pos.coin}
                </span>
              ))}
              {t.positions.length > 3 && <span className="text-[10px] text-fg3">+{t.positions.length - 3}</span>}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

// ─── YouTuber Card ──────────────────────────────────────

function YouTuberCard({ youtuber: yt, signals }: { youtuber: YouTuber; signals: Signal[] }) {
  const latestPos = yt.positions.length > 0
    ? yt.positions.reduce((a, b) => a.updatedAt > b.updatedAt ? a : b)
    : null;

  // Compute smart money agreement stats
  const comparisons = yt.positions.map(pos => {
    const signal = signals.find(s => s.coin === pos.coin);
    const ytSide = pos.side === "롱" ? "LONG" : pos.side === "숏" ? "SHORT" : null;
    return signal && ytSide ? signal.dominantSide === ytSide : null;
  }).filter(v => v !== null);
  const agreeCount = comparisons.filter(v => v === true).length;
  const disagreeCount = comparisons.filter(v => v === false).length;

  return (
    <Link href={`/dashboard/youtuber/${yt.id}`} className="block">
      <div className="rounded-xl border border-border-subtle bg-raised hover:bg-surface transition-all duration-150 cursor-pointer">
        <div className="p-5">
          {/* Row 1: Profile + Name + Verdict badge */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              {yt.profileImage ? (
                <img src={yt.profileImage} alt={yt.name} className="w-11 h-11 rounded-full object-cover ring-1 ring-border-subtle" />
              ) : (
                <div className="w-11 h-11 rounded-full bg-surface flex items-center justify-center text-fg3 text-sm font-semibold">{yt.name[0]}</div>
              )}
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-base font-semibold text-fg">{yt.name}</span>
                  <span className={`text-[10px] ${MN} text-fg3`}>{yt.subscribers}</span>
                </div>
                {latestPos && <span className={`text-[10px] ${MN} text-fg3`}>최근 업데이트 {timeAgo(latestPos.updatedAt)}</span>}
              </div>
            </div>
            {/* Smart money verdict badge */}
            {comparisons.length > 0 && (
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs ${MN} ${
                agreeCount > disagreeCount ? "bg-green/8 border border-green/15"
                : disagreeCount > agreeCount ? "bg-red/8 border border-red/15"
                : "bg-surface border border-border-subtle"
              }`}>
                <span className={agreeCount > disagreeCount ? "text-green" : disagreeCount > agreeCount ? "text-red" : "text-fg3"}>
                  {agreeCount > disagreeCount ? "스마트머니 일치" : disagreeCount > agreeCount ? "스마트머니 반대" : "혼재"}
                </span>
                <span className="text-fg3">{agreeCount}✓ {disagreeCount}✗</span>
              </div>
            )}
          </div>

          {/* Row 2: Position tags */}
          <div className="flex items-center gap-1.5 flex-wrap mb-2">
            {yt.positions.map((pos, i) => {
              const signal = signals.find(s => s.coin === pos.coin);
              const ytSide = pos.side === "롱" ? "LONG" : pos.side === "숏" ? "SHORT" : null;
              const agrees = signal && ytSide ? signal.dominantSide === ytSide : null;
              return (
                <span key={i} className={`text-[10px] ${MN} px-2 py-1 rounded-md flex items-center gap-1.5 border ${
                  pos.side === "롱" ? "bg-green/5 text-green border-green/10" : pos.side === "숏" ? "bg-red/5 text-red border-red/10" : "bg-surface text-fg3 border-border-subtle"
                }`}>
                  {pos.coin} {pos.side}
                  {agrees !== null && (
                    <span className={`text-[9px] ${agrees ? "text-green/70" : "text-red/70"}`}>{agrees ? "✓" : "✗"}</span>
                  )}
                </span>
              );
            })}
          </div>

          {/* Row 3: Latest comment */}
          {latestPos?.comment && (
            <p className="text-xs text-fg2 leading-relaxed line-clamp-1 mt-1">{latestPos.comment}</p>
          )}
        </div>
      </div>
    </Link>
  );
}

// ─── Main ────────────────────────────────────────────────

export default function DashboardList() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"coin" | "trader" | "youtuber" | "prediction">("coin");
  const [youtubers, setYoutubers] = useState<YouTuber[]>([]);

  const fetchData = useCallback(async () => {
    try {
      const [sr, yr] = await Promise.all([
        fetch("/api/signals"),
        fetch("/api/youtubers"),
      ]);
      if (!sr.ok) { if (sr.status === 503) { setError("init"); return; } throw new Error(`${sr.status}`); }
      const sd = await sr.json();
      setSignals(sd.signals ?? []); setStats(sd.stats ?? null); setError(null);
      if (yr.ok) { const yd = await yr.json(); setYoutubers(yd.youtubers ?? []); }
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); const i = setInterval(fetchData, 15_000); return () => clearInterval(i); }, [fetchData]);

  // ─── Coin view: 3-tier split ───
  const spotlight = useMemo(() => {
    const strong = signals.filter(s => s.strength === "strong");
    if (strong.length >= 3) return strong.slice(0, 5);
    const moderate = signals.filter(s => s.strength === "moderate");
    return [...strong, ...moderate].slice(0, Math.max(3, strong.length));
  }, [signals]);

  const strongRemainder = useMemo(() =>
    signals.filter(s => s.strength === "strong" && !spotlight.includes(s)),
    [signals, spotlight]);

  const moderateSignals = useMemo(() =>
    signals.filter(s => s.strength === "moderate" && !spotlight.includes(s)),
    [signals, spotlight]);

  const fundingDivergences = useMemo(() =>
    signals.filter(s => {
      if (!s.market) return false;
      const af = s.market.fundingAnnual;
      if (af > 30 && s.dominantSide === "LONG" && s.sTierCount >= 2) return true;
      if (af < -30 && s.dominantSide === "SHORT" && s.sTierCount >= 2) return true;
      return false;
    }), [signals]);

  const topSTierSignal = useMemo(() => {
    const best = signals.reduce((b, s) => (!b || s.sTierCount > b.sTierCount) ? s : b, null as Signal | null);
    return best && best.sTierCount > 0 ? { coin: best.coin, count: best.sTierCount } : null;
  }, [signals]);

  // ─── Trader view: tier split ───
  const allTraders = useMemo(() => aggregateTraders(signals), [signals]);
  const sTierTraders = useMemo(() => allTraders.filter(t => t.tier === "S"), [allTraders]);
  const aTierTraders = useMemo(() => allTraders.filter(t => t.tier === "A"), [allTraders]);
  const bcTierTraders = useMemo(() => allTraders.filter(t => t.tier === "B" || t.tier === "C"), [allTraders]);

  // ─── Search: flat list fallback ───
  const searchResults = useMemo(() => {
    if (!search) return null;
    const q = search.toLowerCase();
    if (view === "coin") return signals.filter(s => s.strength !== "weak" && s.coin.toLowerCase().includes(q));
    return allTraders.filter(t => t.address.toLowerCase().includes(q) || traderName(t.address).toLowerCase().includes(q));
  }, [search, view, signals, allTraders]);

  if (error === "init") return (
    <div className="flex items-center justify-center h-screen bg-bg">
      <div className="text-center">
        <div className="relative w-10 h-10 mx-auto mb-4"><div className="absolute inset-0 border border-border rounded-full" /><div className="absolute inset-0 border border-green border-t-transparent rounded-full animate-spin" /></div>
        <p className={`text-xs ${MN} text-fg3`}>데이터를 수집하고 있습니다...</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-bg">
      {/* Header */}
      <header className="border-b border-border bg-raised sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-sm font-semibold tracking-tight">
              <span className="text-fg">coin</span><span className="text-green">brain</span>
            </Link>
          </div>
          <div className="flex items-center gap-3">
            {/* View Toggle */}
            <div className={`flex items-center text-xs ${MN} bg-inset rounded-lg p-0.5 border border-border-subtle`}>
              {(["coin", "trader", "youtuber", "prediction"] as const).map(v => (
                <button key={v} onClick={() => { setView(v); setSearch(""); }}
                  className={`px-3 py-1.5 rounded-md cursor-pointer transition-colors ${view === v ? (v === "prediction" ? "bg-blue/10 text-blue" : "bg-surface text-fg") : "text-fg3 hover:text-fg"}`}>
                  {v === "coin" ? "코인" : v === "trader" ? "트레이더" : v === "youtuber" ? "유튜버" : "예측마켓"}
                </button>
              ))}
            </div>
            {/* Search */}
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder={view === "coin" ? "코인 검색..." : view === "trader" ? "트레이더 검색..." : view === "youtuber" ? "유튜버 검색..." : ""}
              disabled={view === "prediction"}
              className={`px-3 py-1.5 rounded-lg bg-surface border border-border-subtle text-xs ${MN} text-fg placeholder:text-fg3/50 outline-none focus:border-green/30 w-40 transition-colors`} />
          </div>
        </div>
      </header>

      {/* Pulse */}
      {!loading && signals.length > 0 && view !== "prediction" && (
        <Pulse signals={signals} stats={stats} topSTier={topSTierSignal} fundingAlertCount={fundingDivergences.length} />
      )}

      {/* Quick coins */}
      {!loading && signals.length > 0 && view !== "prediction" && (() => {
        const pinnedCoins = ["BTC", "ETH", "SOL", "HYPE", "XRP"];
        const items = pinnedCoins.map(coin => {
          const sig = signals.find(s => s.coin === coin);
          return { coin, signal: sig };
        });
        return (
          <div className="border-b border-border-subtle bg-raised/50">
            <div className={`max-w-6xl mx-auto px-6 py-2 flex items-center gap-2 text-xs ${MN}`}>
              {items.map(({ coin, signal: sig }) => (
                <Link key={coin} href={`/dashboard/${coin}`}
                  className={`px-3 py-1.5 rounded-lg border transition-colors cursor-pointer ${
                    sig ? "border-border-subtle hover:bg-surface" : "border-border-subtle/50 opacity-50 hover:opacity-70"
                  }`}>
                  <span className="text-fg font-medium">{coin}</span>
                  {sig && (
                    <>
                      <span className={`ml-1.5 ${sig.dominantSide === "LONG" ? "text-green" : sig.dominantSide === "SHORT" ? "text-red" : "text-amber"}`}>
                        {sig.dominantSide === "LONG" ? "▲" : sig.dominantSide === "SHORT" ? "▼" : "◆"}
                      </span>
                      {sig.market && (
                        <span className={`ml-1 ${sig.market.dayChange >= 0 ? "text-green" : "text-red"}`}>
                          {fmtPct(sig.market.dayChange)}
                        </span>
                      )}
                    </>
                  )}
                </Link>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Content */}
      <div className="max-w-6xl mx-auto px-6 py-6">
        {loading ? (
          <div className={`text-center py-20 text-sm ${MN} text-fg3`}>로딩 중...</div>
        ) : searchResults ? (
          /* ─── Search results (flat) ─── */
          searchResults.length === 0 ? (
            <div className={`text-center py-20 text-sm ${MN} text-fg3`}>검색 결과가 없습니다</div>
          ) : view === "coin" ? (
            <div className="grid grid-cols-1 gap-3">
              {(searchResults as Signal[]).map(s => <CompactSignalCard key={s.coin} signal={s} />)}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {(searchResults as AggregatedTrader[]).map(t => <TraderCard key={t.address} trader={t} />)}
            </div>
          )
        ) : view === "coin" ? (
          /* ─── Coin view: 3-tier hierarchy ─── */
          <>
            {/* Tier 1: 지금 주목 */}
            {spotlight.length > 0 && (
              <section className="mb-8">
                <SectionLabel>지금 주목</SectionLabel>
                <div className="grid grid-cols-1 gap-4">
                  {/* Featured: first signal full width */}
                  {spotlight.length > 0 && (
                    <SpotlightCard signal={spotlight[0]} featured />
                  )}
                  {/* Rest: 2-col grid */}
                  {spotlight.length > 1 && (
                    <div className="grid grid-cols-2 gap-4">
                      {spotlight.slice(1).map(s => (
                        <SpotlightCard key={s.coin} signal={s} />
                      ))}
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Tier 2: 강한 시그널 */}
            {strongRemainder.length > 0 && (
              <section className="mb-8">
                <SectionLabel>강한 시그널</SectionLabel>
                <div className="grid grid-cols-2 gap-3">
                  {strongRemainder.map(s => <CompactSignalCard key={s.coin} signal={s} />)}
                </div>
              </section>
            )}

            {/* Tier 3: 전체 시그널 */}
            {moderateSignals.length > 0 && (
              <section>
                <SectionLabel>전체 시그널 ({moderateSignals.length})</SectionLabel>
                <SignalTable signals={moderateSignals} />
              </section>
            )}
          </>
        ) : view === "trader" ? (
          /* ─── Trader view: 3-tier hierarchy ─── */
          <>
            {sTierTraders.length > 0 && (
              <section className="mb-8">
                <SectionLabel>S-Tier 트레이더 ({sTierTraders.length})</SectionLabel>
                <div className="grid grid-cols-1 gap-3">
                  {sTierTraders.map(t => <TraderCard key={t.address} trader={t} />)}
                </div>
              </section>
            )}

            {aTierTraders.length > 0 && (
              <section className="mb-8">
                <SectionLabel>A-Tier 트레이더 ({aTierTraders.length})</SectionLabel>
                <div className="grid grid-cols-2 gap-3">
                  {aTierTraders.map(t => <TraderCard key={t.address} trader={t} compact />)}
                </div>
              </section>
            )}

            {bcTierTraders.length > 0 && (
              <section>
                <SectionLabel>기타 트레이더 ({bcTierTraders.length})</SectionLabel>
                <TraderTable traders={bcTierTraders} />
              </section>
            )}
          </>
        ) : view === "youtuber" ? (
          /* ─── YouTuber view ─── */
          (() => {
            const filtered = search
              ? youtubers.filter(yt => yt.name.toLowerCase().includes(search.toLowerCase()))
              : youtubers;
            return filtered.length === 0 ? (
              <div className={`text-center py-20 text-sm ${MN} text-fg3`}>등록된 유튜버가 없습니다</div>
            ) : (
              <section>
                <SectionLabel>유튜버 의견 ({filtered.length})</SectionLabel>
                <div className="grid grid-cols-1 gap-3">
                  {filtered.map(yt => <YouTuberCard key={yt.id} youtuber={yt} signals={signals} />)}
                </div>
              </section>
            );
          })()
        ) : (
          /* ─── Prediction Market view (Coming Soon) ─── */
          <div className="flex flex-col items-center justify-center py-24">
            {/* Icon */}
            <div className="mb-8">
              <svg width="80" height="80" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="40" cy="40" r="38" stroke="#60a5fa" strokeWidth="1" opacity="0.15" />
                <rect x="12" y="30" width="6" height="16" rx="1.5" fill="#60a5fa" opacity="0.2" />
                <rect x="22" y="24" width="6" height="20" rx="1.5" fill="#60a5fa" opacity="0.3" />
                <rect x="32" y="28" width="6" height="14" rx="1.5" fill="#60a5fa" opacity="0.25" />
                <circle cx="44" cy="32" r="4" stroke="#60a5fa" strokeWidth="1.5" fill="rgba(96,165,250,0.1)" />
                <path d="M48 30l10-10" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M55 18l3 2 1-4" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M48 34l10 10" stroke="#f87171" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M55 46l3-2 1 4" stroke="#f87171" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <text x="40" y="62" fill="#60a5fa" fontSize="11" fontFamily="monospace" textAnchor="middle" fontWeight="bold">87%</text>
              </svg>
            </div>
            <span className={`text-[10px] ${MN} px-3 py-1 rounded-full bg-blue/10 text-blue border border-blue/20 mb-5`}>COMING SOON</span>
            <h2 className="text-2xl font-bold text-fg mb-3">예측 마켓</h2>
            <p className="text-fg3 text-sm text-center max-w-md mb-8 leading-relaxed">
              Polymarket 크립토 Up/Down 마켓에서 단기 가격 방향을 예측합니다.<br />
              87% 승률, 12,160 트레이드 검증 완료. 현재 페이퍼 트레이딩 중입니다.
            </p>
            {/* Stats */}
            <div className="grid grid-cols-4 gap-8 mb-10">
              {[
                { value: "87%", label: "승률" },
                { value: "12,160", label: "검증 트레이드" },
                { value: "+$6.89", label: "EV/트레이드" },
                { value: "2.0%", label: "최대 드로다운" },
              ].map(s => (
                <div key={s.label} className="text-center">
                  <div className={`text-xl font-bold ${MN} text-blue`}>{s.value}</div>
                  <div className={`text-[11px] ${MN} text-fg3 mt-1`}>{s.label}</div>
                </div>
              ))}
            </div>
            {/* Strategy summary */}
            <div className="rounded-xl border border-blue/10 bg-raised p-6 max-w-lg w-full">
              <div className={`text-[10px] ${MN} text-blue uppercase tracking-widest mb-3`}>Strategy</div>
              <ul className="space-y-2.5">
                {[
                  "BTC/ETH 5분 방향 예측 — Directional Momentum Persistence",
                  "90일 Binance 실데이터 기반 실증 캘리브레이션",
                  "Kelly Criterion 포지션 사이징 + 15포인트 리스크 게이트",
                  "실시간 Polymarket CLOB 오더북 연동",
                ].map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-fg2">
                    <span className="mt-1.5 w-1 h-1 rounded-full bg-blue/30 shrink-0" />{f}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
