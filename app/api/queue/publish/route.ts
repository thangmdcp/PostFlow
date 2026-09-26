import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publishDuePost } from "@/lib/publishDuePost";
import { reserveMetaJob, scopesForPost } from "@/lib/metaThrottle";

export const maxDuration = 90;

function authorized(request: Request) {
  const secret = process.env.CLOUDFLARE_QUEUE_SECRET;
  return Boolean(secret && (
    request.headers.get("authorization") === `Bearer ${secret}` ||
    request.headers.get("x-postflow-worker-secret") === secret
  ));
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { postId, publishToPage } = await request.json() as { postId?: string; publishToPage?: boolean };
  if (!postId) return NextResponse.json({ error: "postId is required" }, { status: 400 });

  let post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) return NextResponse.json({ status: "missing" });
  if (post.status === "done") return NextResponse.json({ status: "done" });
  const instagramUserId = post.publishToInstagram && post.pageId
    ? (await prisma.fbConnection.findUnique({ where: { pageId: post.pageId }, select: { instagramUserId: true } }))?.instagramUserId
    : null;
  const gate = await reserveMetaJob("publish", scopesForPost(post.pageId, null, instagramUserId), postId);
  if (!gate.allowed) {
    await prisma.post.update({ where: { id: postId }, data: { status: "queued", errorMsg: `[quota] ${gate.reason ?? "Chờ Meta hồi quota"}` } });
    return NextResponse.json({ error: gate.reason ?? "Chờ Meta hồi quota", deferredReason: "quota", retryAfterSeconds: gate.retryAfterSeconds }, { status: 503 });
  }

  // A serverless invocation may be interrupted after claiming the row. Allow
  // the Queue's later retry to recover a claim that has been stuck for 10 min.
  if (post.status === "publishing") {
    if (post.updatedAt.getTime() > Date.now() - 10 * 60_000) {
      return NextResponse.json({ error: "Job is already being processed" }, { status: 409 });
    }
    await prisma.post.update({ where: { id: post.id }, data: { status: "queued" } });
  } else if (post.status === "failed" || post.status === "partial" || post.status === "pending") {
    await prisma.post.update({ where: { id: post.id }, data: { status: "queued" } });
  }

  post = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
  const result = await publishDuePost(post, { publishToPage });
  if (result.retryable && result.status !== "done") {
    // Returning a non-2xx response makes the Queue retry the same message.
    return NextResponse.json(result, { status: 502 });
  }
  return NextResponse.json(result);
}
