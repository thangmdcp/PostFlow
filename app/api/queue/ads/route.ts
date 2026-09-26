import { NextResponse } from "next/server";
import { attemptAutoAds } from "@/lib/autoAdsRunner";
import { prisma } from "@/lib/prisma";
import { reserveMetaJob, scopesForPost } from "@/lib/metaThrottle";

// A creative can need several short Meta-processing retries after publish.
// Keep the worker invocation alive long enough to finish or clean up.
export const maxDuration = 90;

export async function POST(request: Request) {
  const workerSecret = process.env.CLOUDFLARE_QUEUE_SECRET;
  if (!workerSecret || request.headers.get("x-postflow-worker-secret") !== workerSecret) {
    return NextResponse.json({ error: "Unauthorized", configured: Boolean(workerSecret), received: Boolean(request.headers.get("x-postflow-worker-secret")) }, { status: 401 });
  }
  const { postId } = await request.json() as { postId?: string };
  if (!postId) return NextResponse.json({ error: "postId is required" }, { status: 400 });
  const post = await prisma.post.findUnique({ where: { id: postId }, select: { pageId: true, adAccountUsed: true, adStatus: true, adPlatform: true, adPlacementConfig: true } });
  if (!post || post.adStatus === "done" || post.adStatus === "failed") return NextResponse.json({ ok: true });
  const placementPlatforms = post.adPlacementConfig && typeof post.adPlacementConfig === "object" && !Array.isArray(post.adPlacementConfig)
    ? (post.adPlacementConfig as Record<string, unknown>).publisherPlatforms
    : null;
  const needsInstagram = post.adPlatform === "instagram" || (Array.isArray(placementPlatforms) && placementPlatforms.some((item) => item === "instagram" || item === "threads"));
  const instagramUserId = needsInstagram && post.pageId
    ? (await prisma.fbConnection.findUnique({ where: { pageId: post.pageId }, select: { instagramUserId: true } }))?.instagramUserId
    : null;
  const gate = await reserveMetaJob("ads", scopesForPost(post.pageId, post.adAccountUsed, instagramUserId), postId);
  if (!gate.allowed) {
    const nextAttemptAt = new Date(Date.now() + gate.retryAfterSeconds * 1000);
    await prisma.post.update({ where: { id: postId }, data: { adStatus: "pending", adNextAttemptAt: nextAttemptAt, errorMsg: `[quota] ${gate.reason ?? "Chờ Meta hồi quota"}` } });
    return NextResponse.json({ error: gate.reason ?? "Chờ Meta hồi quota", deferredReason: "quota", retryAfterSeconds: gate.retryAfterSeconds }, { status: 503 });
  }
  const result = await attemptAutoAds(postId);
  return result.retry
    ? NextResponse.json({ error: "Ads failed; retry through Queue", retryAfterSeconds: result.retryAfterSeconds ?? 120 }, { status: 503 })
    : NextResponse.json({ ok: true });
}
