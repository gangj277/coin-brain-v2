const INFO_URL = "https://api.hyperliquid.xyz/info";

const VALID_INTERVALS = ["15m", "30m", "1h", "4h"] as const;
const LOOKBACK: Record<string, number> = {
  "15m": 2 * 24 * 3600 * 1000,   // 2 days
  "30m": 4 * 24 * 3600 * 1000,   // 4 days
  "1h":  7 * 24 * 3600 * 1000,   // 7 days
  "4h":  14 * 24 * 3600 * 1000,  // 14 days
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ coin: string }> }
) {
  const { coin } = await params;
  const url = new URL(request.url);
  const interval = VALID_INTERVALS.includes(url.searchParams.get("interval") as typeof VALID_INTERVALS[number])
    ? url.searchParams.get("interval")!
    : "4h";
  const now = Date.now();
  const startTime = now - (LOOKBACK[interval] ?? LOOKBACK["4h"]);

  try {
    const res = await fetch(INFO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "candleSnapshot",
        req: { coin: coin.toUpperCase(), interval, startTime, endTime: now },
      }),
    });

    if (!res.ok) throw new Error(`Hyperliquid error ${res.status}`);

    const raw = await res.json() as { t: number; o: string; c: string; h: string; l: string; v: string }[];

    const candles = raw.map((c) => ({
      time: Math.floor(c.t / 1000) as number,
      open: parseFloat(c.o),
      high: parseFloat(c.h),
      low: parseFloat(c.l),
      close: parseFloat(c.c),
      volume: parseFloat(c.v),
    }));

    return Response.json({ candles, coin: coin.toUpperCase() });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
