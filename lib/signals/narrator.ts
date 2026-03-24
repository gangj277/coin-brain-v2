/**
 * LLM Narrative Generator — structured reasoning for each signal.
 *
 * Uses OpenRouter Structured Output to produce breakdown:
 *   1. Market Context — price action, funding, OI
 *   2. Position Analysis — what traders are doing and why
 *   3. Risk Assessment — liquidation risks, leverage concerns
 *   4. Conclusion — actionable summary
 */

import type { Signal } from "./aggregator";
import { getMetaAndAssetCtxs, type AssetContext } from "../hyperliquid/client";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

// ─── Structured Analysis Type ────────────────────────────

export interface SignalAnalysis {
  marketContext: string;    // 24h change, funding, OI
  positionAnalysis: string; // what traders are doing and why
  riskAssessment: string;   // liquidation, leverage, danger signals
  conclusion: string;       // actionable 1-liner
  sentiment: "bullish" | "bearish" | "neutral" | "conflicted";
  confidenceLevel: "high" | "medium" | "low";
}

export interface NarratedSignal extends Signal {
  analysis: SignalAnalysis | null;
  narrative: string; // backwards compat: joined text
}

// ─── Structured Output Schema ────────────────────────────

const ANALYSIS_SCHEMA = {
  type: "json_schema" as const,
  json_schema: {
    name: "signal_analyses",
    strict: false,
    schema: {
      type: "object",
      properties: {
        analyses: {
          type: "array",
          items: {
            type: "object",
            properties: {
              index: { type: "integer" },
              marketContext: { type: "string", description: "시장 데이터 기반 분석 (가격 변동, 펀딩레이트, OI)" },
              positionAnalysis: { type: "string", description: "트레이더 포지션 분석 (진입가, 레버리지, ROE 기반)" },
              riskAssessment: { type: "string", description: "리스크 평가 (청산 거리, 레버리지, 위험 요소)" },
              conclusion: { type: "string", description: "핵심 결론 한 줄" },
              sentiment: { type: "string", enum: ["bullish", "bearish", "neutral", "conflicted"] },
              confidenceLevel: { type: "string", enum: ["high", "medium", "low"] },
            },
            required: ["index", "marketContext", "positionAnalysis", "riskAssessment", "conclusion", "sentiment", "confidenceLevel"],
          },
        },
      },
      required: ["analyses"],
    },
  },
};

// ─── LLM Call ────────────────────────────────────────────

async function callLLM(prompt: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return "";

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: `당신은 Hyperliquid 온체인 데이터를 분석하는 트레이딩 인텔리전스 AI입니다.
검증된 탑 트레이더(S-tier: 올타임 수익 $50M+, A-tier: $10M+)들의 포지션과 시장 데이터를 교차 분석합니다.
모든 분석은 한국어로 작성하세요. 구체적 숫자를 반드시 인용하세요.`,
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 4000,
      temperature: 0.3,
      response_format: ANALYSIS_SCHEMA,
    }),
  });

  if (!res.ok) {
    console.error(`[Narrator] LLM error ${res.status}: ${await res.text()}`);
    return "";
  }

  const data = (await res.json()) as {
    choices: { message: { content: string } }[];
  };
  return data.choices[0]?.message?.content ?? "";
}

// ─── Signal Summary Builder ──────────────────────────────

function fmtFundingRate(rate: string): string {
  const annual = parseFloat(rate) * 24 * 365 * 100;
  const hourly = parseFloat(rate) * 100;
  return `${hourly.toFixed(4)}%/h (연율 ${annual.toFixed(1)}%)`;
}

function buildSignalSummary(signal: Signal, ctx: AssetContext | undefined): string {
  const { coin, type, dominantSide, totalTraders, longTraders, shortTraders } = signal;

  let marketSection = "";
  if (ctx) {
    const markPx = parseFloat(ctx.markPx);
    const prevDayPx = parseFloat(ctx.prevDayPx);
    const dayChange = ((markPx - prevDayPx) / prevDayPx) * 100;
    const dayVol = parseFloat(ctx.dayNtlVlm);
    const oi = parseFloat(ctx.openInterest);
    const oiUsd = oi * markPx;

    marketSection = `[시장]
마크가: $${markPx.toLocaleString()} (24h ${dayChange >= 0 ? "+" : ""}${dayChange.toFixed(2)}%)
24h 거래량: $${(dayVol / 1e6).toFixed(1)}M | OI: $${(oiUsd / 1e6).toFixed(1)}M (${oi.toLocaleString()} ${coin})
펀딩: ${fmtFundingRate(ctx.funding)} ${parseFloat(ctx.funding) > 0 ? "(롱→숏)" : "(숏→롱)"}`;
  }

  const topTraders = signal.positions
    .slice(0, 7)
    .map((p) => {
      const roe = (p.returnOnEquity * 100).toFixed(1);
      const liq = p.liquidationPx ? `Liq $${p.liquidationPx.toLocaleString()}` : "Liq N/A";
      return `[${p.tier}] ${p.side} ${p.size} @ $${p.entryPx.toLocaleString()} | $${(p.sizeUsd / 1e6).toFixed(2)}M | ${p.leverage}x | ROE ${roe}% | ${liq}`;
    })
    .join("\n");

  const leverages = signal.positions.map((p) => p.leverage);

  return `코인: ${coin}
${marketSection}
[포지션] ${type} (${dominantSide}) | Conviction: ${signal.conviction}%
${totalTraders}명 (L:${longTraders} $${(signal.longValueUsd / 1e6).toFixed(1)}M / S:${shortTraders} $${(signal.shortValueUsd / 1e6).toFixed(1)}M)
S-tier: ${signal.sTierCount} | A-tier: ${signal.aTierCount} | Avg Lev: ${signal.avgLeverage}x (${Math.min(...leverages)}~${Math.max(...leverages)}x)
합산 uPnL: ${signal.totalUnrealizedPnl >= 0 ? "+" : ""}$${(signal.totalUnrealizedPnl / 1e3).toFixed(0)}k

트레이더:
${topTraders}`.trim();
}

// ─── Main Export ─────────────────────────────────────────

export async function narrateSignals(
  signals: Signal[]
): Promise<NarratedSignal[]> {
  const worthNarrating = signals.filter(
    (s) => s.strength !== "weak" && s.totalTraders >= 3
  );

  if (worthNarrating.length === 0) {
    return signals.map((s) => ({ ...s, analysis: null, narrative: "" }));
  }

  let assetCtxs = new Map<string, AssetContext>();
  try {
    const { contexts } = await getMetaAndAssetCtxs();
    assetCtxs = contexts;
  } catch {
    // continue without market data
  }

  const signalsToNarrate = worthNarrating.slice(0, 15);

  const summaries = signalsToNarrate
    .map((s, i) => `[시그널 ${i + 1}]\n${buildSignalSummary(s, assetCtxs.get(s.coin))}`)
    .join("\n\n---\n\n");

  const prompt = `아래 시그널들을 각각 분석해주세요.

각 분석의 4개 섹션:
- marketContext: 시장 데이터(가격, 펀딩, OI) 기반 현재 상황. 숫자 인용 필수.
- positionAnalysis: 트레이더들이 왜 이 포지션을 잡았는지, 진입가와 현재가 관계, ROE 상태. S-tier의 행동 특히 주목.
- riskAssessment: 청산 거리, 레버리지 집중도, 펀딩 비용, 반대 포지션 위험. 구체적 청산가 인용.
- conclusion: 핵심 판단 한 줄. "~일 수 있다"가 아니라 데이터에서 읽히는 팩트 기반.

sentiment: bullish/bearish/neutral/conflicted
confidenceLevel: high(데이터가 명확)/medium(일부 상충)/low(불확실)

${summaries}`;

  const response = await callLLM(prompt);

  const analysisMap = new Map<number, SignalAnalysis>();
  try {
    const jsonStr = response.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(jsonStr) as {
      analyses: (SignalAnalysis & { index: number })[];
    };
    for (const item of parsed.analyses) {
      analysisMap.set(item.index, {
        marketContext: item.marketContext,
        positionAnalysis: item.positionAnalysis,
        riskAssessment: item.riskAssessment,
        conclusion: item.conclusion,
        sentiment: item.sentiment,
        confidenceLevel: item.confidenceLevel,
      });
    }
  } catch (e) {
    console.error("[Narrator] Parse error:", e);
  }

  return signals.map((signal) => {
    const idx = signalsToNarrate.indexOf(signal);
    const analysis = idx >= 0 ? analysisMap.get(idx + 1) ?? null : null;
    // backwards compat: join into single narrative string
    const narrative = analysis
      ? `${analysis.conclusion}`
      : "";
    return { ...signal, analysis, narrative };
  });
}

export type { NarratedSignal };
