import { getTraderSnapshot } from "@/lib/hyperliquid";
import { analyzeTrader } from "@/lib/hyperliquid/analysis";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;

  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return Response.json(
      { error: "Invalid Ethereum address" },
      { status: 400 }
    );
  }

  try {
    const snapshot = await getTraderSnapshot(address);
    const analysis = analyzeTrader(snapshot);
    return Response.json(analysis);
  } catch (e) {
    return Response.json(
      { error: (e as Error).message },
      { status: 500 }
    );
  }
}
