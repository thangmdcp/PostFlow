import { NextResponse } from "next/server";
import { attemptStory } from "@/lib/autoStoryRunner";

export async function POST(request: Request) {
  const workerSecret = process.env.CLOUDFLARE_QUEUE_WORKER_SECRET;
  if (!workerSecret || request.headers.get("x-postflow-worker-secret") !== workerSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { postId } = await request.json() as { postId?: string };
  if (!postId) return NextResponse.json({ error: "postId is required" }, { status: 400 });
  const result = await attemptStory(postId);
  return result.retry
    ? NextResponse.json({ error: "Story failed; retry through Queue" }, { status: 503 })
    : NextResponse.json({ ok: true });
}
