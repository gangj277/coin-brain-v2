"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { IllustOnchain, IllustFunnel, IllustAI, IllustPnlChart, IllustConsensus, IllustDivergence, IllustEmerging, IllustPipeline, IllustTrust, IllustDashboard, IllustIndicator, IllustAutoTrade, IllustDataGrid } from "./components/illustrations";

const M = "font-[family-name:var(--font-geist-mono)]";

interface Signal {
  coin: string; type: string; strength: string; dominantSide: string; conviction: number;
  totalTraders: number; longTraders: number; shortTraders: number;
  totalValueUsd: number; longValueUsd: number; shortValueUsd: number;
  totalUnrealizedPnl: number; sTierCount: number; avgLeverage: number;
  analysis: { conclusion: string; sentiment: string; confidenceLevel: string; marketContext: string; positionAnalysis: string; riskAssessment: string } | null;
  market: { markPx: number; dayChange: number; funding: number; fundingAnnual: number; openInterestUsd: number; dayVolume: number } | null;
}
interface Stats { totalTraders: number; tradersWithPositions: number; totalPositions: number; wsConnected: number; wsConnections: number; totalChangesEmitted: number; }

function fmt(n: number) { if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`; if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}k`; return `$${n.toFixed(0)}`; }
function fpnl(n: number) { return `${n >= 0 ? "+" : ""}${fmt(n)}`; }

// ─── SVG Icons ───────────────────────────────────────────

function IconChain() {
  return <svg width="32" height="32" viewBox="0 0 32 32" fill="none"><path d="M13 19l6-6" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round"/><path d="M17.5 21.5l2-2a4.243 4.243 0 000-6l-1-1a4.243 4.243 0 00-6 0l-2 2" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round"/><path d="M14.5 10.5l-2 2a4.243 4.243 0 000 6l1 1a4.243 4.243 0 006 0l2-2" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round"/></svg>;
}
function IconFilter() {
  return <svg width="32" height="32" viewBox="0 0 32 32" fill="none"><path d="M8 10h16M11 16h10M14 22h4" stroke="#34d399" strokeWidth="2" strokeLinecap="round"/></svg>;
}
function IconBrain() {
  return <svg width="32" height="32" viewBox="0 0 32 32" fill="none"><path d="M16 8c-2 0-4 1-5 3s-1 4 0 6l5 7 5-7c1-2 1-4 0-6s-3-3-5-3z" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><circle cx="14" cy="14" r="1" fill="#fbbf24"/><circle cx="18" cy="14" r="1" fill="#fbbf24"/><path d="M13 17h6" stroke="#fbbf24" strokeWidth="1.5" strokeLinecap="round"/></svg>;
}
function IconShield() {
  return <svg width="40" height="40" viewBox="0 0 40 40" fill="none"><path d="M20 6l-10 4v8c0 7.5 4.3 13.5 10 16 5.7-2.5 10-8.5 10-16v-8l-10-4z" stroke="#34d399" strokeWidth="2" fill="rgba(52,211,153,0.06)"/><path d="M15 20l3 3 7-7" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
function IconSignal() {
  return <svg width="40" height="40" viewBox="0 0 40 40" fill="none"><rect x="8" y="24" width="5" height="8" rx="1" fill="rgba(52,211,153,0.3)"/><rect x="17" y="18" width="5" height="14" rx="1" fill="rgba(52,211,153,0.5)"/><rect x="26" y="10" width="5" height="22" rx="1" fill="#34d399"/></svg>;
}
function IconBot() {
  return <svg width="40" height="40" viewBox="0 0 40 40" fill="none"><rect x="10" y="14" width="20" height="16" rx="4" stroke="#22d3ee" strokeWidth="2"/><circle cx="16" cy="22" r="2" fill="#22d3ee"/><circle cx="24" cy="22" r="2" fill="#22d3ee"/><path d="M20 8v6M16 8h8" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round"/></svg>;
}

// ─── Nav ─────────────────────────────────────────────────

function Nav() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.04] bg-[#050508]/80 backdrop-blur-xl">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold tracking-tight"><span className="text-fg">coin</span><span className="text-green">brain</span></span>
          <span className={`text-[9px] ${M} text-fg3 border border-white/[0.06] rounded px-1.5 py-0.5 uppercase tracking-widest`}>Beta</span>
        </div>
        <Link href="/dashboard" className={`text-xs ${M} px-4 py-1.5 rounded-full bg-green text-[#050508] font-medium hover:bg-green/90 transition-colors`}>대시보드 열기</Link>
      </div>
    </nav>
  );
}

// ─── Hero ────────────────────────────────────────────────

function Hero() {
  return (
    <section className="relative min-h-screen flex items-end overflow-hidden pb-24 pt-32">
      {/* Background glow — offset to right */}
      <div className="absolute top-1/3 right-0 w-[800px] h-[800px] rounded-full opacity-[0.06]"
        style={{ background: "radial-gradient(circle, #22d3ee 0%, #34d399 30%, transparent 70%)", filter: "blur(120px)" }} />
      {/* Grid */}
      <div className="absolute inset-0 opacity-[0.025]"
        style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)", backgroundSize: "60px 60px" }} />

      <div className="relative z-10 max-w-6xl mx-auto px-6 w-full">
        <div className="grid grid-cols-[1fr_auto] gap-12 items-end">
          {/* Left: Text — left-aligned, asymmetric sizing */}
          <div style={{ animation: "fade-in-up 0.8s ease-out" }}>
            <div className={`inline-flex items-center gap-2 ${M} text-xs text-fg3 mb-8`}>
              <span className="relative flex h-1.5 w-1.5"><span className="absolute inset-0 rounded-full bg-green animate-ping opacity-75" /><span className="relative rounded-full h-1.5 w-1.5 bg-green" /></span>
              실시간 온체인 데이터
            </div>

            <h1 className="text-fg leading-[1.0] tracking-tight">
              <span className="block text-[clamp(3rem,7vw,5.5rem)] font-bold">스마트머니가</span>
              <span className="block text-[clamp(3rem,7vw,5.5rem)] font-bold mt-1">지금 <span className="text-green">뭘 하고</span></span>
              <span className="block text-[clamp(2rem,4vw,3rem)] font-light text-fg2 mt-3">있는지, 실시간으로.</span>
            </h1>

            <p className="mt-10 text-lg text-fg3 leading-relaxed max-w-lg">
              Hyperliquid 온체인에서 검증된 상위 300명 트레이더의
              포지션을 실시간 추적하고, AI가 해석합니다.
            </p>

            <div className="mt-10 flex items-center gap-4">
              <Link href="/dashboard" className={`${M} text-sm px-10 py-3.5 rounded-full bg-green text-[#050508] font-semibold hover:bg-green/90 transition-all hover:shadow-[0_0_40px_rgba(52,211,153,0.3)]`}>무료로 시작하기</Link>
              <a href="#how" className={`${M} text-sm px-10 py-3.5 rounded-full border border-white/[0.08] text-fg2 hover:text-fg hover:border-white/[0.15] transition-colors`}>자세히 보기 ↓</a>
            </div>
          </div>

          {/* Right: Radar visual */}
          <div className="relative w-[420px] h-[420px] shrink-0" aria-hidden>
            {/* Radar SVG */}
            <svg width="420" height="420" viewBox="0 0 420 420" fill="none" className="absolute inset-0">
              {/* Rings */}
              <circle cx="210" cy="210" r="50" stroke="#22d3ee" strokeWidth="0.5" opacity="0.1" style={{ animation: "radar-pulse 4s ease-in-out infinite" }} />
              <circle cx="210" cy="210" r="75" stroke="#34d399" strokeWidth="0.5" opacity="0.07" style={{ animation: "radar-pulse-2 5s ease-in-out infinite" }} />
              <circle cx="210" cy="210" r="60" stroke="#22d3ee" strokeWidth="0.3" opacity="0.08" strokeDasharray="3 6" />
              <circle cx="210" cy="210" r="110" stroke="#34d399" strokeWidth="0.3" opacity="0.06" strokeDasharray="3 9" />
              <circle cx="210" cy="210" r="160" stroke="#22d3ee" strokeWidth="0.3" opacity="0.04" strokeDasharray="3 12" />
              <circle cx="210" cy="210" r="200" stroke="#34d399" strokeWidth="0.3" opacity="0.03" strokeDasharray="3 15" />
              {/* Sweep */}
              <g style={{ transformOrigin: "210px 210px", animation: "radar-spin 8s linear infinite" }}>
                <line x1="210" y1="210" x2="210" y2="20" stroke="url(#sweep-grad)" strokeWidth="1.5" />
              </g>
              {/* Core */}
              <circle cx="210" cy="210" r="4" fill="#34d399" />
              <circle cx="210" cy="210" r="10" fill="#34d399" opacity="0.15" />
              {/* Orbiting dots */}
              <g style={{ transformOrigin: "210px 210px", animation: "radar-spin 10s linear infinite" }}>
                <circle cx="210" cy="110" r="3.5" fill="#34d399" opacity="0.8" />
                <circle cx="210" cy="110" r="7" fill="#34d399" opacity="0.12" />
              </g>
              <g style={{ transformOrigin: "210px 210px", animation: "radar-spin 16s linear infinite reverse" }}>
                <circle cx="210" cy="140" r="2.5" fill="#22d3ee" opacity="0.7" />
              </g>
              <g style={{ transformOrigin: "210px 210px", animation: "radar-spin 22s linear infinite" }}>
                <circle cx="210" cy="70" r="2" fill="#fbbf24" opacity="0.6" />
              </g>
              <g style={{ transformOrigin: "210px 210px", animation: "radar-spin 14s linear infinite reverse" }}>
                <circle cx="210" cy="170" r="2" fill="#f87171" opacity="0.5" />
              </g>
              <defs>
                <linearGradient id="sweep-grad" x1="210" y1="210" x2="210" y2="20" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#34d399" stopOpacity="0.25" />
                  <stop offset="1" stopColor="#34d399" stopOpacity="0" />
                </linearGradient>
              </defs>
            </svg>

            {/* Floating signal cards around radar */}
            <div className="absolute -top-2 right-4" style={{ animation: "float-card 6s ease-in-out infinite" }}>
              <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border border-green/20 bg-[#050508]/90 backdrop-blur text-xs ${M}`}>
                <span className="text-green text-sm">▲</span>
                <span className="text-fg font-semibold">BTC</span>
                <span className="text-green">LONG</span>
                <span className="text-fg3">88%</span>
              </div>
            </div>

            <div className="absolute top-16 -left-16" style={{ animation: "float-card-slow 7s ease-in-out infinite 1s" }}>
              <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border border-red/20 bg-[#050508]/90 backdrop-blur text-xs ${M}`}>
                <span className="text-red text-sm">▼</span>
                <span className="text-fg font-semibold">ENA</span>
                <span className="text-red">SHORT</span>
                <span className="text-fg3">100%</span>
              </div>
            </div>

            <div className="absolute bottom-12 -right-8" style={{ animation: "float-card 8s ease-in-out infinite 2s" }}>
              <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border border-amber/20 bg-[#050508]/90 backdrop-blur text-xs ${M}`}>
                <span className="text-amber text-sm">◆</span>
                <span className="text-fg font-semibold">HYPE</span>
                <span className="text-amber">SPLIT</span>
                <span className="text-fg3">$35M</span>
              </div>
            </div>

            <div className="absolute bottom-36 -left-20" style={{ animation: "float-card-slow 9s ease-in-out infinite 3s" }}>
              <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border border-green/15 bg-[#050508]/90 backdrop-blur text-xs ${M}`}>
                <span className="text-green text-sm">▲</span>
                <span className="text-fg font-semibold">SOL</span>
                <span className="text-green">+$4.7M</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Live Ticker ─────────────────────────────────────────

function Ticker({ signals }: { signals: Signal[] }) {
  const top = signals.filter(s => s.strength === "strong").slice(0, 12);
  if (top.length === 0) return null;
  const items = [...top, ...top];
  return (
    <div className="border-y border-white/[0.04] bg-raised overflow-hidden">
      <div className="flex animate-[ticker_40s_linear_infinite] hover:[animation-play-state:paused]">
        {items.map((s, i) => (
          <div key={`${s.coin}-${i}`} className={`flex items-center gap-3 px-6 py-3 shrink-0 border-r border-white/[0.04] text-xs ${M}`}>
            <span className="font-semibold text-fg">{s.coin}</span>
            <span className={s.dominantSide === "LONG" ? "text-green" : s.dominantSide === "SHORT" ? "text-red" : "text-amber"}>
              {s.dominantSide === "LONG" ? "▲" : s.dominantSide === "SHORT" ? "▼" : "◆"}
            </span>
            <span className="text-fg2">{fmt(s.totalValueUsd)}</span>
            <span className={s.totalUnrealizedPnl >= 0 ? "text-green" : "text-red"}>{fpnl(s.totalUnrealizedPnl)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Market Bias ─────────────────────────────────────────

function Bias({ signals, stats }: { signals: Signal[]; stats: Stats | null }) {
  const tl = signals.reduce((a, s) => a + s.longValueUsd, 0);
  const ts = signals.reduce((a, s) => a + s.shortValueUsd, 0);
  const tv = tl + ts; const lb = tv > 0 ? (tl / tv) * 100 : 50;
  const tp = signals.reduce((a, s) => a + s.totalUnrealizedPnl, 0);
  return (
    <div className="border-b border-white/[0.04] bg-[#08080e]">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-8">
        <div className="flex items-center gap-3">
          <span className={`text-xs ${M} text-fg3`}>BIAS</span>
          <span className={`text-lg font-semibold ${M} ${lb > 55 ? "text-green" : lb < 45 ? "text-red" : "text-fg"}`}>{lb.toFixed(0)}%</span>
          <span className={`text-xs ${M} text-fg3`}>long</span>
          <div className="w-32 ratio-bar h-[3px]"><span style={{ width: `${lb}%` }} /></div>
        </div>
        <div className="flex items-center gap-2"><span className={`text-xs ${M} text-fg3`}>TRACKED</span><span className={`text-sm font-semibold ${M}`}>{fmt(tv)}</span></div>
        <div className="flex items-center gap-2"><span className={`text-xs ${M} text-fg3`}>PNL</span><span className={`text-sm font-semibold ${M} ${tp >= 0 ? "text-green" : "text-red"}`}>{fpnl(tp)}</span></div>
        {stats && <div className="ml-auto flex items-center gap-2">
          <span className="relative flex h-1.5 w-1.5"><span className="absolute inset-0 rounded-full bg-green animate-ping opacity-75" /><span className="relative rounded-full h-1.5 w-1.5 bg-green" /></span>
          <span className={`text-xs ${M} text-fg3`}>{stats.tradersWithPositions} traders · {stats.totalPositions} positions</span>
        </div>}
      </div>
    </div>
  );
}

// ─── Differentiators ─────────────────────────────────────

function Differentiators() {
  const items = [
    { illust: <IllustOnchain />, title: "온체인이라 거짓말을 못 합니다", desc: "텔레그램 시그널방은 조작 가능합니다. Hyperliquid 블록체인에 기록된 데이터는 조작이 불가능합니다. 모든 포지션, 진입가, 청산가가 온체인에서 검증 가능합니다.", accent: "border-cyan/20" },
    { illust: <IllustFunnel />, title: "32,828명 중 상위 1%만 추적", desc: "올타임 PnL, 월간 수익률, 최대 드로다운, 거래 일관성을 기반으로 다단계 스코어링합니다. S-tier 트레이더는 올타임 수익 $50M 이상입니다.", accent: "border-green/20" },
    { illust: <IllustAI />, title: "포지션이 아니라, 해석을 드립니다", desc: "AI가 펀딩레이트, 미결제약정, 24시간 가격 변동과 트레이더 포지션을 교차 분석하여 Market · Position · Risk 3단계 구조화 리포트를 생성합니다.", accent: "border-amber/20" },
  ];
  return (
    <section className="py-28 border-t border-white/[0.04]">
      <div className="max-w-5xl mx-auto px-6">
        <div className={`text-xs ${M} text-fg3 uppercase tracking-widest mb-4`}>Why Coin Brain</div>
        <h2 className="text-4xl font-bold tracking-tight text-fg mb-16">시그널이 아니라, <span className="text-green">근거</span>를 드립니다</h2>
        <div className="grid grid-cols-3 gap-6">
          {items.map((item) => (
            <div key={item.title} className={`rounded-xl border ${item.accent} bg-raised p-8 flex flex-col items-center text-center`}>
              <div className="mb-6">{item.illust}</div>
              <h3 className="text-lg font-semibold text-fg mb-3 leading-snug">{item.title}</h3>
              <p className="text-sm text-fg2 leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── S-tier Trader Showcase ──────────────────────────────

function TraderShowcase({ signals }: { signals: Signal[] }) {
  // Extract unique top-performing stats from signals
  const totalCapital = signals.reduce((a, s) => a + s.totalValueUsd, 0);
  const totalPnl = signals.reduce((a, s) => a + s.totalUnrealizedPnl, 0);
  const sTierSignals = signals.filter(s => s.sTierCount >= 2);

  const traders = [
    { label: "S-tier #1", pnl: "$201.6M", roi: "+199.7%", acct: "$79.9M", positions: 86, desc: "86개 동시 포지션을 운용하는 멀티 전략 트레이더" },
    { label: "S-tier #2", pnl: "$65.3M", roi: "+1,212%", acct: "$32.1M", positions: 158, desc: "158개 포지션으로 전 시장을 커버하는 시스템 트레이더" },
    { label: "S-tier #3", pnl: "$45.2M", roi: "+614%", acct: "$40.3M", positions: 24, desc: "높은 Conviction으로 집중 투자하는 고확신 트레이더" },
  ];

  return (
    <section className="py-28 border-t border-white/[0.04] relative overflow-hidden">
      <div className="absolute top-0 right-0 w-[500px] h-[500px] opacity-[0.03]"
        style={{ background: "radial-gradient(circle, #fbbf24, transparent 70%)", filter: "blur(100px)" }} />
      <div className="max-w-5xl mx-auto px-6 relative z-10">
        <div className={`text-xs ${M} text-fg3 uppercase tracking-widest mb-4`}>Verified Traders</div>
        <h2 className="text-4xl font-bold tracking-tight text-fg mb-4">
          온체인에서 <span className="text-amber">검증된</span> 실적
        </h2>
        <p className="text-fg2 text-lg mb-16 max-w-2xl">
          아래 수치는 Hyperliquid 블록체인에서 직접 조회한 실제 데이터입니다. 누구나 온체인에서 검증할 수 있습니다.
        </p>

        <div className="grid grid-cols-3 gap-6 mb-12">
          {traders.map((t) => (
            <div key={t.label} className="rounded-xl border border-amber/10 bg-raised p-6 shadow-[inset_0_0_30px_rgba(251,191,36,0.02)]">
              <div className={`text-[10px] ${M} text-amber uppercase tracking-widest mb-4`}>{t.label}</div>
              <div className={`text-3xl font-bold ${M} text-fg mb-1`}>{t.pnl}</div>
              <div className={`text-sm ${M} text-green mb-3`}>All-time PnL · ROI {t.roi}</div>
              <div className="mb-4 -mx-2"><IllustPnlChart /></div>
              <div className={`flex gap-4 text-xs ${M} text-fg3 mb-3`}>
                <span>Account {t.acct}</span>
                <span>{t.positions} positions</span>
              </div>
              <p className="text-sm text-fg2">{t.desc}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-center gap-2 text-sm text-fg3">
          <IconShield />
          <span>모든 데이터는 Hyperliquid 블록체인에서 실시간 검증 가능합니다</span>
        </div>
      </div>
    </section>
  );
}

// ─── Signal Catalog ──────────────────────────────────────

function SignalCatalog() {
  const types = [
    { illust: <IllustConsensus />, bg: "bg-green/[0.06] border-green/20", glow: "shadow-[inset_0_0_30px_rgba(52,211,153,0.03)]", color: "text-green", title: "컨센서스 시그널", desc: "70% 이상의 트레이더가 같은 방향으로 포지션을 잡았을 때 발생합니다. 스마트머니의 강한 방향성 확신을 의미합니다.", example: "예: 12명의 S-tier 중 11명이 BTC LONG → 강한 상승 컨센서스", metric: "Conviction 80%+" },
    { illust: <IllustDivergence />, bg: "bg-amber/[0.06] border-amber/20", glow: "shadow-[inset_0_0_30px_rgba(251,191,36,0.03)]", color: "text-amber", title: "다이버전스 시그널", desc: "탑 트레이더들의 의견이 갈리는 구간입니다. 큰 변동성이 예상되며, 양쪽의 근거를 AI가 분석합니다.", example: "예: HYPE에 롱 $18M vs 숏 $17M → 팽팽한 줄다리기", metric: "양방향 35-65%" },
    { illust: <IllustEmerging />, bg: "bg-cyan/[0.06] border-cyan/20", glow: "shadow-[inset_0_0_30px_rgba(34,211,238,0.03)]", color: "text-cyan", title: "이머징 시그널", desc: "소수의 S-tier 트레이더가 새로운 포지션을 열기 시작한 초기 단계입니다. 얼리 시그널로 활용할 수 있습니다.", example: "예: S-tier 2명이 ASTER 숏 진입 → 초기 하락 베팅", metric: "3명 이상 동시 진입" },
  ];

  return (
    <section className="py-28 border-t border-white/[0.04]">
      <div className="max-w-5xl mx-auto px-6">
        <div className="flex items-center gap-3 mb-4">
          <span className={`text-xs ${M} text-fg3 uppercase tracking-widest`}>Signal-Based Indicators</span>
          <span className={`text-[10px] ${M} px-2.5 py-1 rounded-full bg-cyan/10 text-cyan border border-cyan/20`}>COMING SOON</span>
        </div>
        <h2 className="text-4xl font-bold tracking-tight text-fg mb-4">
          시그널 유형 기반 <span className="text-cyan">보조지표</span>
        </h2>
        <p className="text-fg2 text-lg mb-16 max-w-2xl">
          세 가지 시그널 유형을 기반으로 실전 매매에 활용할 수 있는 보조지표를 개발하고 있습니다.
        </p>
        <div className="grid grid-cols-3 gap-6">
          {types.map((t) => (
            <div key={t.title} className={`rounded-xl border ${t.bg} ${t.glow} p-8 flex flex-col items-center text-center`}>
              <div className="mb-6">{t.illust}</div>
              <h3 className="text-lg font-semibold text-fg mb-3">{t.title}</h3>
              <p className="text-sm text-fg2 leading-relaxed mb-4">{t.desc}</p>
              <div className={`text-xs ${M} text-fg3 bg-white/[0.03] rounded-lg px-3 py-2 mb-3 w-full`}>{t.example}</div>
              <div className={`text-[11px] ${M} ${t.color}`}>{t.metric}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Consensus Map ───────────────────────────────────────

function ConsensusMap({ signals }: { signals: Signal[] }) {
  const top = signals.filter(s => s.strength !== "weak" && s.totalTraders >= 3).slice(0, 20);
  return (
    <section className="py-24 border-t border-white/[0.04]">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-14">
          <div className={`text-xs ${M} text-fg3 uppercase tracking-widest mb-4`}>Live Consensus</div>
          <h2 className="text-3xl font-bold tracking-tight text-fg">스마트머니가 <span className="text-cyan">어디에</span> 몰리고 있는가</h2>
          <p className={`text-sm ${M} text-fg3 mt-3`}>실시간 데이터 · 15초마다 갱신</p>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {top.map((s) => {
            const lp = s.totalValueUsd > 0 ? s.longValueUsd / s.totalValueUsd : 0.5;
            const isL = lp > 0.6; const isS = lp < 0.4;
            return (
              <div key={s.coin} className={`rounded-lg border p-3 transition-all hover:scale-[1.02] ${isL ? "bg-green/[0.06] border-green/20" : isS ? "bg-red/[0.06] border-red/20" : "bg-white/[0.02] border-white/[0.06]"}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold">{s.coin}</span>
                  <span className={`text-[10px] ${M} ${isL ? "text-green" : isS ? "text-red" : "text-fg3"}`}>{(lp * 100).toFixed(0)}%L</span>
                </div>
                <div className="ratio-bar w-full h-[3px] rounded mb-2"><span style={{ width: `${lp * 100}%` }} /></div>
                <div className={`flex justify-between text-[10px] ${M}`}>
                  <span className="text-fg3">{s.totalTraders}</span>
                  <span className={s.totalUnrealizedPnl >= 0 ? "text-green" : "text-red"}>{fpnl(s.totalUnrealizedPnl)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ─── Live Dashboard Preview ──────────────────────────────

function LivePreview({ signals }: { signals: Signal[] }) {
  const top = signals.filter(s => s.strength === "strong").slice(0, 7);
  const f = top[0]; if (!f) return null;
  return (
    <section className="py-24 border-t border-white/[0.04] relative overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] opacity-[0.04]"
        style={{ background: "radial-gradient(ellipse, #22d3ee, transparent 70%)", filter: "blur(80px)" }} />
      <div className="max-w-6xl mx-auto px-6 relative z-10">
        <div className="text-center mb-14">
          <div className={`text-xs ${M} text-fg3 uppercase tracking-widest mb-4`}>Live Dashboard</div>
          <h2 className="text-3xl font-bold tracking-tight text-fg">실시간 <span className="text-cyan">트레이딩 인텔리전스</span></h2>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-raised overflow-hidden shadow-2xl shadow-black/50">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.04] bg-[#08080e]">
            <div className="flex gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-white/[0.06]" /><div className="w-2.5 h-2.5 rounded-full bg-white/[0.06]" /><div className="w-2.5 h-2.5 rounded-full bg-white/[0.06]" /></div>
            <span className={`text-[10px] ${M} text-fg3 ml-2`}>coinbrain</span>
            <div className="ml-auto flex items-center gap-1.5"><span className="relative flex h-1.5 w-1.5"><span className="absolute inset-0 rounded-full bg-green animate-ping opacity-75" /><span className="relative rounded-full h-1.5 w-1.5 bg-green" /></span><span className={`text-[10px] ${M} text-green`}>LIVE</span></div>
          </div>
          <div className="grid grid-cols-[320px_1fr] min-h-[400px]">
            <div className="border-r border-white/[0.04]">
              {top.map((s, i) => (
                <div key={s.coin} className={`flex items-center justify-between px-3 py-2.5 border-b border-white/[0.03] text-xs ${M} ${i === 0 ? "bg-white/[0.02]" : ""}`}>
                  <div className="flex items-center gap-2">
                    <span className={`w-0.5 h-4 rounded ${s.dominantSide === "LONG" ? "bg-green" : s.dominantSide === "SHORT" ? "bg-red" : "bg-amber"}`} />
                    <span className="font-semibold text-fg w-14">{s.coin}</span>
                    <span className={`text-[10px] ${s.conviction >= 80 ? "text-green" : "text-fg3"}`}>{s.conviction}%</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-fg2">{fmt(s.totalValueUsd)}</span>
                    <span className={s.totalUnrealizedPnl >= 0 ? "text-green" : "text-red"}>{fpnl(s.totalUnrealizedPnl)}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2"><span className="text-xl font-semibold">{f.coin}</span>
                    <span className={`text-xs ${M} font-semibold ${f.dominantSide === "LONG" ? "text-green" : f.dominantSide === "SHORT" ? "text-red" : "text-amber"}`}>{f.dominantSide}</span>
                    {f.analysis && <span className={`text-[10px] ${M} px-1.5 py-0.5 rounded ${f.analysis.sentiment === "bullish" ? "bg-green-dim text-green" : f.analysis.sentiment === "bearish" ? "bg-red-dim text-red" : "bg-amber-dim text-amber"}`}>{f.analysis.sentiment}</span>}
                  </div>
                  {f.market && <div className={`text-xs ${M} text-fg3 mt-1`}>${f.market.markPx.toLocaleString()} <span className={f.market.dayChange >= 0 ? "text-green" : "text-red"}>{f.market.dayChange >= 0 ? "+" : ""}{f.market.dayChange.toFixed(1)}%</span></div>}
                </div>
                <div className="text-right"><div className={`text-lg font-semibold ${M}`}>{fmt(f.totalValueUsd)}</div><div className={`text-xs ${M} ${f.totalUnrealizedPnl >= 0 ? "text-green" : "text-red"}`}>{fpnl(f.totalUnrealizedPnl)}</div></div>
              </div>
              {f.market && <div className={`flex gap-4 text-[11px] ${M} px-3 py-2 rounded bg-[#08080e] mb-4`}>
                <span><span className="text-fg3">Funding </span><span className={f.market.funding >= 0 ? "text-green" : "text-red"}>{(f.market.funding * 100).toFixed(4)}%</span></span>
                <span><span className="text-fg3">OI </span>{fmt(f.market.openInterestUsd)}</span>
                <span><span className="text-fg3">Vol </span>{fmt(f.market.dayVolume)}</span>
              </div>}
              {f.analysis && <>
                <p className="text-[13px] text-fg leading-relaxed mb-4">{f.analysis.conclusion}</p>
                <div className="space-y-2">
                  {([{ l: "Market", c: "text-cyan", d: "bg-cyan", t: f.analysis.marketContext }, { l: "Position", c: "text-blue", d: "bg-blue", t: f.analysis.positionAnalysis }, { l: "Risk", c: "text-amber", d: "bg-amber", t: f.analysis.riskAssessment }]).map(s => (
                    <div key={s.l} className={`flex items-center gap-2 text-xs ${M} ${s.c} py-1`}><span className={`w-1 h-1 rounded-full ${s.d} shrink-0`} /><span className="shrink-0">{s.l}</span><span className="text-fg3 text-[11px] truncate">{s.t.slice(0, 70)}…</span></div>
                  ))}
                </div>
              </>}
            </div>
          </div>
        </div>
        <div className="text-center mt-8"><Link href="/dashboard" className={`text-sm ${M} text-fg3 hover:text-fg transition-colors`}>실제 대시보드에서 확인하기 →</Link></div>
      </div>
    </section>
  );
}

// ─── How It Works ────────────────────────────────────────

function HowItWorks() {
  const steps = [
    { n: "01", label: "수집", title: "온체인 데이터 실시간 수집", desc: "Hyperliquid 블록체인에서 32,828명 트레이더의 포지션, 거래 내역, 포트폴리오 성과를 실시간으로 수집합니다.", tag: "WebSocket 5개 + REST Polling" },
    { n: "02", label: "스코어링", title: "다단계 필터링 & 랭킹", desc: "올타임 PnL, 월간 수익률, 드로다운, Conviction 등을 가중 평가하여 S/A/B 티어로 분류합니다.", tag: "32,828 → 300명 필터링" },
    { n: "03", label: "해석", title: "AI 구조화 분석", desc: "펀딩레이트, 미결제약정, 가격 변동과 트레이더 포지션을 교차 분석하여 Market · Position · Risk 3단계 리포트를 생성합니다.", tag: "시장 데이터 교차 분석" },
  ];
  return (
    <section id="how" className="py-28 border-t border-white/[0.04]">
      <div className="max-w-5xl mx-auto px-6">
        <div className={`text-xs ${M} text-fg3 uppercase tracking-widest mb-4`}>How it works</div>
        <h2 className="text-4xl font-bold tracking-tight text-fg mb-8">데이터에서 <span className="text-cyan">인사이트</span>까지</h2>
        {/* Pipeline illustration */}
        <div className="flex justify-center mb-16 overflow-hidden"><IllustPipeline /></div>
        <div className="grid grid-cols-3 gap-8">
          {steps.map(s => (
            <div key={s.n}>
              <div className={`text-xs ${M} text-green uppercase tracking-widest mb-6`}>{s.label}</div>
              <div className="border-t border-green/20 pt-6">
                <span className={`text-5xl font-light ${M} text-fg3/20`}>{s.n}</span>
                <h3 className="text-lg font-semibold text-fg mt-4 mb-3">{s.title}</h3>
                <p className="text-sm text-fg2 leading-relaxed mb-4">{s.desc}</p>
                <div className={`inline-flex text-[11px] ${M} text-cyan bg-cyan-dim px-2.5 py-1 rounded`}>{s.tag}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Roadmap ─────────────────────────────────────────────

function Roadmap() {
  const phases = [
    { phase: "NOW", badge: "LIVE", bc: "bg-green text-[#050508]", border: "border-green/30", glow: "shadow-[inset_0_0_30px_rgba(52,211,153,0.04)]", icon: <IllustDashboard />, title: "스마트머니 분석 대시보드", desc: "실시간 포지션 추적과 AI 분석 리포트", features: ["실시간 포지션 트래킹", "Conviction 기반 시그널 클러스터링", "AI 구조화 분석 리포트", "펀딩레이트·OI·거래량 교차 분석"] },
    { phase: "NEXT", badge: "COMING SOON", bc: "bg-cyan/10 text-cyan border border-cyan/20", border: "border-cyan/20", glow: "", icon: <IllustIndicator />, title: "트레이딩 보조 지표", desc: "실전 매매에 활용 가능한 인디케이터", features: ["스마트머니 유입/유출 인디케이터", "Conviction 기반 매수/매도 시그널", "S-tier 포지션 변화 알림", "멀티 타임프레임 컨센서스"] },
    { phase: "FUTURE", badge: "PLANNED", bc: "bg-white/5 text-fg3 border border-white/[0.06]", border: "border-white/[0.06]", glow: "", icon: <IllustAutoTrade />, title: "스마트머니 기반 자동매매", desc: "검증된 트레이더를 자동으로 팔로우", features: ["S-tier 트레이더 자동 팔로우", "리스크 관리 자동화", "멀티 트레이더 포트폴리오 복제", "백테스팅 기반 전략 검증"] },
  ];
  return (
    <section className="py-28 border-t border-white/[0.04] relative overflow-hidden">
      <div className="max-w-5xl mx-auto px-6 relative z-10">
        <div className={`text-xs ${M} text-fg3 uppercase tracking-widest mb-4`}>Product Roadmap</div>
        <h2 className="text-4xl font-bold tracking-tight text-fg mb-4">분석에서 <span className="text-cyan">실전 매매</span>까지</h2>
        <p className="text-fg2 text-lg mb-16 max-w-2xl">동일한 온체인 인프라 위에 보조 지표와 자동매매 시스템을 구축합니다.</p>
        <div className="grid grid-cols-3 gap-6">
          {phases.map(p => (
            <div key={p.phase} className={`rounded-xl border ${p.border} bg-raised p-7 ${p.glow}`}>
              <div className="flex items-center justify-between mb-5">
                {p.icon}
                <span className={`text-[10px] ${M} px-2.5 py-1 rounded-full ${p.bc}`}>{p.badge}</span>
              </div>
              <h3 className="text-lg font-semibold text-fg mb-2">{p.title}</h3>
              <p className="text-sm text-fg3 mb-5">{p.desc}</p>
              <ul className="space-y-2.5">{p.features.map((f, i) => <li key={i} className="flex items-start gap-2 text-sm text-fg2"><span className="mt-1.5 w-1 h-1 rounded-full bg-fg3/30 shrink-0" />{f}</li>)}</ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Why Free ────────────────────────────────────────────

function WhyFree() {
  return (
    <section className="py-28 border-t border-white/[0.04]">
      <div className="max-w-5xl mx-auto px-6">
        <div className="grid grid-cols-[1fr_auto] gap-16 items-center">
          <div>
            <div className={`text-xs ${M} text-green uppercase tracking-widest mb-6`}>Why Free?</div>
            <h2 className="text-3xl font-bold tracking-tight text-fg mb-8">왜 무료로 제공하나요?</h2>
            <div className="space-y-6 text-lg text-fg2 leading-relaxed">
              <p>대부분의 시그널 서비스는 체험판을 제공하지 않습니다.<br />
                <span className="text-fg font-medium">자신이 없기 때문입니다.</span></p>
              <p>Coin Brain은 다릅니다. 우리의 데이터는 <span className="text-cyan font-medium">Hyperliquid 블록체인에서 직접 가져온 온체인 팩트</span>입니다.<br />
                조작할 수 없고, 누구나 검증할 수 있습니다.</p>
              <p>의심되시나요? 좋습니다.<br />
                <span className="text-green font-medium">직접 확인해보세요. 무료입니다.</span></p>
            </div>
            <div className="mt-10">
              <Link href="/dashboard" className={`inline-flex ${M} text-sm px-10 py-4 rounded-full bg-green text-[#050508] font-semibold hover:bg-green/90 transition-all hover:shadow-[0_0_40px_rgba(52,211,153,0.25)]`}>
                무료로 시작하기
              </Link>
            </div>
          </div>
          <div className="shrink-0">
            <IllustTrust />
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Trust Numbers ───────────────────────────────────────

function TrustNumbers({ signals, stats }: { signals: Signal[]; stats: Stats | null }) {
  const tv = signals.reduce((a, s) => a + s.totalValueUsd, 0);
  const numbers = [
    { value: stats ? `${stats.totalTraders}` : "300+", label: "검증된 트레이더", sub: "S/A/B 티어 분류" },
    { value: stats ? `${stats.totalPositions}` : "1,800+", label: "실시간 포지션", sub: "매 순간 추적" },
    { value: fmt(tv || 180_000_000), label: "추적 자본", sub: "합산 포지션 가치" },
    { value: "<1s", label: "지연 시간", sub: "WebSocket 실시간" },
  ];
  return (
    <section className="py-24 border-t border-white/[0.04] relative overflow-hidden">
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-full h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(52,211,153,0.2), transparent)" }} />
      {/* Background data grid decoration */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"><IllustDataGrid /></div>
      <div className="max-w-5xl mx-auto px-6 relative z-10">
        <div className="text-center mb-16"><h2 className="text-3xl font-bold tracking-tight text-fg">숫자가 <span className="text-green">증명</span>합니다</h2></div>
        <div className="grid grid-cols-4 gap-8">
          {numbers.map(s => (
            <div key={s.label} className="text-center">
              <div className={`text-5xl font-bold ${M} text-fg tracking-tight`}>{s.value}</div>
              <div className="text-base text-fg2 mt-3">{s.label}</div>
              <div className={`text-xs ${M} text-fg3 mt-1`}>{s.sub}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Contact Modal ───────────────────────────────────────

function ContactModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [sent, setSent] = useState(false);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      {/* Modal */}
      <div className="relative w-full max-w-md mx-4 rounded-2xl border border-white/[0.06] bg-raised shadow-2xl shadow-black/50 overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold text-fg">문의 & 피드백</h3>
            <p className="text-sm text-fg3 mt-1">연락처를 남겨주시면 빠르게 답변드리겠습니다</p>
          </div>
          <button onClick={onClose} className="text-fg3 hover:text-fg transition-colors p-1 cursor-pointer">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>

        {sent ? (
          <div className="px-6 pb-8 text-center py-8">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none" className="mx-auto mb-4">
              <circle cx="24" cy="24" r="20" stroke="#34d399" strokeWidth="2" fill="rgba(52,211,153,0.06)" />
              <path d="M16 24l5 5 11-11" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="text-fg font-medium text-lg mb-1">전송 완료!</p>
            <p className="text-fg3 text-sm">빠른 시일 내에 연락드리겠습니다</p>
          </div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); setSent(true); }} className="px-6 pb-6 space-y-4">
            <div>
              <label className={`block text-xs ${M} text-fg3 mb-1.5`}>이름</label>
              <input type="text" required placeholder="홍길동" className={`w-full px-4 py-2.5 rounded-lg bg-surface border border-white/[0.06] text-fg text-sm placeholder:text-fg3/50 focus:outline-none focus:border-green/30 transition-colors ${M}`} />
            </div>
            <div>
              <label className={`block text-xs ${M} text-fg3 mb-1.5`}>이메일</label>
              <input type="email" required placeholder="email@example.com" className={`w-full px-4 py-2.5 rounded-lg bg-surface border border-white/[0.06] text-fg text-sm placeholder:text-fg3/50 focus:outline-none focus:border-green/30 transition-colors ${M}`} />
            </div>
            <div>
              <label className={`block text-xs ${M} text-fg3 mb-1.5`}>메시지 <span className="text-fg3/50">(선택)</span></label>
              <textarea rows={3} placeholder="궁금한 점이나 피드백을 남겨주세요" className={`w-full px-4 py-2.5 rounded-lg bg-surface border border-white/[0.06] text-fg text-sm placeholder:text-fg3/50 focus:outline-none focus:border-green/30 transition-colors resize-none ${M}`} />
            </div>
            <button type="submit" className={`w-full py-3 rounded-lg bg-green text-[#050508] font-semibold text-sm hover:bg-green/90 transition-all cursor-pointer ${M}`}>
              보내기
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── SVG: Telegram, Mail ─────────────────────────────────

function IconTelegram() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M21.2 4.4L2.4 11.5c-.6.2-.6.6 0 .8l4.6 1.5 1.8 5.6c.2.5.7.5 1 .2l2.5-2.1 4.8 3.5c.5.4 1 .2 1.1-.4L21.8 5.2c.2-.8-.3-1.1-.6-.8z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.8 13.5l9.8-7.8" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.5" />
    </svg>
  );
}

function IconMail() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="5" width="18" height="14" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 8l9 5 9-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// ─── Final CTA ───────────────────────────────────────────

function FinalCTA({ onContact }: { onContact: () => void }) {
  return (
    <section className="py-32 border-t border-white/[0.04] relative overflow-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] opacity-[0.04]" style={{ background: "radial-gradient(ellipse, #34d399, transparent 70%)", filter: "blur(80px)" }} />
      <div className="relative z-10 max-w-3xl mx-auto px-6 text-center">
        <h2 className="text-5xl font-bold tracking-tight text-fg mb-8">지금 스마트머니를<br />확인하세요</h2>
        <p className="text-fg2 text-xl mb-12">검증된 트레이더가 어떤 포지션을 잡고 있는지,<br />왜 그런 판단을 했는지 실시간으로 확인하세요.</p>

        <div className="flex items-center justify-center gap-4 mb-8">
          <Link href="/dashboard" className={`inline-flex ${M} text-base px-12 py-4 rounded-full bg-green text-[#050508] font-semibold hover:bg-green/90 transition-all hover:shadow-[0_0_50px_rgba(52,211,153,0.3)]`}>
            대시보드 바로가기
          </Link>
        </div>

        {/* Telegram + Contact */}
        <div className="flex items-center justify-center gap-4">
          <a
            href="https://t.me/coinbrain_community"
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-2 ${M} text-sm px-6 py-3 rounded-full border border-cyan/20 text-cyan hover:bg-cyan/[0.06] transition-all`}
          >
            <IconTelegram />
            텔레그램 커뮤니티
          </a>
          <button
            onClick={onContact}
            className={`inline-flex items-center gap-2 ${M} text-sm px-6 py-3 rounded-full border border-white/[0.08] text-fg2 hover:text-fg hover:border-white/[0.15] transition-colors cursor-pointer`}
          >
            <IconMail />
            문의하기
          </button>
        </div>
      </div>
    </section>
  );
}

// ─── Footer ──────────────────────────────────────────────

function Footer({ onContact }: { onContact: () => void }) {
  return (
    <footer className="border-t border-white/[0.04] py-12">
      <div className="max-w-5xl mx-auto px-6">
        <div className="flex items-start justify-between">
          <div>
            <span className="text-sm font-semibold tracking-tight"><span className="text-fg">coin</span><span className="text-green">brain</span></span>
            <p className={`text-xs ${M} text-fg3 mt-2`}>Powered by Hyperliquid on-chain data</p>
          </div>
          <div className="flex gap-8">
            <div>
              <div className={`text-[10px] ${M} text-fg3 uppercase tracking-widest mb-3`}>Product</div>
              <div className="space-y-2">
                <Link href="/dashboard" className={`block text-sm text-fg2 hover:text-fg transition-colors`}>대시보드</Link>
                <a href="#how" className={`block text-sm text-fg2 hover:text-fg transition-colors`}>작동 방식</a>
              </div>
            </div>
            <div>
              <div className={`text-[10px] ${M} text-fg3 uppercase tracking-widest mb-3`}>Community</div>
              <div className="space-y-2">
                <a href="https://t.me/coinbrain_community" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-sm text-fg2 hover:text-cyan transition-colors">
                  <IconTelegram />
                  Telegram
                </a>
                <button onClick={onContact} className={`flex items-center gap-1.5 text-sm text-fg2 hover:text-fg transition-colors cursor-pointer`}>
                  <IconMail />
                  문의하기
                </button>
              </div>
            </div>
          </div>
        </div>
        <div className={`mt-8 pt-6 border-t border-white/[0.04] text-xs ${M} text-fg3`}>
          © 2026 Coin Brain. All rights reserved.
        </div>
      </div>
    </footer>
  );
}

// ─── Main ────────────────────────────────────────────────

export default function LandingPage() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);

  const load = useCallback(async () => {
    try { const r = await fetch("/api/signals"); if (!r.ok) return; const d = await r.json(); setSignals(d.signals ?? []); setStats(d.stats ?? null); } catch {} finally { setLoaded(true); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const openContact = () => setContactOpen(true);

  return (
    <div className="bg-bg min-h-screen" suppressHydrationWarning>
      <Nav />
      <Hero />
      {loaded && signals.length > 0 && <><Ticker signals={signals} /><Bias signals={signals} stats={stats} /></>}
      <Differentiators />
      <TraderShowcase signals={signals} />
      <SignalCatalog />
      {loaded && signals.length > 0 && <><ConsensusMap signals={signals} /><LivePreview signals={signals} /></>}
      <HowItWorks />
      <Roadmap />
      <WhyFree />
      <TrustNumbers signals={signals} stats={stats} />
      <FinalCTA onContact={openContact} />
      <Footer onContact={openContact} />
      <ContactModal open={contactOpen} onClose={() => setContactOpen(false)} />
    </div>
  );
}
