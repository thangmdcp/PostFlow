import { NextResponse } from "next/server";
import { processFetchPost } from "@/lib/fetchPostJob";

export async function POST(request: Request) {
  const workerSecret = process.env.CLOUDFLARE_QUEUE_SECRET;
  if (!workerSecret || request.headers.get("x-postflow-worker-secret") !== workerSecret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { postId } = await request.json() as { postId?: string };
  if (!postId) return NextResponse.json({ error: "postId is required" }, { status: 400 });
  await processFetchPost(postId);
  return NextResponse.json({ ok: true });
}
