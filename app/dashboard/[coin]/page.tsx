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

// ─── Types (shared) ──────────────────────────────────────

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
interface Signal {
  coin: string; type: "consensus" | "divergence" | "emerging"; strength: "strong" | "moderate" | "weak";
  dominantSide: "LONG" | "SHORT" | "SPLIT"; conviction: number; totalTraders: number;
  longTraders: number; shortTraders: number; totalValueUsd: number; longValueUsd: number;
  shortValueUsd: number; avgLeverage: number; totalUnrealizedPnl: number;
  sTierCount: number; aTierCount: number; positions: TraderPosition[];
  narrative: string; analysis: SignalAnalysis | null; market: MarketData | null;
}

const MN = "font-[family-name:var(--font-geist-mono)]";
function fmt(n: number) { if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`; if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}k`; return `$${n.toFixed(0)}`; }
function fmtPnl(n: number) { return `${n >= 0 ? "+" : ""}${fmt(n)}`; }
function fmtPct(n: number, d = 1) { return `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`; }

// ─── Main ────────────────────────────────────────────────

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
  const lr = s.totalValueUsd > 0 ? (s.longValueUsd / s.totalValueUsd) * 100 : 50;
  const pc = s.totalUnrealizedPnl >= 0 ? "text-green" : "text-red";

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
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-4xl font-bold tracking-tight text-fg">{s.coin}</h1>
                <span className={`text-sm ${MN} px-3 py-1 rounded-full font-semibold ${s.dominantSide === "LONG" ? "bg-green/10 text-green" : s.dominantSide === "SHORT" ? "bg-red/10 text-red" : "bg-amber/10 text-amber"}`}>
                  {s.dominantSide === "LONG" ? "롱" : s.dominantSide === "SHORT" ? "숏" : "양방향"}
                </span>
                <span className={`text-xs ${MN} px-2 py-1 rounded ${s.type === "consensus" ? "bg-green-dim text-green" : s.type === "divergence" ? "bg-amber-dim text-amber" : "bg-blue-dim text-blue"}`}>
                  {s.type === "consensus" ? "컨센서스" : s.type === "divergence" ? "다이버전스" : "이머징"}
                </span>
                {s.analysis && (
                  <span className={`text-xs ${MN} px-2 py-1 rounded ${
                    s.analysis.sentiment === "bullish" ? "bg-green-dim text-green"
                    : s.analysis.sentiment === "bearish" ? "bg-red-dim text-red"
                    : "bg-amber-dim text-amber"
                  }`}>{s.analysis.sentiment === "bullish" ? "강세" : s.analysis.sentiment === "bearish" ? "약세" : "혼조"}</span>
                )}
              </div>
              {m && (
                <div className={`text-lg ${MN} text-fg2`}>
                  ${m.markPx.toLocaleString()} <span className={m.dayChange >= 0 ? "text-green" : "text-red"}>{fmtPct(m.dayChange)}</span>
                </div>
              )}
            </div>
            <div className="text-right">
              <div className={`text-3xl font-bold ${MN}`}>{fmt(s.totalValueUsd)}</div>
              <div className={`text-lg ${MN} ${pc}`}>{fmtPnl(s.totalUnrealizedPnl)}</div>
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-5 gap-4">
            <div className="rounded-lg bg-raised border border-border-subtle p-4">
              <div className={`text-[10px] ${MN} text-fg3 uppercase tracking-widest mb-1`}>확신도</div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 rounded-full bg-surface overflow-hidden">
                  <div className={`h-full rounded-full ${s.conviction >= 80 ? "bg-green" : s.conviction >= 60 ? "bg-amber" : "bg-fg3"}`} style={{ width: `${s.conviction}%` }} />
                </div>
                <span className={`text-lg font-semibold ${MN} ${s.conviction >= 80 ? "text-green" : s.conviction >= 60 ? "text-fg" : "text-fg3"}`}>{s.conviction}%</span>
              </div>
            </div>
            <div className="rounded-lg bg-raised border border-border-subtle p-4">
              <div className={`text-[10px] ${MN} text-fg3 uppercase tracking-widest mb-1`}>트레이더</div>
              <span className={`text-lg font-semibold ${MN}`}>{s.totalTraders}명</span>
              <div className="flex gap-2 mt-1">
                {s.sTierCount > 0 && <span className={`text-xs ${MN} text-amber`}>S×{s.sTierCount}</span>}
                {s.aTierCount > 0 && <span className={`text-xs ${MN} text-blue`}>A×{s.aTierCount}</span>}
              </div>
            </div>
            <div className="rounded-lg bg-raised border border-border-subtle p-4">
              <div className={`text-[10px] ${MN} text-fg3 uppercase tracking-widest mb-1`}>평균 레버리지</div>
              <span className={`text-lg font-semibold ${MN} ${s.avgLeverage >= 20 ? "text-red" : s.avgLeverage >= 10 ? "text-amber" : "text-fg"}`}>{s.avgLeverage}배</span>
            </div>
            <div className="rounded-lg bg-raised border border-border-subtle p-4 col-span-2">
              <div className={`text-[10px] ${MN} text-fg3 uppercase tracking-widest mb-1`}>롱/숏 비율</div>
              <div className="flex items-center gap-3">
                <span className={`text-xs ${MN} text-green`}>롱 {s.longTraders}명 · {fmt(s.longValueUsd)}</span>
                <div className="flex-1 ratio-bar h-[4px]"><span style={{ width: `${lr}%` }} /></div>
                <span className={`text-xs ${MN} text-red`}>{fmt(s.shortValueUsd)} · 숏 {s.shortTraders}명</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Market Data ── */}
        {m && (
          <div className="rounded-xl border border-border-subtle bg-raised p-5 mb-6">
            <div className={`text-[10px] ${MN} text-fg3 uppercase tracking-widest mb-3`}>시장 데이터</div>
            <div className="grid grid-cols-4 gap-6">
              <div>
                <div className={`text-xs ${MN} text-fg3 mb-1`}>현재가</div>
                <div className={`text-base ${MN} text-fg`}>${m.markPx.toLocaleString()}</div>
                <div className={`text-xs ${MN} ${m.dayChange >= 0 ? "text-green" : "text-red"}`}>24시간 {fmtPct(m.dayChange)}</div>
              </div>
              <div>
                <div className={`text-xs ${MN} text-fg3 mb-1`}>펀딩레이트</div>
                <div className={`text-base ${MN} ${m.funding >= 0 ? "text-green" : "text-red"}`}>{(m.funding * 100).toFixed(4)}%</div>
                <div className={`text-xs ${MN} text-fg3`}>연 {m.fundingAnnual.toFixed(1)}%</div>
              </div>
              <div>
                <div className={`text-xs ${MN} text-fg3 mb-1`}>미결제약정</div>
                <div className={`text-base ${MN} text-fg`}>{fmt(m.openInterestUsd)}</div>
              </div>
              <div>
                <div className={`text-xs ${MN} text-fg3 mb-1`}>24시간 거래량</div>
                <div className={`text-base ${MN} text-fg`}>{fmt(m.dayVolume)}</div>
              </div>
            </div>
          </div>
        )}

        {/* ── AI Analysis ── */}
        {s.analysis && (
          <div className="rounded-xl border border-border-subtle bg-raised p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div className={`text-[10px] ${MN} text-blue uppercase tracking-widest`}>AI 분석</div>
              <span className={`text-[10px] ${MN} px-2 py-0.5 rounded border ${
                s.analysis.confidenceLevel === "high" ? "border-green/20 text-green"
                : s.analysis.confidenceLevel === "medium" ? "border-amber/20 text-amber"
                : "border-red/20 text-red"
              }`}>{s.analysis.confidenceLevel === "high" ? "높은 신뢰" : s.analysis.confidenceLevel === "medium" ? "보통 신뢰" : "낮은 신뢰"}</span>
            </div>

            {/* Conclusion */}
            <p className="text-base font-medium text-fg leading-relaxed mb-6">{s.analysis.conclusion}</p>

            {/* 3 Analysis Steps */}
            <div className="grid grid-cols-3 gap-4">
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
                  <p className="text-xs text-fg2 leading-relaxed">{s.analysis![key]}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Chart with entry markers ── */}
        <div className="mb-6">
          <CoinChart
            coin={s.coin}
            positions={s.positions.map(p => ({
              address: p.address,
              tier: p.tier,
              side: p.side,
              entryPx: p.entryPx,
              sizeUsd: p.sizeUsd,
              leverage: p.leverage,
              unrealizedPnl: p.unrealizedPnl,
              returnOnEquity: p.returnOnEquity,
              liquidationPx: p.liquidationPx,
              openedAt: p.openedAt,
              timingConfidence: p.timingConfidence,
            }))}
            markPx={m?.markPx}
          />
        </div>

        {/* ── Positions ── */}
        <div className="rounded-xl border border-border-subtle bg-raised overflow-hidden">
          <div className={`px-5 py-3 border-b border-border-subtle text-xs ${MN} text-fg3 flex items-center justify-between`}>
            <span className="uppercase tracking-widest">포지션 ({s.positions.length})</span>
            <span className="text-fg3/50">티어 · 주소 · 방향 · 규모 · 수익률 · 진입가 · 레버리지 · 청산가</span>
          </div>

          {s.positions.map((p, i) => {
            const roe = p.returnOnEquity * 100;
            const roeClamped = Math.min(Math.max(roe, -100), 200);
            const roeBarWidth = Math.abs(roeClamped) / 2;
            const ld = p.liquidationPx && p.entryPx ? Math.abs((p.liquidationPx - p.entryPx) / p.entryPx * 100) : null;
            const levColor = p.leverage >= 20 ? "text-red" : p.leverage >= 10 ? "text-amber" : "text-fg2";
            const levBg = p.leverage >= 20 ? "bg-red/8" : p.leverage >= 10 ? "bg-amber/8" : "bg-surface";
            const liqColor = ld != null && ld < 10 ? "text-red" : ld != null && ld > 30 ? "text-green" : "text-amber";
            const tierBadge = p.tier === "S" ? "text-amber border-amber/20 bg-amber-dim"
              : p.tier === "A" ? "text-blue border-blue/20 bg-blue-dim"
              : "text-fg3 border-fg3/10 bg-surface";
            const timing = formatPositionTiming({
              openedAt: p.openedAt,
              lastAddedAt: p.lastAddedAt,
              observedAt: p.observedAt,
              timingConfidence: p.timingConfidence,
              preexisting: p.preexisting,
            });

            return (
              <div key={`${p.address}-${i}`} className="px-5 py-4 border-b border-border-subtle/50 hover:bg-surface/30 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] ${MN} px-1.5 py-0.5 rounded border ${tierBadge} font-medium`}>{p.tier}</span>
                    <Link href={`/dashboard/trader/${p.address}`} className={`text-xs ${MN} text-fg3 hover:text-green transition-colors`}>{traderName(p.address)}</Link>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] ${MN} px-2 py-0.5 rounded-full ${p.side === "LONG" ? "bg-green/10 text-green" : "bg-red/10 text-red"} font-semibold`}>
                      {p.side === "LONG" ? "롱" : "숏"}
                    </span>
                    <span className={`text-sm ${MN} font-semibold text-fg`}>{fmt(p.sizeUsd)}</span>
                  </div>
                </div>

                <div className="flex items-center gap-3 mb-2">
                  <div className="flex-1 relative h-6 rounded bg-surface overflow-hidden">
                    <div className={`absolute top-0 bottom-0 ${roe >= 0 ? "left-0 bg-green/20" : "right-0 bg-red/20"} rounded transition-all`} style={{ width: `${Math.min(roeBarWidth, 100)}%` }} />
                    <div className={`absolute inset-0 flex items-center justify-between px-3 text-xs ${MN}`}>
                      <span className={roe >= 0 ? "text-green" : "text-red"}>ROE {fmtPct(roe, 0)}</span>
                      <span className={p.unrealizedPnl >= 0 ? "text-green" : "text-red"}>{fmtPnl(p.unrealizedPnl)}</span>
                    </div>
                  </div>
                </div>

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

                <div className={`mt-2 flex items-center gap-3 text-[11px] ${MN} text-fg3`}>
                  <span>{timing.primary}</span>
                  {timing.secondary && <span className="text-fg3/70">{timing.secondary}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
