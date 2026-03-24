"use client";

import { useEffect, useState, useCallback } from "react";

// ─── Types ───────────────────────────────────────────────

interface TraderPosition {
  address: string;
  tier: string;
  side: "LONG" | "SHORT";
  size: number;
  sizeUsd: number;
  leverage: number;
  leverageType: string;
  entryPx: number;
  liquidationPx: number | null;
  unrealizedPnl: number;
  returnOnEquity: number;
  marginUsed: number;
}

interface SignalAnalysis {
  marketContext: string;
  positionAnalysis: string;
  riskAssessment: string;
  conclusion: string;
  sentiment: "bullish" | "bearish" | "neutral" | "conflicted";
  confidenceLevel: "high" | "medium" | "low";
}

interface MarketData {
  markPx: number;
  prevDayPx: number;
  dayChange: number;
  funding: number;
  fundingAnnual: number;
  openInterest: number;
  openInterestUsd: number;
  dayVolume: number;
}

interface Signal {
  coin: string;
  type: "consensus" | "divergence" | "emerging";
  strength: "strong" | "moderate" | "weak";
  dominantSide: "LONG" | "SHORT" | "SPLIT";
  conviction: number;
  totalTraders: number;
  longTraders: number;
  shortTraders: number;
  totalValueUsd: number;
  longValueUsd: number;
  shortValueUsd: number;
  avgLeverage: number;
  totalUnrealizedPnl: number;
  sTierCount: number;
  aTierCount: number;
  positions: TraderPosition[];
  narrative: string;
  analysis: SignalAnalysis | null;
  market: MarketData | null;
}

interface TrackerStats {
  totalTraders: number;
  tradersWithPositions: number;
  totalPositions: number;
  wsConnected: number;
  wsConnections: number;
  totalChangesEmitted: number;
  uptime: number;
}

// ─── Helpers ─────────────────────────────────────────────

const MN = "font-[family-name:var(--font-geist-mono)]";

function fmt(n: number): string {
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}k`;
  return `$${n.toFixed(0)}`;
}
function fmtPnl(n: number): string { return `${n >= 0 ? "+" : ""}${fmt(n)}`; }
function fmtPct(n: number, d = 1): string { return `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`; }
function longRatio(s: Signal): number { return s.totalValueUsd > 0 ? (s.longValueUsd / s.totalValueUsd) * 100 : 50; }

// ─── Pulse ───────────────────────────────────────────────

function Pulse({ signals, stats }: { signals: Signal[]; stats: TrackerStats | null }) {
  const tl = signals.reduce((a, s) => a + s.longValueUsd, 0);
  const ts = signals.reduce((a, s) => a + s.shortValueUsd, 0);
  const tv = tl + ts;
  const lb = tv > 0 ? (tl / tv) * 100 : 50;
  const tp = signals.reduce((a, s) => a + s.totalUnrealizedPnl, 0);
  const strong = signals.filter((s) => s.strength === "strong");

  return (
    <div className="border-b border-border bg-raised">
      <div className="px-5 py-3 flex items-start gap-8">
        {/* Bias */}
        <div>
          <div className={`text-[10px] ${MN} text-fg3 uppercase tracking-widest mb-1`}>BIAS</div>
          <span className={`text-lg font-semibold ${MN} ${lb > 55 ? "text-green" : lb < 45 ? "text-red" : "text-fg"}`}>
            {lb.toFixed(0)}% <span className="text-fg3 text-xs font-normal">long</span>
          </span>
          <div className="ratio-bar mt-1.5 w-full"><span style={{ width: `${lb}%` }} /></div>
          <div className={`flex justify-between text-[10px] ${MN} text-fg3 mt-1`}>
            <span>{fmt(tl)}</span><span>{fmt(ts)}</span>
          </div>
        </div>
        {/* Capital */}
        <div>
          <div className={`text-[10px] ${MN} text-fg3 uppercase tracking-widest mb-1`}>CAPITAL</div>
          <span className={`text-lg font-semibold ${MN}`}>{fmt(tv)}</span>
          <div className={`text-xs ${MN} mt-0.5 ${tp >= 0 ? "text-green" : "text-red"}`}>{fmtPnl(tp)} uPnL</div>
        </div>
        {/* Strong */}
        <div>
          <div className={`text-[10px] ${MN} text-fg3 uppercase tracking-widest mb-1`}>STRONG</div>
          <span className={`text-lg font-semibold ${MN}`}>{strong.length}</span>
          <div className={`flex gap-2 text-xs ${MN} mt-0.5`}>
            <span className="text-green">{strong.filter(s => s.dominantSide === "LONG").length}↑</span>
            <span className="text-red">{strong.filter(s => s.dominantSide === "SHORT").length}↓</span>
            <span className="text-amber">{strong.filter(s => s.dominantSide === "SPLIT").length}◆</span>
          </div>
        </div>
        {/* Live */}
        <div>
          <div className={`text-[10px] ${MN} text-fg3 uppercase tracking-widest mb-1`}>LIVE</div>
          <div className="flex items-center gap-1.5">
            <span className="relative w-1.5 h-1.5">
              <span className="live-dot absolute inset-0 rounded-full bg-green" />
              <span className="absolute inset-0 rounded-full bg-green" />
            </span>
            <span className={`text-sm ${MN}`}>{stats?.tradersWithPositions ?? 0} traders</span>
          </div>
          <div className={`text-xs ${MN} text-fg3 mt-0.5`}>{stats?.totalPositions ?? 0} pos · {stats?.totalChangesEmitted ?? 0} events</div>
        </div>
      </div>
    </div>
  );
}

// ─── Signal Item ─────────────────────────────────────────

function SignalItem({ signal: s, selected, onSelect }: {
  signal: Signal; selected: boolean; onSelect: () => void;
}) {
  const pc = s.totalUnrealizedPnl >= 0 ? "text-green" : "text-red";
  const bc = s.dominantSide === "LONG" ? "border-l-green" : s.dominantSide === "SHORT" ? "border-l-red" : "border-l-amber";

  return (
    <button onClick={onSelect}
      className={`w-full text-left border-l-2 ${bc} px-3 py-2 transition-colors duration-100 cursor-pointer ${selected ? "bg-surface" : "hover:bg-raised"}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold tracking-tight w-14 shrink-0">{s.coin}</span>
          <span className={`text-[10px] ${MN} px-1 py-px rounded ${
            s.type === "consensus" ? "bg-green-dim text-green" : s.type === "divergence" ? "bg-amber-dim text-amber" : "bg-blue-dim text-blue"
          }`}>
            {s.type === "consensus" ? (s.dominantSide === "LONG" ? "▲" : "▼") : s.type === "divergence" ? "◆" : "○"}
          </span>
          {s.sTierCount > 0 && <span className={`text-[10px] ${MN} text-amber`}>S{s.sTierCount}</span>}
          <span className={`text-[10px] ${MN} ${s.conviction >= 80 ? "text-green" : s.conviction >= 60 ? "text-fg2" : "text-fg3"}`}>
            {s.conviction}%
          </span>
          {s.analysis && <span className={`text-[10px] ${MN} text-blue`}>AI</span>}
        </div>
        <div className={`flex items-center gap-3 ${MN} text-xs shrink-0`}>
          <span className="text-fg3 w-5 text-right">{s.totalTraders}</span>
          <span className="w-14 text-right">{fmt(s.totalValueUsd)}</span>
          <span className={`w-14 text-right ${pc}`}>{fmtPnl(s.totalUnrealizedPnl)}</span>
          <div className="w-10"><div className="ratio-bar w-full"><span style={{ width: `${longRatio(s)}%` }} /></div></div>
        </div>
      </div>
    </button>
  );
}

// ─── Detail ──────────────────────────────────────────────

function Detail({ signal: s }: { signal: Signal }) {
  const pc = s.totalUnrealizedPnl >= 0 ? "text-green" : "text-red";
  const lr = longRatio(s);
  const m = s.market;

  return (
    <div className="h-full overflow-y-auto">
      {/* Header */}
      <div className="px-5 pt-4 pb-3 border-b border-border">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-semibold tracking-tight">{s.coin}</span>
              <span className={`text-xs ${MN} font-semibold ${
                s.dominantSide === "LONG" ? "text-green" : s.dominantSide === "SHORT" ? "text-red" : "text-amber"
              }`}>{s.dominantSide}</span>
              {s.analysis && (
                <span className={`text-[10px] ${MN} px-1.5 py-0.5 rounded ${
                  s.analysis.sentiment === "bullish" ? "bg-green-dim text-green"
                  : s.analysis.sentiment === "bearish" ? "bg-red-dim text-red"
                  : s.analysis.sentiment === "conflicted" ? "bg-amber-dim text-amber"
                  : "bg-surface text-fg3"
                }`}>{s.analysis.sentiment}</span>
              )}
            </div>
            {m && (
              <div className={`text-xs ${MN} text-fg3 mt-1`}>
                ${m.markPx.toLocaleString()} <span className={m.dayChange >= 0 ? "text-green" : "text-red"}>{fmtPct(m.dayChange)}</span>
              </div>
            )}
          </div>
          <div className="text-right">
            <div className={`text-lg font-semibold ${MN}`}>{fmt(s.totalValueUsd)}</div>
            <div className={`text-xs ${MN} ${pc}`}>{fmtPnl(s.totalUnrealizedPnl)}</div>
          </div>
        </div>

        <div className={`flex items-center gap-4 mt-3 text-xs ${MN}`}>
          <span><span className="text-fg3">Conv </span><span className={s.conviction >= 80 ? "text-green" : s.conviction >= 60 ? "text-fg" : "text-amber"}>{s.conviction}%</span></span>
          <span><span className="text-fg3">Traders </span>{s.totalTraders}</span>
          <span><span className="text-fg3">Lev </span>{s.avgLeverage}x</span>
          {s.sTierCount > 0 && <span className="text-amber">S×{s.sTierCount}</span>}
          {s.aTierCount > 0 && <span className="text-blue">A×{s.aTierCount}</span>}
          {s.analysis && (
            <span className={`ml-auto px-1.5 py-0.5 rounded border text-[10px] ${
              s.analysis.confidenceLevel === "high" ? "border-green/20 text-green"
              : s.analysis.confidenceLevel === "medium" ? "border-amber/20 text-amber"
              : "border-red/20 text-red"
            }`}>{s.analysis.confidenceLevel} conf</span>
          )}
        </div>

        <div className="mt-2.5">
          <div className={`flex justify-between text-[10px] ${MN} mb-0.5`}>
            <span className="text-green">{s.longTraders}L · {fmt(s.longValueUsd)}</span>
            <span className="text-red">{fmt(s.shortValueUsd)} · {s.shortTraders}S</span>
          </div>
          <div className="ratio-bar w-full h-[3px]"><span style={{ width: `${lr}%` }} /></div>
        </div>
      </div>

      {/* Market Data */}
      {m && (
        <div className="px-5 py-2.5 border-b border-border-subtle bg-inset">
          <div className={`flex items-center gap-5 text-[11px] ${MN}`}>
            <div>
              <span className="text-fg3">Funding </span>
              <span className={m.funding >= 0 ? "text-green" : "text-red"}>{(m.funding * 100).toFixed(4)}%</span>
              <span className="text-fg3"> ({m.fundingAnnual.toFixed(1)}%y)</span>
            </div>
            <div><span className="text-fg3">OI </span><span>{fmt(m.openInterestUsd)}</span></div>
            <div><span className="text-fg3">24h Vol </span><span>{fmt(m.dayVolume)}</span></div>
          </div>
        </div>
      )}

      {/* AI Analysis */}
      {s.analysis && (
        <div className="border-b border-border">
          <div className="px-5 pt-3.5 pb-3">
            <p className="text-[13px] font-medium text-fg leading-relaxed">{s.analysis.conclusion}</p>
          </div>
          <div className="px-5 pb-4 flex flex-col gap-2">
            {([
              { key: "marketContext" as const, label: "Market", color: "text-cyan", dot: "bg-cyan" },
              { key: "positionAnalysis" as const, label: "Position", color: "text-blue", dot: "bg-blue" },
              { key: "riskAssessment" as const, label: "Risk", color: "text-amber", dot: "bg-amber" },
            ] as const).map(({ key, label, color, dot }) => (
              <details key={key} className="group">
                <summary className={`flex items-center gap-2 cursor-pointer text-xs ${MN} ${color} py-1 select-none`}>
                  <span className={`w-1 h-1 rounded-full ${dot} shrink-0`} />
                  <span>{label}</span>
                  <span className="text-fg3 ml-1 group-open:hidden truncate flex-1 text-[11px]">
                    {s.analysis![key].slice(0, 60)}…
                  </span>
                  <span className="text-fg3 text-[10px] group-open:rotate-90 transition-transform">▸</span>
                </summary>
                <p className="text-[11px] text-fg2 leading-relaxed pl-3 pt-1 pb-1">{s.analysis![key]}</p>
              </details>
            ))}
          </div>
        </div>
      )}

      {/* Positions */}
      <div className={`px-5 py-1.5 border-b border-border-subtle text-[10px] ${MN} text-fg3 flex items-center justify-between sticky top-0 bg-raised z-10`}>
        <span>POSITIONS ({s.positions.length})</span>
        <div className="flex gap-4">
          <span className="w-16 text-right">SIZE</span>
          <span className="w-14 text-right">PNL</span>
          <span className="w-12 text-right">ROE</span>
        </div>
      </div>

      {s.positions.map((p, i) => {
        const tc = p.tier === "S" ? "text-amber border-amber/20 bg-amber-dim"
          : p.tier === "A" ? "text-blue border-blue/20 bg-blue-dim"
          : "text-fg3 border-fg3/10 bg-surface";
        const ld = p.liquidationPx && p.entryPx
          ? Math.abs((p.liquidationPx - p.entryPx) / p.entryPx * 100) : null;

        return (
          <div key={`${p.address}-${i}`} className="px-5 py-2 border-b border-border-subtle/50 hover:bg-surface/50 transition-colors">
            <div className={`flex items-center justify-between text-xs ${MN}`}>
              <div className="flex items-center gap-1.5">
                <span className={`text-[10px] px-1 py-px rounded border ${tc}`}>{p.tier}</span>
                <span className="text-fg3">{p.address.slice(0, 6)}…{p.address.slice(-4)}</span>
                <span className={`text-[10px] font-semibold ${p.side === "LONG" ? "text-green" : "text-red"}`}>
                  {p.side === "LONG" ? "L" : "S"}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <span className="w-16 text-right font-medium">{fmt(p.sizeUsd)}</span>
                <span className={`w-14 text-right ${p.unrealizedPnl >= 0 ? "text-green" : "text-red"}`}>
                  {fmtPnl(p.unrealizedPnl)}
                </span>
                <span className={`w-12 text-right text-[10px] px-1 py-px rounded ${
                  p.returnOnEquity >= 0 ? "bg-green-dim text-green" : "bg-red-dim text-red"
                }`}>
                  {fmtPct(p.returnOnEquity * 100, 0)}
                </span>
              </div>
            </div>
            <div className={`flex items-center gap-3 mt-1 text-[10px] ${MN} text-fg3`}>
              <span>@${p.entryPx.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
              <span>{p.leverage}x</span>
              <span>Mgn {fmt(p.marginUsed)}</span>
              {p.liquidationPx != null && (
                <span>
                  Liq <span className={ld != null && ld < 10 ? "text-red" : ld != null && ld > 30 ? "text-green" : "text-amber"}>
                    ${p.liquidationPx.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                    {ld != null && <span className="ml-0.5">({ld.toFixed(0)}%)</span>}
                  </span>
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────

export default function Home() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [stats, setStats] = useState<TrackerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [coin, setCoin] = useState<string | null>(null);
  const [tab, setTab] = useState<"all" | "strong" | "moderate" | "ai">("all");

  const fetchData = useCallback(async () => {
    try {
      const r = await fetch("/api/signals");
      if (!r.ok) { if (r.status === 503) { setError("init"); return; } throw new Error(`${r.status}`); }
      const d = await r.json();
      setSignals(d.signals); setStats(d.stats); setError(null);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); const i = setInterval(fetchData, 15_000); return () => clearInterval(i); }, [fetchData]);

  const list = tab === "all" ? signals.filter(s => s.strength !== "weak")
    : tab === "ai" ? signals.filter(s => s.analysis) : signals.filter(s => s.strength === tab);
  const sel = signals.find(s => s.coin === coin) ?? null;

  useEffect(() => {
    if (!coin && signals.length > 0) {
      const f = signals.find(s => s.strength === "strong");
      if (f) setCoin(f.coin);
    }
  }, [signals, coin]);

  if (error === "init") return (
    <div className="flex items-center justify-center h-screen bg-bg">
      <div className="text-center">
        <div className="relative w-10 h-10 mx-auto mb-4">
          <div className="absolute inset-0 border border-border rounded-full" />
          <div className="absolute inset-0 border border-green border-t-transparent rounded-full animate-spin" />
        </div>
        <p className={`text-xs ${MN} text-fg3`}>Connecting to 300 traders...</p>
      </div>
    </div>
  );

  if (error) return (
    <div className="flex items-center justify-center h-screen bg-bg">
      <p className={`text-xs ${MN} text-red`}>{error}</p>
    </div>
  );

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-bg">
      <header className="border-b border-border bg-raised px-5 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold tracking-tight">
            <span className="text-fg">coin</span><span className="text-green">brain</span>
          </h1>
          <span className={`text-[10px] ${MN} text-fg3 border border-border rounded px-1.5 py-0.5`}>SMART MONEY</span>
        </div>
        <div className={`flex items-center gap-3 text-[10px] ${MN} text-fg3`}>
          {stats && <>
            <span className="flex items-center gap-1">
              <span className={`w-1 h-1 rounded-full ${stats.wsConnected > 0 ? "bg-green" : "bg-red"}`} />
              WS {stats.wsConnected}/{stats.wsConnections}
            </span>
            <span>{Math.floor(stats.uptime / 60000)}m</span>
          </>}
        </div>
      </header>

      {!loading && <Pulse signals={signals} stats={stats} />}

      <div className="flex flex-1 min-h-0">
        <div className="w-[380px] shrink-0 border-r border-border flex flex-col bg-raised">
          <div className={`flex items-center gap-0.5 px-3 py-1.5 border-b border-border text-[10px] ${MN}`}>
            {(["all", "strong", "moderate", "ai"] as const).map(f => (
              <button key={f} onClick={() => setTab(f)}
                className={`px-2 py-0.5 rounded cursor-pointer transition-colors ${
                  tab === f ? (f === "ai" ? "bg-blue-dim text-blue" : "bg-surface text-fg") : "text-fg3 hover:text-fg"
                }`}>
                {f === "ai" ? "AI" : f === "all" ? "ALL" : f.toUpperCase()}
                <span className="ml-1 text-fg3">
                  {f === "all" ? signals.filter(s => s.strength !== "weak").length
                   : f === "ai" ? signals.filter(s => s.analysis).length
                   : signals.filter(s => s.strength === f).length}
                </span>
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading
              ? <div className={`p-4 text-xs ${MN} text-fg3`}>Loading...</div>
              : list.map(s => (
                <SignalItem key={s.coin} signal={s} selected={s.coin === coin} onSelect={() => setCoin(s.coin)} />
              ))
            }
          </div>
        </div>

        <div className="flex-1 bg-raised min-h-0 overflow-hidden">
          {sel ? <Detail signal={sel} /> : (
            <div className="h-full flex items-center justify-center">
              <p className={`text-xs ${MN} text-fg3`}>Select a signal</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
