import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/prisma";
import { fetchPostFields } from "@/lib/postProcessing";

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

    waitUntil(retryPost(post.id, post.sourceUrl));

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function retryPost(postId: string, sourceUrl: string) {
  try {
    const fields = await fetchPostFields(sourceUrl);

    // Delete old extracted links first
    await prisma.extractedLink.deleteMany({ where: { postId } });

    await prisma.post.update({
      where: { id: postId },
      data: {
        title: fields.title,
        rawCaption: fields.rawCaption,
        finalCaption: null,
        stableMediaUrl: fields.stableMediaUrl,
        thumbnailUrl: fields.thumbnailUrl,
        mediaUrls: fields.mediaUrls,
        mediaType: fields.mediaType,
        cloudinaryId: fields.cloudinaryId,
        status: "ready",
        extractedLinks: {
          create: fields.links.map((url, i) => ({
            order: i + 1,
            competitorUrl: url,
          })),
        },
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await prisma.post.update({
      where: { id: postId },
      data: { status: "failed", errorMsg: msg },
    });
  }
}
