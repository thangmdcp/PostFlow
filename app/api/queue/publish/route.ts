import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publishDuePost } from "@/lib/publishDuePost";
import { reserveMetaJob, scopesForPost } from "@/lib/metaThrottle";
import { preparePublishMedia } from "@/lib/preparePublishMedia";
import { SourceFetchError } from "@/lib/sourceFetchError";

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
  if (post?.sourceKind === "existing_facebook_post") return NextResponse.json({ status: "skipped", reason: "existing_post_ads_only" });
  if (!post) return NextResponse.json({ status: "missing" });
  if (post.status === "done") return NextResponse.json({ status: "done" });
  if (!["pending", "queued", "publishing", "partial", "failed"].includes(post.status)) {
    return NextResponse.json({ status: "cancelled" });
  }
  // Recover a stale publish claim before media preparation, not after quota.
  if (post.status === "publishing") {
    if (post.updatedAt.getTime() > Date.now() - 10 * 60_000) return NextResponse.json({ error: "Job is already being processed" }, { status: 409 });
    const recovered = await prisma.post.updateMany({ where: { id: post.id, status: "publishing", updatedAt: post.updatedAt }, data: { status: "queued" } });
    if (!recovered.count) return NextResponse.json({ status: "skipped" });
    post = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
  }
  try {
    if (!await preparePublishMedia(post, publishToPage)) return NextResponse.json({ status: "preparing_media" });
  } catch (cause) {
    const error = cause instanceof SourceFetchError ? cause : null;
    const retryable = error?.retryable ?? true;
    await prisma.post.updateMany({ where: { id: postId, status: { in: ["pending", "queued", "partial", "failed"] } },
      data: { errorMsg: error?.message ?? "Chưa kiểm tra được media trước khi đăng.", ...(!retryable ? { status: "failed" } : {}) } });
    return NextResponse.json({ error: error?.message ?? "Media check failed", retryAfterSeconds: 60 }, { status: retryable ? 503 : 200 });
  }
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
  if (post.status === "failed" || post.status === "partial" || post.status === "pending") {
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
