import { NextResponse } from "next/server";
import { processFetchPost } from "@/lib/fetchPostJob";

export async function POST(request: Request) {
  // The consumer uses the same Queue secret as the producer. This is the
  // credential that is verified on the Worker /enqueue endpoint, so it is
  // guaranteed to match on both services.
  const workerSecret = process.env.CLOUDFLARE_QUEUE_SECRET;
  if (!workerSecret || request.headers.get("x-postflow-worker-secret") !== workerSecret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { postId } = await request.json() as { postId?: string };
  if (!postId) return NextResponse.json({ error: "postId is required" }, { status: 400 });
  await processFetchPost(postId);
  return NextResponse.json({ ok: true });
}
