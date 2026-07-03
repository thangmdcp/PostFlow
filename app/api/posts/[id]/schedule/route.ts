import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { pageId, scheduledAt, templateId, ctaHeadline } = (await req.json()) as {
      pageId: string;
      scheduledAt: string;
      templateId?: string;
      ctaHeadline?: string;
    };

    const post = await prisma.post.findUnique({ where: { id: params.id } });

    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    if (!post.finalCaption) {
      return NextResponse.json(
        { error: "Chưa build caption. Hãy điền đủ link aff của bạn trước." },
        { status: 400 }
      );
    }

    const scheduled = await prisma.post.update({
      where: { id: params.id },
      data: {
        pageId,
        scheduledAt: new Date(scheduledAt),
        status: "pending",
        ...(templateId ? { adTemplateId: templateId } : {}),
        ...(ctaHeadline ? { ctaHeadline } : {}),
      },
    });

    return NextResponse.json(scheduled);
  } catch (err) {
    console.error("PATCH /api/posts/[id]/schedule error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
