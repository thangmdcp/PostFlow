import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { persistCommentJobs } from "@/lib/autoCommentsRunner";
import { enqueuePublish } from "@/lib/cloudflareQueue";
import { parsePublishTargets, validatePublishTargets, type PublishTarget } from "@/lib/publishTargets";
import { validateAdSelection } from "@/lib/adSelection";
import { Prisma } from "@prisma/client";
import { parseAdPlacementConfig, validateAdPlacements, type AdPlacementConfig } from "@/lib/adPlacements";
import { resolveAdBudgetSnapshot, type AdBudgetInput } from "@/lib/adBudgetRequest";
import { BudgetPolicyError } from "@/lib/adBudgetPolicy";
import { validateAdCta, validateAdCtaScope, type AdCtaScope, type AdCtaType } from "@/lib/adCta";
import type { BatchAdvantageConfig } from "@/lib/adAdvantage";
import { resolvePostAdAdvantage } from "@/lib/adAdvantageServer";
import { AdTemplateConfigurationError } from "@/lib/facebook";
import { ensureSponsoredContentHashtag } from "@/lib/sponsoredContent";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { pageId, scheduledAt, templateId, publishToPage, ctaHeadline, adCtaType, adCtaScope, adStatus, adStartAt, adAccountId, adAgeMin, adAgeMax, adGender, budget, comments, storyEnabled, storyCount, publishTargets, adPlacements, adAdvantage } = (await req.json()) as {
      pageId: string;
      scheduledAt: string;
      templateId?: string;
      publishToPage?: boolean;
      ctaHeadline?: string;
      adCtaType?: AdCtaType;
      adCtaScope?: AdCtaScope;
      adStatus?: "ACTIVE" | "PAUSED";
      adStartAt?: string | null;
      adAccountId?: string;
      adAgeMin?: number;
      adAgeMax?: number;
      adGender?: string;
      budget?: AdBudgetInput;
      comments?: { text: string; imageUrl?: string }[];
      storyEnabled?: boolean; storyCount?: number;
      publishTargets?: PublishTarget[];
      adPlacements?: AdPlacementConfig;
      adAdvantage?: BatchAdvantageConfig;
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
    const connection = await prisma.fbConnection.findUnique({ where: { pageId } });
    if (!connection) return NextResponse.json({ error: "Không tìm thấy kết nối Facebook Page" }, { status: 400 });
    const targets = parsePublishTargets(publishTargets, post);
    const targetError = validatePublishTargets(
      post,
      connection,
      targets,
      Boolean(templateId),
      post.extractedLinks.some((link) => Boolean(link.myUrl))
    );
    if (targetError) return NextResponse.json({ error: targetError }, { status: 400 });
    const adSelectionError = await validateAdSelection(templateId, adAccountId);
    if (adSelectionError) return NextResponse.json({ error: adSelectionError }, { status: 400 });
    const budgetSnapshot = await resolveAdBudgetSnapshot({ templateId, accountId: adAccountId, budget });
    const destinationUrl = templateId ? post.extractedLinks.find((link) => link.myUrl)?.myUrl ?? null : null;
    const cta = validateAdCta({ ctaType: adCtaType, destinationUrl, adsEnabled: Boolean(templateId) });
    if (cta.error) return NextResponse.json({ error: cta.error }, { status: 400 });
    const selectedTemplate = templateId ? await prisma.campaignTemplate.findFirst({ where: { campaignId: templateId }, select: { settings: true } }) : null;
    const templatePostType = (selectedTemplate?.settings as Record<string, unknown> | null)?.postType;
    const ctaScope = validateAdCtaScope({ scope: adCtaScope, ctaType: cta.ctaType, publishToFacebook: targets.includes("facebook"), publishedToPage: publishToPage === true || templatePostType !== "dark" });
    if (templateId && ctaScope.error) return NextResponse.json({ error: ctaScope.error }, { status: 400 });
    const advantageSnapshot = await resolvePostAdAdvantage(templateId, adAccountId, adAdvantage);
    const parsedPlacements = templateId && !advantageSnapshot?.placementsEnabled ? parseAdPlacementConfig(adPlacements) : null;
    if (templateId && !advantageSnapshot?.placementsEnabled) {
      const placementError = validateAdPlacements(parsedPlacements, {
        instagramOnly: targets.length === 1 && targets[0] === "instagram",
        hasInstagram: Boolean(connection.instagramUserId),
      });
      if (placementError) return NextResponse.json({ error: placementError }, { status: 400 });
    }

    const scheduled = await prisma.post.update({
      where: { id: params.id },
      data: {
        pageId,
        finalCaption: ensureSponsoredContentHashtag(post.finalCaption),
        sponsoredContentTagEnabled: true,
        scheduledAt: new Date(scheduledAt),
        status: "pending",
        publishToFacebook: targets.includes("facebook"),
        publishToInstagram: targets.includes("instagram"),
        adPlatform: targets.length === 1 && targets[0] === "instagram" ? "instagram" : "facebook",
        adDestinationUrl: destinationUrl,
        adCtaType: templateId ? cta.ctaType : null,
        adCtaScope: templateId ? ctaScope.scope : null,
        fbCtaStatus: templateId && ctaScope.scope === "AD_AND_FACEBOOK_POST" ? "pending" : null,
        fbCtaErrorMsg: null,
        fbCtaNextAttemptAt: null,
        fbCtaAttempt: 0,
        fbCtaVerifiedAt: null,
        adCampaignId: null,
        adSetId: null,
        adCreativeId: null,
        adId: null,
        adStatus: null,
        adNextAttemptAt: null,
        adAttempt: 0,
        fbPublishStatus: targets.includes("facebook") ? "pending" : null,
        igPublishStatus: targets.includes("instagram") ? "pending" : null,
        fbErrorMsg: null,
        igErrorMsg: null,
        adTemplateId: templateId ?? null,
        adPlacementConfig: parsedPlacements ? parsedPlacements as unknown as Prisma.InputJsonValue : Prisma.DbNull,
        adAdvantageConfig: advantageSnapshot ? advantageSnapshot as unknown as Prisma.InputJsonValue : Prisma.DbNull,
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
        ...(templateId && advantageSnapshot?.audienceEnabled
          ? { adAgeMax: null, adGender: null }
          : {
              ...(adAgeMax !== undefined ? { adAgeMax } : {}),
              ...(adGender !== undefined ? { adGender } : {}),
            }),
        ...(budgetSnapshot ? {
          adBudget: budgetSnapshot.amountMajor,
          adBudgetMinor: budgetSnapshot.amountMinor,
          adBudgetCurrency: budgetSnapshot.currency,
        } : { adBudget: null, adBudgetMinor: null, adBudgetCurrency: null }),
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
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error", ...(err instanceof BudgetPolicyError ? { code: err.code } : {}) },
      { status: err instanceof BudgetPolicyError ? err.status : err instanceof AdTemplateConfigurationError ? 400 : 500 },
    );
  }
}
