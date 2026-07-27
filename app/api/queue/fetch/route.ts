import { NextResponse } from "next/server";
import { processFetchPost } from "@/lib/fetchPostJob";

export async function POST(request: Request) {
  // This endpoint is invoked by the Queue consumer Worker, not by the app
  // producer. Keep its credential separate from the producer's enqueue
  // secret; mixing them causes the Worker to receive 401 and retry forever.
  const workerSecret = process.env.CLOUDFLARE_QUEUE_WORKER_SECRET;
  if (!workerSecret || request.headers.get("x-postflow-worker-secret") !== workerSecret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { postId } = await request.json() as { postId?: string };
  if (!postId) return NextResponse.json({ error: "postId is required" }, { status: 400 });
  await processFetchPost(postId);
  return NextResponse.json({ ok: true });
}
