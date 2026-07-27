import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enqueuePublish } from "@/lib/cloudflareQueue";
import { persistCommentJobs } from "@/lib/autoCommentsRunner";

type QueuePublishBody = {
  pageId: string;
  templateId?: string;
  publishToPage?: boolean;
  ageMinFrom?: string; ageMinTo?: string;
  ageMaxFrom?: string; ageMaxTo?: string;
  gender?: string;
  budgetMin?: string; budgetMax?: string;
  adAccountId?: string;
  ctaHeadline?: string;
  adStatus?: "ACTIVE" | "PAUSED";
  comments?: { text: string; imageUrl?: string }[];
  storyEnabled?: boolean;
  storyCount?: number;
};

// The browser only records the user's choices and asks the trusted Vercel
// producer to enqueue a lightweight job. The Worker later reads the post from
// Supabase and publishes it with the same safe concurrency as scheduled jobs.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json() as QueuePublishBody;
    if (!body.pageId) return NextResponse.json({ error: "pageId is required" }, { status: 400 });

    const post = await prisma.post.findUnique({
      where: { id: params.id },
      include: { extractedLinks: true },
    });
    if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });
    if (!["ready", "failed", "pending"].includes(post.status)) {
      return NextResponse.json({ error: "Bài đang được xử lý hoặc đã đăng" }, { status: 409 });
    }
    if (!post.finalCaption) return NextResponse.json({ error: "Chưa có caption. Hãy lưu link aff trước." }, { status: 400 });
    if (post.extractedLinks.some((link) => !link.myUrl)) {
      return NextResponse.json({ error: "Còn link chưa điền link aff. Kiểm tra lại trước khi đăng." }, { status: 400 });
    }
    if (post.extractedLinks.some((link) => post.finalCaption!.includes(link.competitorUrl))) {
      return NextResponse.json({ error: "Caption vẫn còn link gốc chưa được thay thế." }, { status: 400 });
    }
    const connection = await prisma.fbConnection.findUnique({ where: { pageId: body.pageId } });
    if (!connection) return NextResponse.json({ error: "Không tìm thấy kết nối Facebook Page" }, { status: 400 });

    const claim = await prisma.post.updateMany({
      where: { id: post.id, status: { in: ["ready", "failed", "pending"] } },
      data: {
        pageId: body.pageId,
        status: "queued",
        errorMsg: null,
        ...(body.templateId ? { adTemplateId: body.templateId } : {}),
        ...(body.ctaHeadline ? { ctaHeadline: body.ctaHeadline } : {}),
        ...(body.adStatus ? { adPublishStatus: body.adStatus } : {}),
        ...(body.ageMinFrom !== undefined ? { adAgeMin: Number(body.ageMinFrom) } : {}),
        ...(body.ageMaxFrom !== undefined ? { adAgeMax: Number(body.ageMaxFrom) } : {}),
        ...(body.gender !== undefined ? { adGender: body.gender } : {}),
        ...(body.budgetMin !== undefined ? { adBudget: body.budgetMin } : {}),
        ...(body.adAccountId ? { adAccountUsed: body.adAccountId } : {}),
        ...(body.storyEnabled !== undefined ? { storyEnabled: body.storyEnabled } : {}),
        ...(body.storyCount !== undefined ? { storyCount: body.storyCount } : {}),
      },
    });
    if (claim.count === 0) return NextResponse.json({ error: "Bài vừa được xử lý ở nơi khác" }, { status: 409 });

    if (body.comments) await persistCommentJobs(post.id, body.comments);

    if (!await enqueuePublish(post.id, { publishToPage: body.publishToPage })) {
      await prisma.post.update({
        where: { id: post.id },
        data: { status: post.status, errorMsg: "Không thể đưa bài vào Queue. Hãy thử lại." },
      });
      return NextResponse.json({ error: "Cloudflare Queue chưa sẵn sàng. Bài chưa được đăng." }, { status: 503 });
    }

    return NextResponse.json({ queued: true, status: "queued" }, { status: 202 });
  } catch (error) {
    console.error("POST /api/posts/[id]/queue-publish error:", error);
    return NextResponse.json({ error: "Không thể xếp hàng đăng bài" }, { status: 500 });
  }
}
