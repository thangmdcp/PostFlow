import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildCaption } from "@/lib/buildCaption";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { myUrl } = (await req.json()) as { myUrl: string };

    if (!myUrl || !myUrl.startsWith("http")) {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }

    // Update this link
    const link = await prisma.extractedLink.update({
      where: { id: params.id },
      data: { myUrl },
      include: {
        post: { include: { extractedLinks: { orderBy: { order: "asc" } } } },
      },
    });

    const post = link.post;
    const allLinks = post.extractedLinks;

    // Check if all links have myUrl filled
    const allFilled = allLinks.every((l) => l.id === params.id ? myUrl : l.myUrl);

    if (allFilled && post.rawCaption) {
      const pairs = allLinks.map((l) => ({
        competitorUrl: l.competitorUrl,
        myUrl: (l.id === params.id ? myUrl : l.myUrl) ?? l.competitorUrl,
      }));

      const finalCaption = buildCaption(post.rawCaption, pairs);

      await prisma.post.update({
        where: { id: post.id },
        data: { finalCaption },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("PATCH /api/links/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
