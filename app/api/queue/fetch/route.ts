import { NextResponse } from "next/server";
import { processFetchPost } from "@/lib/fetchPostJob";

export const maxDuration = 300;

export async function POST(request: Request) {
  // The consumer uses the same Queue secret as the producer. This is the
  // credential that is verified on the Worker /enqueue endpoint, so it is
  // guaranteed to match on both services.
  const workerSecret = process.env.CLOUDFLARE_QUEUE_SECRET;
  if (!workerSecret || request.headers.get("x-postflow-worker-secret") !== workerSecret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { postId, stage } = await request.json() as { postId?: string; stage?: string };
  if (!postId) return NextResponse.json({ error: "postId is required" }, { status: 400 });
  if (stage !== undefined && !["legacy", "download", "upload", "render"].includes(stage)) return NextResponse.json({ error: "Invalid Fetch stage" }, { status: 400 });
  const deliveryStage = stage === "download" || stage === "upload" || stage === "render" ? stage : "legacy";
  const started = Date.now();
  const result = await processFetchPost(postId, deliveryStage);
  console.info("[fetch]", { postId, stage: deliveryStage, result: result.status, durationMs: Date.now() - started });
  if (result.status === "deferred") {
    return NextResponse.json({
      error: "Nguồn Facebook tạm bận; retry qua Queue",
      retryAfterSeconds: result.retryAfterSeconds ?? 30,
    }, { status: 503 });
  }
  return NextResponse.json({ ok: true, fetchStatus: result.status, ...(result.retryAfterSeconds ? { retryAfterSeconds: result.retryAfterSeconds } : {}) });
}
