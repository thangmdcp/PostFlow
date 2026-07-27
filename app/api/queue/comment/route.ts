import { NextResponse } from "next/server";
import { attemptComment } from "@/lib/autoCommentsRunner";

export async function POST(request: Request) {
  const workerSecret = process.env.CLOUDFLARE_QUEUE_SECRET;
  if (!workerSecret || request.headers.get("x-postflow-worker-secret") !== workerSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { commentId } = await request.json() as { commentId?: string };
  if (!commentId) return NextResponse.json({ error: "commentId is required" }, { status: 400 });
  const result = await attemptComment(commentId);
  return result.retry
    ? NextResponse.json({ error: "Comment failed; retry through Queue" }, { status: 503 })
    : NextResponse.json({ ok: true });
}
