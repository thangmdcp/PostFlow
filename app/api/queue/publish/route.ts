import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publishDuePost } from "@/lib/publishDuePost";

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

  // A serverless invocation may be interrupted after claiming the row. Allow
  // the Queue's later retry to recover a claim that has been stuck for 10 min.
  if (post.status === "publishing") {
    if (post.updatedAt.getTime() > Date.now() - 10 * 60_000) {
      return NextResponse.json({ error: "Job is already being processed" }, { status: 409 });
    }
    await prisma.post.update({ where: { id: post.id }, data: { status: "queued" } });
  } else if (post.status === "failed" || post.status === "pending") {
    await prisma.post.update({ where: { id: post.id }, data: { status: "queued" } });
  }

  post = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
  const result = await publishDuePost(post, { publishToPage });
  if (result.status === "failed") {
    // Returning a non-2xx response makes the Queue retry the same message.
    return NextResponse.json(result, { status: 502 });
  }
  return NextResponse.json(result);
}
