import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchPostData } from "@/lib/rapidapi";
import { extractLinks } from "@/lib/extractLinks";

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

    setImmediate(() => retryPost(post.id, post.sourceUrl));

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function retryPost(postId: string, sourceUrl: string) {
  try {
    const data = await fetchPostData(sourceUrl);
    const caption = data.caption ?? "";
    const links = extractLinks(caption);

    // Delete old extracted links first
    await prisma.extractedLink.deleteMany({ where: { postId } });

    await prisma.post.update({
      where: { id: postId },
      data: {
        title: data.title ?? null,
        rawCaption: caption,
        finalCaption: null,
        status: "ready",
        extractedLinks: {
          create: links.map((url, i) => ({
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
