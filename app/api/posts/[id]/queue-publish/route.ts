import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enqueuePublish } from "@/lib/cloudflareQueue";
import { persistCommentJobs } from "@/lib/autoCommentsRunner";
import { parsePublishTargets, validatePublishTargets, type PublishTarget } from "@/lib/publishTargets";
import { validateAdSelection } from "@/lib/adSelection";
import { Prisma } from "@prisma/client";
import { parseAdPlacementConfig, validateAdPlacements, type AdPlacementConfig } from "@/lib/adPlacements";
import { resolveAdBudgetSnapshot, type AdBudgetInput } from "@/lib/adBudgetRequest";
import { BudgetPolicyError } from "@/lib/adBudgetPolicy";
import { validateAdCta, type AdCtaType } from "@/lib/adCta";
import type { BatchAdvantageConfig } from "@/lib/adAdvantage";
import { resolvePostAdAdvantage } from "@/lib/adAdvantageServer";
import { AdTemplateConfigurationError } from "@/lib/facebook";

type QueuePublishBody = {
  pageId: string;
  templateId?: string;
  publishToPage?: boolean;
  ageMinFrom?: string; ageMinTo?: string;
  ageMaxFrom?: string; ageMaxTo?: string;
  gender?: string;
  budget?: AdBudgetInput;
  adAccountId?: string;
  ctaHeadline?: string;
  adStatus?: "ACTIVE" | "PAUSED";
  comments?: { text: string; imageUrl?: string }[];
  storyEnabled?: boolean;
  storyCount?: number;
  publishTargets?: PublishTarget[];
  adPlacements?: AdPlacementConfig;
  adCtaType?: AdCtaType;
  adAdvantage?: BatchAdvantageConfig;
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
    if (!["ready", "failed", "partial", "pending"].includes(post.status)) {
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
    const publishTargets = parsePublishTargets(body.publishTargets, post);
    const targetError = validatePublishTargets(
      post,
      connection,
      publishTargets,
      Boolean(body.templateId),
      post.extractedLinks.some((link) => Boolean(link.myUrl))
    );
    if (targetError) return NextResponse.json({ error: targetError }, { status: 400 });
    const adSelectionError = await validateAdSelection(body.templateId, body.adAccountId);
    if (adSelectionError) return NextResponse.json({ error: adSelectionError }, { status: 400 });
    const budgetSnapshot = await resolveAdBudgetSnapshot({
      templateId: body.templateId,
      accountId: body.adAccountId,
      budget: body.budget,
    });
    const destinationUrl = body.templateId ? post.extractedLinks.find((link) => link.myUrl)?.myUrl ?? null : null;
    const cta = validateAdCta({ ctaType: body.adCtaType, destinationUrl, adsEnabled: Boolean(body.templateId) });
    if (cta.error) return NextResponse.json({ error: cta.error }, { status: 400 });
    const advantageSnapshot = await resolvePostAdAdvantage(body.templateId, body.adAccountId, body.adAdvantage);
    const parsedPlacements = body.templateId && !advantageSnapshot?.placementsEnabled ? parseAdPlacementConfig(body.adPlacements) : null;
    if (body.templateId && !advantageSnapshot?.placementsEnabled) {
      const placementError = validateAdPlacements(parsedPlacements, {
        instagramOnly: publishTargets.length === 1 && publishTargets[0] === "instagram",
        hasInstagram: Boolean(connection.instagramUserId),
      });
      if (placementError) return NextResponse.json({ error: placementError }, { status: 400 });
    }
    const publishToFacebook = publishTargets.includes("facebook");
    const publishToInstagram = publishTargets.includes("instagram");

    const claim = await prisma.post.updateMany({
      where: { id: post.id, status: { in: ["ready", "failed", "partial", "pending"] } },
      data: {
        pageId: body.pageId,
        status: "queued",
        errorMsg: null,
        publishToFacebook,
        publishToInstagram,
        adPlatform: publishToInstagram && !publishToFacebook ? "instagram" : "facebook",
        adDestinationUrl: destinationUrl,
        adCtaType: body.templateId ? cta.ctaType : null,
        adCampaignId: null,
        adSetId: null,
        adCreativeId: null,
        adId: null,
        adStatus: null,
        adNextAttemptAt: null,
        adAttempt: 0,
        ...(publishToFacebook && !post.fbPostId ? { fbPublishStatus: "pending", fbErrorMsg: null } : {}),
        ...(publishToInstagram && !post.igPostId ? { igPublishStatus: "pending", igErrorMsg: null } : {}),
        adTemplateId: body.templateId ?? null,
        adPlacementConfig: parsedPlacements ? parsedPlacements as unknown as Prisma.InputJsonValue : Prisma.DbNull,
        adAdvantageConfig: advantageSnapshot ? advantageSnapshot as unknown as Prisma.InputJsonValue : Prisma.DbNull,
        ...(body.ctaHeadline ? { ctaHeadline: body.ctaHeadline } : {}),
        ...(body.adStatus ? { adPublishStatus: body.adStatus } : {}),
        ...(body.ageMinFrom !== undefined ? { adAgeMin: Number(body.ageMinFrom) } : {}),
        ...(body.ageMaxFrom !== undefined ? { adAgeMax: Number(body.ageMaxFrom) } : {}),
        ...(body.gender !== undefined ? { adGender: body.gender } : {}),
        ...(budgetSnapshot ? {
          adBudget: budgetSnapshot.amountMajor,
          adBudgetMinor: budgetSnapshot.amountMinor,
          adBudgetCurrency: budgetSnapshot.currency,
        } : { adBudget: null, adBudgetMinor: null, adBudgetCurrency: null }),
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Không thể xếp hàng đăng bài", ...(error instanceof BudgetPolicyError ? { code: error.code } : {}) },
      { status: error instanceof BudgetPolicyError ? error.status : error instanceof AdTemplateConfigurationError ? 400 : 500 },
    );
  }
}
