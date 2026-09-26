import { NextResponse } from "next/server";
import { attemptComment } from "@/lib/autoCommentsRunner";
import { prisma } from "@/lib/prisma";
import { reserveMetaJob, scopesForPost } from "@/lib/metaThrottle";

export async function POST(request: Request) {
  const workerSecret = process.env.CLOUDFLARE_QUEUE_SECRET;
  if (!workerSecret || request.headers.get("x-postflow-worker-secret") !== workerSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { commentId } = await request.json() as { commentId?: string };
  if (!commentId) return NextResponse.json({ error: "commentId is required" }, { status: 400 });
  const comment = await prisma.postComment.findUnique({ where: { id: commentId }, include: { post: { select: { pageId: true } } } });
  if (!comment || comment.status === "done" || comment.status === "failed") return NextResponse.json({ ok: true });
  const gate = await reserveMetaJob("comment", scopesForPost(comment.post.pageId), commentId);
  if (!gate.allowed) {
    const nextAttemptAt = new Date(Date.now() + gate.retryAfterSeconds * 1000);
    await prisma.postComment.update({ where: { id: commentId }, data: { status: "pending", nextAttemptAt, errorMsg: `[quota] ${gate.reason ?? "Chờ Meta hồi quota"}` } });
    return NextResponse.json({ error: gate.reason ?? "Chờ Meta hồi quota", deferredReason: "quota", retryAfterSeconds: gate.retryAfterSeconds }, { status: 503 });
  }
  const result = await attemptComment(commentId);
  return result.retry
    ? NextResponse.json({ error: "Comment failed; retry through Queue", retryAfterSeconds: result.retryAfterSeconds }, { status: 503 })
    : NextResponse.json({ ok: true });
}
