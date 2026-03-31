"use client";

import Link from "next/link";
import { useEffect, useState, useCallback, use } from "react";

const MN = "font-[family-name:var(--font-geist-mono)]";
function fmt(n: number) { if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`; if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}k`; return `$${n.toFixed(0)}`; }
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

interface YouTuberPosition {
  coin: string; side: "롱" | "숏" | "중립";
  targetPrice?: number; stopLoss?: number; comment: string;
  sourceUrl: string; sourceTitle?: string; updatedAt: string;
}
interface YouTuber {
  id: string; name: string; channelUrl: string; profileImage: string;
  subscribers: string; positions: YouTuberPosition[];
}
interface Signal {
  coin: string; dominantSide: "LONG" | "SHORT" | "SPLIT"; conviction: number;
  sTierCount: number; totalValueUsd: number; totalTraders: number;
  market?: { markPx: number; dayChange: number } | null;
}

export default function YouTuberDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [youtuber, setYoutuber] = useState<YouTuber | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [yr, sr] = await Promise.all([fetch("/api/youtubers"), fetch("/api/signals")]);
      if (yr.ok) {
        const yd = await yr.json();
        setYoutuber((yd.youtubers ?? []).find((y: YouTuber) => y.id === id) ?? null);
      }
      if (sr.ok) {
        const sd = await sr.json();
        setSignals(sd.signals ?? []);
      }
    } catch {}
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return (
    <div className="flex items-center justify-center h-screen bg-bg">
      <div className="relative w-10 h-10"><div className="absolute inset-0 border border-border rounded-full" /><div className="absolute inset-0 border border-green border-t-transparent rounded-full animate-spin" /></div>
    </div>
  );

  if (!youtuber) return (
    <div className="flex flex-col items-center justify-center h-screen bg-bg gap-4">
      <p className={`text-sm ${MN} text-fg3`}>유튜버를 찾을 수 없습니다</p>
      <Link href="/dashboard" className={`text-xs ${MN} text-green hover:underline`}>← 목록으로</Link>
    </div>
  );

  // Compute overall agreement stats
  const comparisons = youtuber.positions.map(pos => {
    const signal = signals.find(s => s.coin === pos.coin);
    const ytSide = pos.side === "롱" ? "LONG" : pos.side === "숏" ? "SHORT" : null;
    return { agrees: signal && ytSide ? signal.dominantSide === ytSide : null, signal };
  });
  const agreeCount = comparisons.filter(c => c.agrees === true).length;
  const disagreeCount = comparisons.filter(c => c.agrees === false).length;
  const totalCompared = agreeCount + disagreeCount;

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-raised sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center gap-4">
          <Link href="/dashboard" className={`text-xs ${MN} text-fg3 hover:text-fg transition-colors`}>← 목록</Link>
          <span className="text-border">|</span>
          <span className="text-sm font-semibold tracking-tight">
            <span className="text-fg">coin</span><span className="text-green">brain</span>
          </span>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* ── Header ── */}
        <div className="flex items-start justify-between mb-8">
          <div className="flex items-center gap-5">
            {youtuber.profileImage ? (
              <img src={youtuber.profileImage} alt={youtuber.name} className="w-16 h-16 rounded-full object-cover ring-2 ring-border-subtle" />
            ) : (
              <div className="w-16 h-16 rounded-full bg-surface flex items-center justify-center text-fg3 text-xl font-bold ring-2 ring-border-subtle">{youtuber.name[0]}</div>
            )}
            <div>
              <h1 className="text-2xl font-bold text-fg">{youtuber.name}</h1>
              <div className="flex items-center gap-3 mt-1">
                <span className={`text-xs ${MN} text-fg3`}>{youtuber.subscribers} 구독자</span>
                <span className={`text-xs ${MN} text-fg3`}>{youtuber.positions.length}개 포지션</span>
                {youtuber.channelUrl && (
                  <a href={youtuber.channelUrl} target="_blank" rel="noopener noreferrer"
                    className={`text-xs ${MN} text-red hover:underline`}>채널 방문 →</a>
                )}
              </div>
            </div>
          </div>

          {/* Overall verdict */}
          {totalCompared > 0 && (
            <div className={`rounded-xl px-5 py-3 border text-center ${
              agreeCount > disagreeCount ? "bg-green/5 border-green/20"
              : disagreeCount > agreeCount ? "bg-red/5 border-red/20"
              : "bg-surface border-border-subtle"
            }`}>
              <div className={`text-2xl font-bold ${MN} ${
                agreeCount > disagreeCount ? "text-green" : disagreeCount > agreeCount ? "text-red" : "text-fg3"
              }`}>
                {totalCompared > 0 ? Math.round((agreeCount / totalCompared) * 100) : 0}%
              </div>
              <div className={`text-[10px] ${MN} text-fg3 mt-0.5`}>스마트머니 일치율</div>
              <div className={`text-[10px] ${MN} mt-1`}>
                <span className="text-green">{agreeCount}✓</span>
                <span className="text-fg3 mx-1">/</span>
                <span className="text-red">{disagreeCount}✗</span>
              </div>
            </div>
          )}
        </div>

        {/* ── Positions ── */}
        <div className={`text-[10px] ${MN} text-fg3 uppercase tracking-widest mb-4`}>포지션 분석</div>
        <div className="space-y-4">
          {youtuber.positions.map((pos, i) => {
            const signal = signals.find(s => s.coin === pos.coin);
            const ytSide = pos.side === "롱" ? "LONG" : pos.side === "숏" ? "SHORT" : null;
            const agrees = signal && ytSide ? signal.dominantSide === ytSide : null;
            const borderColor = agrees === true ? "border-l-green" : agrees === false ? "border-l-red" : "border-l-border";

            return (
              <div key={i} className={`rounded-xl border border-border-subtle bg-raised border-l-[3px] ${borderColor}`}>
                {/* Position header */}
                <div className="p-5 pb-0">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <Link href={`/dashboard/${pos.coin}`} className="text-xl font-bold text-fg hover:text-green transition-colors">
                        {pos.coin}
                      </Link>
                      <span className={`text-xs ${MN} px-2.5 py-1 rounded-full font-semibold ${
                        pos.side === "롱" ? "bg-green/10 text-green" : pos.side === "숏" ? "bg-red/10 text-red" : "bg-surface text-fg3"
                      }`}>{pos.side}</span>
                    </div>
                    <span className={`text-[10px] ${MN} text-fg3`}>{timeAgo(pos.updatedAt)}</span>
                  </div>

                  {/* Target + Stop with visual range */}
                  {(pos.targetPrice || pos.stopLoss) && (
                    <div className={`flex items-center gap-6 mb-3 text-xs ${MN}`}>
                      {pos.stopLoss && (
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-red/30" />
                          <span className="text-fg3">손절</span>
                          <span className="text-red font-semibold">${pos.stopLoss.toLocaleString()}</span>
                        </div>
                      )}
                      {pos.targetPrice && (
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-green/30" />
                          <span className="text-fg3">목표</span>
                          <span className="text-green font-semibold">${pos.targetPrice.toLocaleString()}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Comment */}
                  {pos.comment && (
                    <p className="text-sm text-fg2 leading-relaxed mb-4">{pos.comment}</p>
                  )}
                </div>

                {/* Smart Money cross-reference — prominent section */}
                {signal && (
                  <div className={`mx-5 mb-5 rounded-lg p-4 ${
                    agrees === true ? "bg-green/[0.03]" : agrees === false ? "bg-red/[0.03]" : "bg-surface/50"
                  }`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className={`text-sm font-semibold ${agrees === true ? "text-green" : agrees === false ? "text-red" : "text-fg3"}`}>
                          {agrees === true ? "✓ 스마트머니 일치" : agrees === false ? "✗ 스마트머니 반대" : "— 비교 불가"}
                        </span>
                      </div>
                      <div className={`flex items-center gap-4 text-[11px] ${MN}`}>
                        <span className="text-fg3">S-tier <span className="text-amber">{signal.sTierCount}명</span> {signal.dominantSide === "LONG" ? "롱" : signal.dominantSide === "SHORT" ? "숏" : "양방향"}</span>
                        <span className="text-fg3">확신도 <span className={signal.conviction >= 80 ? "text-green" : "text-fg2"}>{signal.conviction}%</span></span>
                        <span className="text-fg3">{fmt(signal.totalValueUsd)}</span>
                        <span className="text-fg3">{signal.totalTraders}명</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Source link */}
                {pos.sourceUrl && (
                  <div className="px-5 pb-4">
                    <a href={pos.sourceUrl} target="_blank" rel="noopener noreferrer"
                      className={`inline-flex items-center gap-1.5 text-[11px] ${MN} text-fg3 hover:text-fg transition-colors`}>
                      <span>{pos.sourceTitle || "소스 영상"}</span>
                      <span>→</span>
                    </a>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
