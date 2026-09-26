import { NextResponse } from "next/server";
import { attemptStory } from "@/lib/autoStoryRunner";
import { prisma } from "@/lib/prisma";
import { reserveMetaJob, scopesForPost } from "@/lib/metaThrottle";

export async function POST(request: Request) {
  const workerSecret = process.env.CLOUDFLARE_QUEUE_SECRET;
  if (!workerSecret || request.headers.get("x-postflow-worker-secret") !== workerSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { postId } = await request.json() as { postId?: string };
  if (!postId) return NextResponse.json({ error: "postId is required" }, { status: 400 });
  const post = await prisma.post.findUnique({ where: { id: postId }, select: { pageId: true, storyStatus: true } });
  if (!post || post.storyStatus === "done" || post.storyStatus === "failed") return NextResponse.json({ ok: true });
  const gate = await reserveMetaJob("story", scopesForPost(post.pageId), postId);
  if (!gate.allowed) {
    const nextAttemptAt = new Date(Date.now() + gate.retryAfterSeconds * 1000);
    await prisma.post.update({ where: { id: postId }, data: { storyStatus: "pending", storyNextAttemptAt: nextAttemptAt, errorMsg: `[quota] ${gate.reason ?? "Chờ Meta hồi quota"}` } });
    return NextResponse.json({ error: gate.reason ?? "Chờ Meta hồi quota", deferredReason: "quota", retryAfterSeconds: gate.retryAfterSeconds }, { status: 503 });
  }
  const result = await attemptStory(postId);
  return result.retry
    ? NextResponse.json({ error: "Story failed; retry through Queue", retryAfterSeconds: result.retryAfterSeconds ?? 300 }, { status: 503 })
    : NextResponse.json({ ok: true });
}
