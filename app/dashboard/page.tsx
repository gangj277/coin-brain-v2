"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";

// ─── Types ───────────────────────────────────────────────

interface TraderPosition {
  address: string; tier: string; side: "LONG" | "SHORT"; size: number; sizeUsd: number;
  leverage: number; leverageType: string; entryPx: number; liquidationPx: number | null;
  unrealizedPnl: number; returnOnEquity: number; marginUsed: number;
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
interface Stats { totalTraders: number; tradersWithPositions: number; totalPositions: number; }

const MN = "font-[family-name:var(--font-geist-mono)]";
function fmt(n: number) { if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`; if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}k`; return `$${n.toFixed(0)}`; }
function fmtPnl(n: number) { return `${n >= 0 ? "+" : ""}${fmt(n)}`; }
function fmtPct(n: number) { return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`; }

// ─── Market Pulse Strip ──────────────────────────────────

function Pulse({ signals, stats }: { signals: Signal[]; stats: Stats | null }) {
  const tl = signals.reduce((a, s) => a + s.longValueUsd, 0);
  const ts = signals.reduce((a, s) => a + s.shortValueUsd, 0);
  const tv = tl + ts;
  const lb = tv > 0 ? (tl / tv) * 100 : 50;
  const tp = signals.reduce((a, s) => a + s.totalUnrealizedPnl, 0);
  const strong = signals.filter(s => s.strength === "strong").length;

  return (
    <div className="border-b border-border bg-raised">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-10">
        <div>
          <div className={`text-[10px] ${MN} text-fg3 uppercase tracking-widest mb-1`}>롱/숏 비율</div>
          <div className="flex items-baseline gap-2">
            <span className={`text-xl font-semibold ${MN} ${lb > 55 ? "text-green" : lb < 45 ? "text-red" : "text-fg"}`}>{lb.toFixed(0)}%</span>
            <span className={`text-xs ${MN} text-fg3`}>롱</span>
          </div>
          <div className="ratio-bar mt-1.5 w-28"><span style={{ width: `${lb}%` }} /></div>
        </div>
        <div>
          <div className={`text-[10px] ${MN} text-fg3 uppercase tracking-widest mb-1`}>추적 자본</div>
          <span className={`text-xl font-semibold ${MN}`}>{fmt(tv)}</span>
          <div className={`text-xs ${MN} mt-0.5 ${tp >= 0 ? "text-green" : "text-red"}`}>{fmtPnl(tp)} 미실현</div>
        </div>
        <div>
          <div className={`text-[10px] ${MN} text-fg3 uppercase tracking-widest mb-1`}>강한 시그널</div>
          <span className={`text-xl font-semibold ${MN}`}>{strong}</span>
        </div>
        <div className="ml-auto">
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inset-0 rounded-full bg-green animate-ping opacity-75" />
              <span className="relative rounded-full h-1.5 w-1.5 bg-green" />
            </span>
            <span className={`text-sm ${MN}`}>{stats?.tradersWithPositions ?? 0}명 활성</span>
          </div>
          <div className={`text-xs ${MN} text-fg3 mt-0.5`}>{stats?.totalPositions ?? 0}개 포지션</div>
        </div>
      </div>
    </div>
  );
}

// ─── Signal Card ─────────────────────────────────────────

function SignalCard({ signal: s }: { signal: Signal }) {
  const lr = s.totalValueUsd > 0 ? (s.longValueUsd / s.totalValueUsd) * 100 : 50;
  const pc = s.totalUnrealizedPnl >= 0 ? "text-green" : "text-red";
  const borderColor = s.dominantSide === "LONG" ? "border-l-green" : s.dominantSide === "SHORT" ? "border-l-red" : "border-l-amber";
  const isStrong = s.strength === "strong";

  return (
    <Link href={`/dashboard/${s.coin}`} className="block">
      <div className={`rounded-xl border border-border-subtle bg-raised hover:bg-surface transition-all duration-150 cursor-pointer border-l-[3px] ${borderColor} ${isStrong ? "shadow-[inset_0_0_30px_rgba(255,255,255,0.01)]" : ""}`}>
        <div className="p-5">
          {/* Row 1: Coin + Type + Side + Value */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <span className="text-lg font-semibold tracking-tight text-fg">{s.coin}</span>
              <span className={`text-[10px] ${MN} px-1.5 py-0.5 rounded ${
                s.type === "consensus" ? "bg-green-dim text-green" : s.type === "divergence" ? "bg-amber-dim text-amber" : "bg-blue-dim text-blue"
              }`}>
                {s.type === "consensus" ? (s.dominantSide === "LONG" ? "▲ 컨센서스" : "▼ 컨센서스") : s.type === "divergence" ? "◆ 다이버전스" : "○ 이머징"}
              </span>
              <span className={`text-xs ${MN} px-2 py-0.5 rounded-full font-semibold ${s.dominantSide === "LONG" ? "bg-green/10 text-green" : s.dominantSide === "SHORT" ? "bg-red/10 text-red" : "bg-amber/10 text-amber"}`}>
                {s.dominantSide === "LONG" ? "롱" : s.dominantSide === "SHORT" ? "숏" : "양방향"}
              </span>
            </div>
            <div className="text-right">
              <span className={`text-lg font-semibold ${MN}`}>{fmt(s.totalValueUsd)}</span>
              <span className={`text-xs ${MN} ml-2 ${pc}`}>{fmtPnl(s.totalUnrealizedPnl)}</span>
            </div>
          </div>

          {/* Row 2: Conviction + Traders + S-tier + L/S bar */}
          <div className="flex items-center gap-4 mb-3">
            {/* Conviction gauge */}
            <div className="flex items-center gap-2">
              <span className={`text-xs ${MN} text-fg3`}>확신도</span>
              <div className="w-20 h-1.5 rounded-full bg-surface overflow-hidden">
                <div className={`h-full rounded-full ${s.conviction >= 80 ? "bg-green" : s.conviction >= 60 ? "bg-amber" : "bg-fg3"}`} style={{ width: `${s.conviction}%` }} />
              </div>
              <span className={`text-sm font-semibold ${MN} ${s.conviction >= 80 ? "text-green" : s.conviction >= 60 ? "text-fg" : "text-fg3"}`}>{s.conviction}%</span>
            </div>

            <span className="text-border">|</span>

            <span className={`text-xs ${MN} text-fg2`}>{s.totalTraders}명</span>
            {s.sTierCount > 0 && <span className={`text-xs ${MN} text-amber`}>S×{s.sTierCount}</span>}
            {s.aTierCount > 0 && <span className={`text-xs ${MN} text-blue`}>A×{s.aTierCount}</span>}

            <span className="text-border">|</span>

            {/* L/S bar */}
            <div className="flex items-center gap-2 flex-1">
              <span className={`text-[10px] ${MN} text-green`}>{s.longTraders}롱</span>
              <div className="flex-1 ratio-bar h-[3px]"><span style={{ width: `${lr}%` }} /></div>
              <span className={`text-[10px] ${MN} text-red`}>{s.shortTraders}숏</span>
            </div>

            {s.analysis && (
              <>
                <span className="text-border">|</span>
                <span className={`text-[10px] ${MN} px-1.5 py-0.5 rounded ${
                  s.analysis.sentiment === "bullish" ? "bg-green-dim text-green"
                  : s.analysis.sentiment === "bearish" ? "bg-red-dim text-red"
                  : "bg-amber-dim text-amber"
                }`}>{s.analysis.sentiment === "bullish" ? "강세" : s.analysis.sentiment === "bearish" ? "약세" : s.analysis.sentiment === "conflicted" ? "혼조" : "중립"}</span>
              </>
            )}
          </div>

          {/* Row 3: AI Conclusion preview */}
          {s.analysis?.conclusion && (
            <p className="text-sm text-fg2 leading-relaxed line-clamp-2">{s.analysis.conclusion}</p>
          )}

          {/* Row 3 alt: Market data if available */}
          {!s.analysis?.conclusion && s.market && (
            <div className={`flex items-center gap-4 text-xs ${MN} text-fg3`}>
              <span>${s.market.markPx.toLocaleString()} <span className={s.market.dayChange >= 0 ? "text-green" : "text-red"}>{fmtPct(s.market.dayChange)}</span></span>
              <span>레버리지 {s.avgLeverage}배</span>
            </div>
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
  const [tab, setTab] = useState<"all" | "strong" | "moderate" | "ai">("all");

  const fetchData = useCallback(async () => {
    try {
      const r = await fetch("/api/signals");
      if (!r.ok) { if (r.status === 503) { setError("init"); return; } throw new Error(`${r.status}`); }
      const d = await r.json();
      setSignals(d.signals ?? []); setStats(d.stats ?? null); setError(null);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); const i = setInterval(fetchData, 15_000); return () => clearInterval(i); }, [fetchData]);

  const list = tab === "all" ? signals.filter(s => s.strength !== "weak")
    : tab === "ai" ? signals.filter(s => s.analysis)
    : signals.filter(s => s.strength === tab);

  if (error === "init") return (
    <div className="flex items-center justify-center h-screen bg-bg">
      <div className="text-center">
        <div className="relative w-10 h-10 mx-auto mb-4">
          <div className="absolute inset-0 border border-border rounded-full" />
          <div className="absolute inset-0 border border-green border-t-transparent rounded-full animate-spin" />
        </div>
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
            <span className={`text-[10px] ${MN} text-fg3 border border-border rounded px-1.5 py-0.5`}>대시보드</span>
          </div>
        </div>
      </header>

      {/* Pulse */}
      {!loading && signals.length > 0 && <Pulse signals={signals} stats={stats} />}

      {/* Filters */}
      <div className="max-w-6xl mx-auto px-6 py-4">
        <div className={`flex items-center gap-1 text-xs ${MN} mb-6`}>
          {(["all", "strong", "moderate", "ai"] as const).map(f => (
            <button key={f} onClick={() => setTab(f)}
              className={`px-3 py-1.5 rounded-lg cursor-pointer transition-colors ${
                tab === f ? (f === "ai" ? "bg-blue-dim text-blue" : "bg-surface text-fg") : "text-fg3 hover:text-fg hover:bg-surface/50"
              }`}>
              {f === "ai" ? "AI 분석" : f === "all" ? "전체" : f === "strong" ? "강한 시그널" : "보통 시그널"}
              <span className="ml-1.5 text-fg3">
                {f === "all" ? signals.filter(s => s.strength !== "weak").length
                 : f === "ai" ? signals.filter(s => s.analysis).length
                 : signals.filter(s => s.strength === f).length}
              </span>
            </button>
          ))}
        </div>

        {/* Signal Cards */}
        {loading ? (
          <div className={`text-center py-20 text-sm ${MN} text-fg3`}>로딩 중...</div>
        ) : list.length === 0 ? (
          <div className={`text-center py-20 text-sm ${MN} text-fg3`}>시그널이 없습니다</div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {list.map(s => <SignalCard key={s.coin} signal={s} />)}
          </div>
        )}
      </div>
    </div>
  );
}
