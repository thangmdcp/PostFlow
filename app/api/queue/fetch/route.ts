import { NextResponse } from "next/server";
import { processFetchPost } from "@/lib/fetchPostJob";

export const maxDuration = 180;

export async function POST(request: Request) {
  // The consumer uses the same Queue secret as the producer. This is the
  // credential that is verified on the Worker /enqueue endpoint, so it is
  // guaranteed to match on both services.
  const workerSecret = process.env.CLOUDFLARE_QUEUE_SECRET;
  if (!workerSecret || request.headers.get("x-postflow-worker-secret") !== workerSecret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { postId } = await request.json() as { postId?: string };
  if (!postId) return NextResponse.json({ error: "postId is required" }, { status: 400 });
  const result = await processFetchPost(postId);
  if (result.status === "deferred") {
    return NextResponse.json({
      error: "Nguồn Facebook tạm bận; retry qua Queue",
      retryAfterSeconds: result.retryAfterSeconds ?? 30,
    }, { status: 503 });
  }
  return NextResponse.json({ ok: true, fetchStatus: result.status });
}
