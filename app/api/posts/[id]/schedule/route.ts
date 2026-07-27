import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { persistCommentJobs } from "@/lib/autoCommentsRunner";
import { enqueuePublish } from "@/lib/cloudflareQueue";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { pageId, scheduledAt, templateId, ctaHeadline, adStatus, adStartAt, adAccountId, adAgeMin, adAgeMax, adGender, adBudget, comments, storyEnabled, storyCount } = (await req.json()) as {
      pageId: string;
      scheduledAt: string;
      templateId?: string;
      ctaHeadline?: string;
      adStatus?: "ACTIVE" | "PAUSED";
      adStartAt?: string | null;
      adAccountId?: string;
      adAgeMin?: number;
      adAgeMax?: number;
      adGender?: string;
      adBudget?: string;
      comments?: { text: string; imageUrl?: string }[];
      storyEnabled?: boolean; storyCount?: number;
    };

    const post = await prisma.post.findUnique({ where: { id: params.id }, include: { extractedLinks: true } });

    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    if (!post.finalCaption) {
      return NextResponse.json(
        { error: "Chưa build caption. Hãy điền đủ link aff của bạn trước." },
        { status: 400 }
      );
    }
    if (post.extractedLinks.some((link) => !link.myUrl)) {
      return NextResponse.json({ error: "Còn link chưa đổi sang link aff. Hoàn tất link aff trước khi lên lịch." }, { status: 400 });
    }
    if (post.extractedLinks.some((link) => post.finalCaption!.includes(link.competitorUrl))) {
      return NextResponse.json({ error: "Caption vẫn còn link gốc. Hoàn tất link aff trước khi lên lịch." }, { status: 400 });
    }

    const scheduled = await prisma.post.update({
      where: { id: params.id },
      data: {
        pageId,
        scheduledAt: new Date(scheduledAt),
        status: "pending",
        ...(templateId ? { adTemplateId: templateId } : {}),
        ...(ctaHeadline ? { ctaHeadline } : {}),
        ...(adStatus ? { adPublishStatus: adStatus } : {}),
        // A normal re-schedule intentionally clears preparation mode.
        adStartAt: adStartAt ? new Date(adStartAt) : null,
        ...(adAccountId ? { adAccountUsed: adAccountId } : {}),
        // The batch table already rolled and displayed this row's ad
        // params — persist them so the cron-triggered ad creation later
        // (once this post actually publishes) uses the exact same values
        // instead of re-rolling its own from the TKQC account's range.
        ...(adAgeMin !== undefined ? { adAgeMin } : {}),
        ...(adAgeMax !== undefined ? { adAgeMax } : {}),
        ...(adGender !== undefined ? { adGender } : {}),
        ...(adBudget !== undefined ? { adBudget } : {}),
        ...(storyEnabled !== undefined ? { storyEnabled } : {}),
        ...(storyCount !== undefined ? { storyCount } : {}),
      },
    });

    if (comments) await persistCommentJobs(params.id, comments);

    // A time that has already passed still goes through Queue. This keeps the
    // same concurrency/retry protection as normally scheduled posts.
    if (new Date(scheduledAt) <= new Date()) {
      if (await enqueuePublish(scheduled.id)) {
        const queued = await prisma.post.update({ where: { id: scheduled.id }, data: { status: "queued" } });
        return NextResponse.json(queued, { status: 202 });
      }
    }

    return NextResponse.json(scheduled);
  } catch (err) {
    console.error("PATCH /api/posts/[id]/schedule error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
