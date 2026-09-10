import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/prisma";
import { processFetchPost } from "@/lib/fetchPostJob";
import { enqueueFetch, enqueuePublish } from "@/lib/cloudflareQueue";

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const post = await prisma.post.findUnique({ where: { id: params.id } });
    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    const retryPublish = Boolean(post.finalCaption && post.pageId && (
      post.status === "partial" || post.fbPublishStatus || post.igPublishStatus
    ));

    await prisma.post.update({
      where: { id: params.id },
      data: {
        status: "queued", errorMsg: null,
        ...(retryPublish && post.publishToFacebook && !post.fbPostId ? { fbPublishStatus: "pending", fbErrorMsg: null } : {}),
        ...(retryPublish && post.publishToInstagram && !post.igPostId ? { igPublishStatus: "pending", igErrorMsg: null } : {}),
      },
    });

    // Use the exact same durable path as a newly-created batch. Falling back
    // keeps local installations usable before Cloudflare Queue is configured.
    if (retryPublish) {
      if (!await enqueuePublish(post.id)) {
        await prisma.post.update({ where: { id: post.id }, data: { status: post.status } });
        return NextResponse.json({ error: "Không thể đưa bài vào Queue" }, { status: 503 });
      }
    } else if (!await enqueueFetch(post.id)) {
      waitUntil(processFetchPost(post.id));
    }

    return NextResponse.json({ ok: true, status: "queued" }, { status: 202 });
  } catch (err) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
