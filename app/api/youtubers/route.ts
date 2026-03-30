import { redis, KEYS } from "@/lib/redis/client";

export async function GET() {
  const raw = await redis.get<string>(KEYS.YOUTUBERS);
  const youtubers = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : [];
  return Response.json({ youtubers });
}
