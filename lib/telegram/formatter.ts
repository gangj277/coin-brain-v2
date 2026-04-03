/**
 * Telegram Alert Formatter — builds Korean-language HTML messages.
 *
 * Telegram HTML supports: <b>, <i>, <code>, <pre>, <a>, <u>, <s>
 * No markdown — we use parse_mode: "HTML".
 */

import type { AlertEvent, AlertEventType } from "./detector";
import type { ServedSignal } from "@/lib/pipeline/types";

// ─── Icons ──────────────────────────────────────────────

const EVENT_ICON: Record<AlertEventType, string> = {
  new_signal: "\u{1F195}",       // 🆕
  stier_surge: "\u{1F525}",     // 🔥
  strength_upgrade: "\u{26A1}", // ⚡
  consensus_formed: "\u{1F3AF}", // 🎯
  side_flip: "\u{1F504}",       // 🔄
};

const SIDE_ICON = {
  LONG: "\u{1F7E2}",  // 🟢
  SHORT: "\u{1F534}", // 🔴
  SPLIT: "\u{1F7E1}", // 🟡
} as const;

const STRENGTH_LABEL = {
  strong: "Strong",
  moderate: "Moderate",
  weak: "Weak",
} as const;

// ─── Number Formatting ──────────────────────────────────

function fmtUsd(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function fmtPrice(value: number): string {
  if (value >= 1000) return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toPrecision(4)}`;
}

function fmtPct(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1)}%`;
}

// ─── Signal Header ──────────────────────────────────────

function buildHeader(event: AlertEvent): string {
  const icon = EVENT_ICON[event.type];
  const sideIcon = SIDE_ICON[event.signal.dominantSide];
  const { coin, dominantSide, strength } = event.signal;

  return `${icon} <b>${coin} ${dominantSide}</b> ${sideIcon} — ${STRENGTH_LABEL[strength]}`;
}

// ─── Signal Body ────────────────────────────────────────

function buildBody(signal: ServedSignal): string {
  const lines: string[] = [];

  // Trader breakdown
  lines.push(
    `<b>${signal.totalTraders}명</b> 트레이더 (S:${signal.sTierCount} A:${signal.aTierCount})`
  );
  lines.push(
    `L: ${signal.longTraders}명 ${fmtUsd(signal.longValueUsd)} / S: ${signal.shortTraders}명 ${fmtUsd(signal.shortValueUsd)}`
  );
  lines.push(`총 포지션: ${fmtUsd(signal.totalValueUsd)} | Conviction: ${signal.conviction}%`);
  lines.push(`평균 레버리지: ${signal.avgLeverage}x | 진입가: ${fmtPrice(signal.avgEntryPx)}`);

  // Market data if available
  if (signal.market) {
    const m = signal.market;
    const daySign = m.dayChange >= 0 ? "+" : "";
    lines.push("");
    lines.push(
      `<i>시장: ${fmtPrice(m.markPx)} (${daySign}${m.dayChange.toFixed(2)}%) | 펀딩: ${(m.funding * 100).toFixed(4)}%/h</i>`
    );
  }

  // Top S-tier positions
  const sTierPositions = signal.positions.filter((p) => p.tier === "S").slice(0, 3);
  if (sTierPositions.length > 0) {
    lines.push("");
    lines.push("<b>S-tier 포지션:</b>");
    for (const p of sTierPositions) {
      const addr = `${p.address.slice(0, 6)}..${p.address.slice(-4)}`;
      const roe = fmtPct(p.returnOnEquity);
      lines.push(
        `  ${SIDE_ICON[p.side]} <code>${addr}</code> ${fmtUsd(p.sizeUsd)} @ ${fmtPrice(p.entryPx)} (${p.leverage}x, ROE ${roe})`
      );
    }
  }

  // LLM conclusion if available
  if (signal.analysis?.conclusion) {
    lines.push("");
    lines.push(`\u{1F4A1} ${signal.analysis.conclusion}`);
  }

  return lines.join("\n");
}

// ─── Public API ─────────────────────────────────────────

export function formatAlert(event: AlertEvent): string {
  const header = buildHeader(event);
  const detail = `\u{1F4CC} ${event.detail}`;
  const body = buildBody(event.signal);

  return [header, "", detail, "", body].join("\n");
}

/** Format a batch of events into messages (1 message per event) */
export function formatAlerts(events: AlertEvent[]): string[] {
  return events.map(formatAlert);
}

/** Daily summary message — sent once per day with top signals overview */
export function formatDailySummary(
  signals: ServedSignal[],
  timestamp: number
): string {
  const date = new Date(timestamp);
  const dateStr = `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
  const timeStr = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

  const strong = signals.filter((s) => s.strength === "strong");
  const moderate = signals.filter((s) => s.strength === "moderate");

  const lines: string[] = [
    `\u{1F4CA} <b>Coin Brain Daily — ${dateStr} ${timeStr}</b>`,
    "",
    `Strong: ${strong.length} | Moderate: ${moderate.length} | Total: ${signals.length} 시그널`,
    "",
  ];

  // Top 5 signals
  const top = signals.slice(0, 5);
  for (const sig of top) {
    const sideIcon = SIDE_ICON[sig.dominantSide];
    lines.push(
      `${sideIcon} <b>${sig.coin}</b> ${sig.dominantSide} — ${sig.totalTraders}명, ${fmtUsd(sig.totalValueUsd)}, S:${sig.sTierCount} (${sig.conviction}%)`
    );
  }

  if (signals.length > 5) {
    lines.push(`\n... +${signals.length - 5}개 시그널`);
  }

  lines.push("");
  lines.push("<i>Coin Brain \u{1F9E0} — Smart Money Tracker</i>");

  return lines.join("\n");
}
