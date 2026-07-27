import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/prisma";
import { processFetchPost } from "@/lib/fetchPostJob";
import { enqueueFetch } from "@/lib/cloudflareQueue";

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const post = await prisma.post.findUnique({ where: { id: params.id } });
    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    await prisma.post.update({
      where: { id: params.id },
      data: { status: "fetching", errorMsg: null },
    });

    // Use the exact same durable path as a newly-created batch. Falling back
    // keeps local installations usable before Cloudflare Queue is configured.
    if (!await enqueueFetch(post.id)) waitUntil(processFetchPost(post.id));

    return NextResponse.json({ ok: true, status: "fetching" }, { status: 202 });
  } catch (err) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
