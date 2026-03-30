import { redis, KEYS } from "@/lib/redis/client";

export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  await redis.set(KEYS.YOUTUBERS, JSON.stringify(body.youtubers ?? []));
  return Response.json({ ok: true, count: (body.youtubers ?? []).length });
}
