"use client";

import { useEffect, useState, useCallback } from "react";

const MN = "font-[family-name:var(--font-geist-mono)]";

interface YouTuberPosition {
  coin: string;
  side: "롱" | "숏" | "중립";
  targetPrice?: number;
  stopLoss?: number;
  comment: string;
  sourceUrl: string;
  sourceTitle?: string;
  updatedAt: string;
}

interface YouTuber {
  id: string;
  name: string;
  channelUrl: string;
  profileImage: string;
  subscribers: string;
  positions: YouTuberPosition[];
}

function generateId(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9가-힣]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || `yt-${Date.now()}`;
}

function today() {
  return new Date().toISOString().split("T")[0];
}

export default function AdminYoutubers() {
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [token, setToken] = useState("");

  const [youtubers, setYoutubers] = useState<YouTuber[]>([]);
  const [editing, setEditing] = useState<YouTuber | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  // Check sessionStorage on mount
  useEffect(() => {
    const stored = sessionStorage.getItem("admin_token");
    if (stored) { setToken(stored); setAuthed(true); }
  }, []);

  // Fetch youtubers after auth
  const fetchData = useCallback(async () => {
    const r = await fetch("/api/youtubers");
    const d = await r.json();
    setYoutubers(d.youtubers ?? []);
  }, []);

  useEffect(() => { if (authed) fetchData(); }, [authed, fetchData]);

  // Auth
  async function handleLogin() {
    setAuthError("");
    const r = await fetch("/api/admin/youtubers/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (r.ok) {
      setToken(password);
      sessionStorage.setItem("admin_token", password);
      setAuthed(true);
    } else {
      setAuthError("비밀번호가 틀렸습니다");
    }
  }

  // Save all
  async function handleSave() {
    setSaving(true);
    setSaveMsg("");
    const r = await fetch("/api/admin/youtubers", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ youtubers }),
    });
    if (r.ok) setSaveMsg("저장 완료");
    else setSaveMsg("저장 실패");
    setSaving(false);
    setTimeout(() => setSaveMsg(""), 2000);
  }

  // Add new youtuber
  function addYoutuber() {
    setEditing({
      id: "", name: "", channelUrl: "", profileImage: "", subscribers: "",
      positions: [{ coin: "BTC", side: "롱", comment: "", sourceUrl: "", updatedAt: today() }],
    });
  }

  // Save to Redis helper
  async function persistToRedis(data: YouTuber[]) {
    setSaving(true);
    const r = await fetch("/api/admin/youtubers", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ youtubers: data }),
    });
    if (r.ok) { setSaveMsg("저장 완료"); }
    else { setSaveMsg("저장 실패"); }
    setSaving(false);
    setTimeout(() => setSaveMsg(""), 2000);
  }

  // Save editing youtuber — auto-persist to Redis
  async function saveEditing() {
    if (!editing) return;
    const yt = { ...editing, id: editing.id || generateId(editing.name) };
    const idx = youtubers.findIndex(y => y.id === yt.id);
    let updated: YouTuber[];
    if (idx >= 0) {
      updated = [...youtubers];
      updated[idx] = yt;
    } else {
      updated = [...youtubers, yt];
    }
    setYoutubers(updated);
    setEditing(null);
    await persistToRedis(updated);
  }

  async function deleteYoutuber(id: string) {
    const updated = youtubers.filter(y => y.id !== id);
    setYoutubers(updated);
    await persistToRedis(updated);
  }

  // ─── Auth screen ───
  if (!authed) {
    return (
      <div className="flex items-center justify-center h-screen bg-bg">
        <div className="w-80">
          <div className="text-center mb-8">
            <div className="text-sm font-semibold mb-2"><span className="text-fg">coin</span><span className="text-green">brain</span></div>
            <div className={`text-[10px] ${MN} text-fg3 uppercase tracking-[0.2em]`}>관리자 인증 필요</div>
          </div>
          <div className="rounded-xl border border-border bg-raised p-6">
            <label className={`text-[10px] ${MN} text-fg3 uppercase tracking-widest`}>비밀번호</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleLogin()}
              placeholder="••••••••"
              autoFocus
              className={`w-full mt-2 px-4 py-3 rounded-lg bg-surface border border-border-subtle text-sm ${MN} text-fg placeholder:text-fg3/30 outline-none focus:border-green/30 mb-4`} />
            {authError && <p className={`text-xs ${MN} text-red mb-3`}>{authError}</p>}
            <button onClick={handleLogin}
              className={`w-full px-4 py-3 rounded-lg bg-green text-[#050508] font-semibold text-sm cursor-pointer hover:bg-green/90 transition-colors`}>
              인증
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Admin UI ───
  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-raised sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-semibold"><span className="text-fg">coin</span><span className="text-green">brain</span></h1>
            <span className={`text-[10px] ${MN} text-fg3 border border-border rounded px-1.5 py-0.5`}>유튜버 관리</span>
          </div>
          <div className="flex items-center gap-3">
            {saveMsg && <span className={`text-xs ${MN} text-green`}>{saveMsg}</span>}
            <button onClick={handleSave} disabled={saving}
              className={`px-4 py-1.5 rounded-lg bg-green text-[#050508] font-semibold text-xs cursor-pointer hover:bg-green/90 transition-colors disabled:opacity-50`}>
              {saving ? "저장 중..." : "Redis에 저장"}
            </button>
            <button onClick={addYoutuber}
              className={`px-4 py-1.5 rounded-lg border border-border-subtle text-xs ${MN} text-fg cursor-pointer hover:bg-surface transition-colors`}>
              + 유튜버 추가
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-6">
        {youtubers.length === 0 ? (
          <div className={`text-center py-20 text-sm ${MN} text-fg3`}>
            등록된 유튜버가 없습니다. "유튜버 추가"를 눌러주세요.
          </div>
        ) : (
          <div className="space-y-3">
            {youtubers.map(yt => (
              <div key={yt.id} className="rounded-xl border border-border-subtle bg-raised p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    {yt.profileImage && (
                      <img src={yt.profileImage} alt={yt.name} className="w-10 h-10 rounded-full object-cover" />
                    )}
                    <div>
                      <span className="text-base font-semibold text-fg">{yt.name}</span>
                      <span className={`text-xs ${MN} text-fg3 ml-2`}>{yt.subscribers}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setEditing({ ...yt })}
                      className={`px-3 py-1 rounded-lg border border-border-subtle text-xs ${MN} text-fg3 cursor-pointer hover:text-fg hover:bg-surface transition-colors`}>
                      편집
                    </button>
                    <button onClick={() => deleteYoutuber(yt.id)}
                      className={`px-3 py-1 rounded-lg border border-red/20 text-xs ${MN} text-red cursor-pointer hover:bg-red/10 transition-colors`}>
                      삭제
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {yt.positions.map((pos, i) => (
                    <span key={i} className={`text-[10px] ${MN} px-1.5 py-0.5 rounded ${
                      pos.side === "롱" ? "bg-green/8 text-green" : pos.side === "숏" ? "bg-red/8 text-red" : "bg-surface text-fg3"
                    }`}>
                      {pos.coin} {pos.side}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Edit Modal ─── */}
      {editing && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-[600px] max-h-[85vh] overflow-y-auto bg-raised border border-border rounded-2xl p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-fg">{editing.id ? "유튜버 편집" : "유튜버 추가"}</h2>
              <button onClick={() => setEditing(null)} className="text-fg3 hover:text-fg text-lg cursor-pointer">✕</button>
            </div>

            {/* Basic info */}
            <div className="space-y-3 mb-6">
              <div>
                <label className={`text-[10px] ${MN} text-fg3 uppercase tracking-widest`}>이름</label>
                <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })}
                  className={`w-full mt-1 px-3 py-2 rounded-lg bg-surface border border-border-subtle text-sm ${MN} text-fg outline-none focus:border-green/30`} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`text-[10px] ${MN} text-fg3 uppercase tracking-widest`}>채널 URL</label>
                  <input value={editing.channelUrl} onChange={e => setEditing({ ...editing, channelUrl: e.target.value })}
                    className={`w-full mt-1 px-3 py-2 rounded-lg bg-surface border border-border-subtle text-sm ${MN} text-fg outline-none focus:border-green/30`} />
                </div>
                <div>
                  <label className={`text-[10px] ${MN} text-fg3 uppercase tracking-widest`}>구독자 수</label>
                  <input value={editing.subscribers} onChange={e => setEditing({ ...editing, subscribers: e.target.value })}
                    placeholder="12.5만"
                    className={`w-full mt-1 px-3 py-2 rounded-lg bg-surface border border-border-subtle text-sm ${MN} text-fg outline-none focus:border-green/30`} />
                </div>
              </div>
              <div>
                <label className={`text-[10px] ${MN} text-fg3 uppercase tracking-widest`}>프로필 이미지 URL</label>
                <input value={editing.profileImage} onChange={e => setEditing({ ...editing, profileImage: e.target.value })}
                  className={`w-full mt-1 px-3 py-2 rounded-lg bg-surface border border-border-subtle text-sm ${MN} text-fg outline-none focus:border-green/30`} />
              </div>
            </div>

            {/* Positions */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <label className={`text-[10px] ${MN} text-fg3 uppercase tracking-widest`}>포지션</label>
                <button onClick={() => setEditing({
                  ...editing,
                  positions: [...editing.positions, { coin: "", side: "롱", comment: "", sourceUrl: "", updatedAt: today() }],
                })} className={`text-xs ${MN} text-green cursor-pointer hover:underline`}>+ 추가</button>
              </div>
              <div className="space-y-3">
                {editing.positions.map((pos, i) => (
                  <div key={i} className="rounded-lg border border-border-subtle bg-inset p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <input value={pos.coin} onChange={e => {
                        const p = [...editing.positions]; p[i] = { ...p[i], coin: e.target.value.toUpperCase() };
                        setEditing({ ...editing, positions: p });
                      }} placeholder="BTC"
                        className={`w-20 px-2 py-1.5 rounded bg-surface border border-border-subtle text-xs ${MN} text-fg outline-none`} />
                      <select value={pos.side} onChange={e => {
                        const p = [...editing.positions]; p[i] = { ...p[i], side: e.target.value as "롱" | "숏" | "중립" };
                        setEditing({ ...editing, positions: p });
                      }} className={`px-2 py-1.5 rounded bg-surface border border-border-subtle text-xs ${MN} text-fg outline-none`}>
                        <option value="롱">롱</option>
                        <option value="숏">숏</option>
                        <option value="중립">중립</option>
                      </select>
                      <input value={pos.targetPrice ?? ""} onChange={e => {
                        const p = [...editing.positions]; p[i] = { ...p[i], targetPrice: e.target.value ? Number(e.target.value) : undefined };
                        setEditing({ ...editing, positions: p });
                      }} placeholder="목표가" type="number"
                        className={`w-24 px-2 py-1.5 rounded bg-surface border border-border-subtle text-xs ${MN} text-fg outline-none`} />
                      <input value={pos.stopLoss ?? ""} onChange={e => {
                        const p = [...editing.positions]; p[i] = { ...p[i], stopLoss: e.target.value ? Number(e.target.value) : undefined };
                        setEditing({ ...editing, positions: p });
                      }} placeholder="손절가" type="number"
                        className={`w-24 px-2 py-1.5 rounded bg-surface border border-border-subtle text-xs ${MN} text-fg outline-none`} />
                      <input value={pos.updatedAt} onChange={e => {
                        const p = [...editing.positions]; p[i] = { ...p[i], updatedAt: e.target.value };
                        setEditing({ ...editing, positions: p });
                      }} type="date"
                        className={`px-2 py-1.5 rounded bg-surface border border-border-subtle text-xs ${MN} text-fg outline-none`} />
                      <button onClick={() => {
                        const p = editing.positions.filter((_, j) => j !== i);
                        setEditing({ ...editing, positions: p });
                      }} className="text-red text-xs cursor-pointer hover:underline ml-auto">삭제</button>
                    </div>
                    <input value={pos.comment} onChange={e => {
                      const p = [...editing.positions]; p[i] = { ...p[i], comment: e.target.value };
                      setEditing({ ...editing, positions: p });
                    }} placeholder="핵심 근거 한 줄"
                      className={`w-full px-2 py-1.5 rounded bg-surface border border-border-subtle text-xs ${MN} text-fg outline-none mb-2`} />
                    <div className="grid grid-cols-2 gap-2">
                      <input value={pos.sourceUrl} onChange={e => {
                        const p = [...editing.positions]; p[i] = { ...p[i], sourceUrl: e.target.value };
                        setEditing({ ...editing, positions: p });
                      }} placeholder="소스 영상 URL"
                        className={`w-full px-2 py-1.5 rounded bg-surface border border-border-subtle text-xs ${MN} text-fg outline-none`} />
                      <input value={pos.sourceTitle ?? ""} onChange={e => {
                        const p = [...editing.positions]; p[i] = { ...p[i], sourceTitle: e.target.value };
                        setEditing({ ...editing, positions: p });
                      }} placeholder="영상 제목 (선택)"
                        className={`w-full px-2 py-1.5 rounded bg-surface border border-border-subtle text-xs ${MN} text-fg outline-none`} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <button onClick={() => setEditing(null)}
                className={`px-4 py-2 rounded-lg border border-border-subtle text-xs ${MN} text-fg3 cursor-pointer hover:text-fg transition-colors`}>
                취소
              </button>
              <button onClick={saveEditing}
                className="px-6 py-2 rounded-lg bg-green text-[#050508] font-semibold text-xs cursor-pointer hover:bg-green/90 transition-colors">
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
