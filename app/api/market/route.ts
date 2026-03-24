import { getMeta, getAllMids } from "@/lib/hyperliquid";

export async function GET() {
  try {
    const [meta, mids] = await Promise.all([getMeta(), getAllMids()]);

    const coins = meta.universe.map((c) => ({
      name: c.name,
      maxLeverage: c.maxLeverage,
      price: mids[c.name] ? parseFloat(mids[c.name]) : null,
    }));

    return Response.json({
      totalCoins: coins.length,
      coins: coins.filter((c) => c.price !== null),
    });
  } catch (e) {
    return Response.json(
      { error: (e as Error).message },
      { status: 500 }
    );
  }
}
