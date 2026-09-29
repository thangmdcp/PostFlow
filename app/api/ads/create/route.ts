import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { AdTemplateConfigurationError, cloneAdCampaign, fetchAdTemplateBlueprint } from "@/lib/facebook";
import { portableTemplateBlueprint, templateBlueprintFromSettings } from "@/lib/adTemplateBlueprint";
import { parseAdPlacementConfig, validateAdPlacements, type AdPlacementConfig } from "@/lib/adPlacements";
import { BudgetPolicyError, validateBudgetForAccount } from "@/lib/adBudgetPolicy";
import { validateAdCta, validateAdCtaScope, type AdCtaScope, type AdCtaType } from "@/lib/adCta";
import { parseAdAdvantageConfig, resolveAdAdvantageConfig, type BatchAdvantageConfig } from "@/lib/adAdvantage";
import { Prisma } from "@prisma/client";
import { enqueueAds } from "@/lib/cloudflareQueue";

export async function POST(req: Request) {

  try {
    const { postId, templateCampaignId, adAccountId, budget, ageMin, ageMax, gender, adStatus, adCtaType, adCtaScope, adAdvantage, adPlacements } = (await req.json()) as {
      postId: string;
      templateCampaignId: string;
      adAccountId?: string;
      budget?: { amount?: string; currency?: string };
      ageMin?: number;
      ageMax?: number;
      gender?: string;
      adStatus?: "ACTIVE" | "PAUSED";
      adCtaType?: AdCtaType;
      adCtaScope?: AdCtaScope;
      adAdvantage?: BatchAdvantageConfig;
      adPlacements?: AdPlacementConfig;
    };

    const post = await prisma.post.findUnique({
      where: { id: postId },
      include: { extractedLinks: { orderBy: { order: "asc" } } },
    });

    if (!post || post.status !== "done" || !post.pageId) {
      return NextResponse.json(
        { error: "Post must be published before creating an ad" },
        { status: 400 }
      );
    }
    const instagramOnly = post.publishToInstagram && !post.publishToFacebook;
    if ((!instagramOnly && !post.fbPostId) || (instagramOnly && !post.igPostId)) {
      return NextResponse.json({ error: instagramOnly ? "Bài Instagram chưa đăng thành công" : "Bài Facebook chưa đăng thành công" }, { status: 400 });
    }
    if (post.extractedLinks.some((link) => !link.myUrl || post.finalCaption?.includes(link.competitorUrl))) {
      return NextResponse.json({ error: "Bài chưa đổi xong link aff, không thể tạo Ads." }, { status: 400 });
    }

    const fbConn = await prisma.fbConnection.findUnique({
      where: { pageId: post.pageId },
    });

    if (!fbConn) {
      return NextResponse.json({ error: "No FB connection found for this page" }, { status: 400 });
    }
    if (instagramOnly && !fbConn.instagramUserId) {
      return NextResponse.json({ error: "Page chưa kết nối Instagram Professional" }, { status: 400 });
    }

    // Use selected ad account (required from UI)
    const resolvedAdAccountId = adAccountId;
    if (!resolvedAdAccountId) {
      return NextResponse.json({ error: "No ad account selected" }, { status: 400 });
    }

    // Get access token for the selected ad account
    const adAccount = adAccountId
      ? await prisma.fbAdAccount.findUnique({ where: { accountId: adAccountId } })
      : null;
    if (!adAccount) return NextResponse.json({ error: `Không tìm thấy tài khoản quảng cáo ${resolvedAdAccountId}.` }, { status: 400 });
    if (!adAccount.accessToken) return NextResponse.json({ error: `Tài khoản quảng cáo ${resolvedAdAccountId} chưa có access token.` }, { status: 400 });
    const accessToken = adAccount.accessToken;

    const template = await prisma.campaignTemplate.findFirst({
      where: { campaignId: templateCampaignId },
      select: { adAccountId: true, settings: true },
    });
    if (!template) return NextResponse.json({ error: "Không tìm thấy template quảng cáo đã chọn." }, { status: 400 });
    const crossAccount = template.adAccountId !== resolvedAdAccountId;
    let blueprint = templateBlueprintFromSettings(template.settings);
    if (!blueprint) {
      if (crossAccount) {
        return NextResponse.json({ error: "Template cũ thiếu snapshot Ad Set; hãy quét và lưu lại trước khi dùng cho TKQC khác." }, { status: 400 });
      }
      blueprint = await fetchAdTemplateBlueprint(templateCampaignId, accessToken);
    }
    const portableTemplate = portableTemplateBlueprint(blueprint, crossAccount);
    const advantageSnapshot = parseAdAdvantageConfig(post.adAdvantageConfig)
      ?? resolveAdAdvantageConfig(adAdvantage, portableTemplate.blueprint.useCampaignBudget);
    const placementSnapshot = advantageSnapshot.placementsEnabled
      ? null
      : parseAdPlacementConfig(adPlacements) ?? parseAdPlacementConfig(post.adPlacementConfig);
    if (!advantageSnapshot.placementsEnabled) {
      const placementError = validateAdPlacements(placementSnapshot, {
        instagramOnly,
        hasInstagram: Boolean(fbConn.instagramUserId),
      });
      if (placementError) return NextResponse.json({ error: placementError }, { status: 400 });
    }

    // facebook.ts prepends act_ internally, so strip it here if present
    const rawAdAccountId = resolvedAdAccountId.replace(/^act_/, "");
    if (!budget?.amount || !budget.currency) {
      return NextResponse.json({ error: "Ngân sách phải kèm currency của TKQC.", code: "BUDGET_INVALID" }, { status: 400 });
    }
    const verifiedBudget = await validateBudgetForAccount({
      accountId: resolvedAdAccountId,
      amount: budget.amount,
      currency: budget.currency,
    });

    // Extract utm_content from the first affiliate link as the campaign name.
    const affUrl = post.extractedLinks?.find((l) => l.myUrl)?.myUrl ?? "";
    const cta = validateAdCta({ ctaType: adCtaType, destinationUrl: affUrl, adsEnabled: true });
    if (cta.error) return NextResponse.json({ error: cta.error }, { status: 400 });
    const ctaScope = validateAdCtaScope({ scope: adCtaScope, ctaType: cta.ctaType, publishToFacebook: !instagramOnly, publishedToPage: post.publishToFacebook });
    if (ctaScope.error) return NextResponse.json({ error: ctaScope.error }, { status: 400 });
    let campaignName = "";
    try {
      const parsed = new URL(affUrl);
      campaignName = decodeURIComponent(parsed.searchParams.get("utm_content") ?? "").trim().replace(/[-_]+$/, "");
    } catch { /* ignore */ }

    const result = await cloneAdCampaign(
      portableTemplate.blueprint,
      post.pageId,
      instagramOnly
        ? { platform: "instagram", igPostId: post.igPostId!, instagramUserId: fbConn.instagramUserId!, destinationUrl: affUrl, ctaType: cta.ctaType }
        : { platform: "facebook", fbPostId: post.fbPostId!, instagramUserId: fbConn.instagramUserId ?? undefined, destinationUrl: affUrl || undefined, ctaType: cta.ctaType },
      rawAdAccountId,
      accessToken,
      verifiedBudget.amountMinor,
      fbConn.accessToken,
      campaignName || undefined,
      ageMin,
      ageMax,
      gender,
      adStatus ?? "PAUSED",
      undefined,
      placementSnapshot ?? undefined,
      advantageSnapshot,
      {
        campaignId: post.adCampaignId,
        adSetId: post.adSetId,
        creativeId: post.adCreativeId,
        adId: post.adId,
      },
      async (progress) => {
        await prisma.post.update({
          where: { id: postId },
          data: {
            ...(progress.campaignId ? { adCampaignId: progress.campaignId } : {}),
            ...(progress.adSetId ? { adSetId: progress.adSetId } : {}),
            ...(progress.creativeId ? { adCreativeId: progress.creativeId } : {}),
            ...(progress.adId ? { adId: progress.adId } : {}),
          },
        });
      }
    );

    // Save campaign ID + ad params back to post so dashboard can show them
    await prisma.$executeRawUnsafe(
      `UPDATE "Post" SET "adCampaignId" = $1, "adSetId" = $2, "adCreativeId" = $3, "adId" = $4, "adPlatform" = $5, "adDestinationUrl" = $6, "adBudget" = $7, "adBudgetMinor" = $8, "adBudgetCurrency" = $9, "adAgeMin" = $10, "adAgeMax" = $11, "adGender" = $12, "adStatus" = 'done', "adAccountUsed" = $13, "adCtaType" = $14, "errorMsg" = NULL, "adNextAttemptAt" = NULL WHERE "id" = $15`,
      result.campaignId,
      result.adSetId,
      result.creativeId,
      result.adId,
      instagramOnly ? "instagram" : "facebook",
      affUrl || null,
      verifiedBudget.amountMajor,
      verifiedBudget.amountMinor,
      verifiedBudget.currency,
      ageMin ?? null,
      ageMax ?? null,
      gender ?? "",
      resolvedAdAccountId,
      cta.ctaType,
      postId,
    );
    await prisma.post.update({
      where: { id: postId },
      data: {
        adAdvantageConfig: advantageSnapshot as unknown as Prisma.InputJsonValue,
        adCtaScope: ctaScope.scope,
        fbCtaStatus: ctaScope.scope === "AD_AND_FACEBOOK_POST" ? "pending" : null,
        fbCtaErrorMsg: null,
        fbCtaNextAttemptAt: null,
        fbCtaAttempt: 0,
        fbCtaVerifiedAt: null,
        adPlacementConfig: placementSnapshot
          ? placementSnapshot as unknown as Prisma.InputJsonValue
          : Prisma.DbNull,
      },
    });
    if (ctaScope.scope === "AD_AND_FACEBOOK_POST" && !await enqueueAds(postId, 0)) {
      await prisma.post.update({
        where: { id: postId },
        data: { fbCtaStatus: "failed", fbCtaErrorMsg: "Ads đã tạo nhưng không thể xếp hàng cập nhật CTA trên bài Page." },
      });
    }

    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: msg, ...(err instanceof BudgetPolicyError ? { code: err.code } : {}) },
      { status: err instanceof BudgetPolicyError ? err.status : err instanceof AdTemplateConfigurationError ? 400 : 500 },
    );
  }
}
