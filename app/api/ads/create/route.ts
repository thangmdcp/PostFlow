import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cloneAdCampaign } from "@/lib/facebook";

export async function POST(req: Request) {

  try {
    const { postId, templateCampaignId, adAccountId, dailyBudget, ageMin, ageMax, gender, adStatus } = (await req.json()) as {
      postId: string;
      templateCampaignId: string;
      adAccountId?: string;
      dailyBudget?: string;
      ageMin?: number;
      ageMax?: number;
      gender?: string;
      adStatus?: "ACTIVE" | "PAUSED";
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
    const accessToken = adAccount?.accessToken ?? fbConn.accessToken;

    // facebook.ts prepends act_ internally, so strip it here if present
    const rawAdAccountId = resolvedAdAccountId.replace(/^act_/, "");

    // Extract utm_content from first affiliate link as campaign name (like FB Ads tool)
    const affUrl = post.extractedLinks?.find((l) => l.myUrl)?.myUrl ?? "";
    if (instagramOnly && !affUrl) {
      return NextResponse.json({ error: "Quảng cáo Instagram cần ít nhất một link affiliate" }, { status: 400 });
    }
    let campaignName = "";
    try {
      const parsed = new URL(affUrl);
      campaignName = decodeURIComponent(parsed.searchParams.get("utm_content") ?? "").trim().replace(/[-_]+$/, "");
    } catch { /* ignore */ }

    const result = await cloneAdCampaign(
      templateCampaignId,
      post.pageId,
      instagramOnly
        ? { platform: "instagram", igPostId: post.igPostId!, instagramUserId: fbConn.instagramUserId!, destinationUrl: affUrl }
        : { platform: "facebook", fbPostId: post.fbPostId! },
      rawAdAccountId,
      accessToken,
      dailyBudget ?? "100000",
      fbConn.accessToken,
      campaignName || undefined,
      ageMin,
      ageMax,
      gender,
      adStatus ?? "PAUSED",
      undefined,
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
      `UPDATE "Post" SET "adCampaignId" = $1, "adSetId" = $2, "adCreativeId" = $3, "adId" = $4, "adPlatform" = $5, "adDestinationUrl" = $6, "adBudget" = $7, "adAgeMin" = $8, "adAgeMax" = $9, "adGender" = $10, "adStatus" = 'done', "adAccountUsed" = $11, "errorMsg" = NULL, "adNextAttemptAt" = NULL WHERE "id" = $12`,
      result.campaignId,
      result.adSetId,
      result.creativeId,
      result.adId,
      instagramOnly ? "instagram" : "facebook",
      instagramOnly ? affUrl : null,
      dailyBudget ?? "100000",
      ageMin ?? null,
      ageMax ?? null,
      gender ?? "",
      resolvedAdAccountId,
      postId
    );

    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
