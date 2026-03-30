export async function POST(request: Request) {
  const body = await request.json();
  if (body.password !== process.env.ADMIN_PASSWORD) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return Response.json({ ok: true });
}
