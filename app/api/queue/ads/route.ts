import { NextResponse } from "next/server";
import { attemptAutoAds } from "@/lib/autoAdsRunner";

export async function POST(request: Request) {
  // Queue consumers authenticate with their dedicated worker secret. The
  // producer's enqueue secret is intentionally a different credential.
  const workerSecret = process.env.CLOUDFLARE_QUEUE_WORKER_SECRET;
  if (!workerSecret || request.headers.get("x-postflow-worker-secret") !== workerSecret) {
    return NextResponse.json({ error: "Unauthorized", configured: Boolean(workerSecret), received: Boolean(request.headers.get("x-postflow-worker-secret")) }, { status: 401 });
  }
  const { postId } = await request.json() as { postId?: string };
  if (!postId) return NextResponse.json({ error: "postId is required" }, { status: 400 });
  const result = await attemptAutoAds(postId);
  return result.retry
    ? NextResponse.json({ error: "Ads failed; retry through Queue", retryAfterSeconds: result.retryAfterSeconds ?? 120 }, { status: 503 })
    : NextResponse.json({ ok: true });
}
