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

    if (!post || post.status !== "done" || !post.fbPostId || !post.pageId) {
      return NextResponse.json(
        { error: "Post must be published before creating an ad" },
        { status: 400 }
      );
    }

    const fbConn = await prisma.fbConnection.findUnique({
      where: { pageId: post.pageId },
    });

    if (!fbConn) {
      return NextResponse.json({ error: "No FB connection found for this page" }, { status: 400 });
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
    let campaignName = "";
    try {
      const parsed = new URL(affUrl);
      campaignName = decodeURIComponent(parsed.searchParams.get("utm_content") ?? "").trim().replace(/[-_]+$/, "");
    } catch { /* ignore */ }

    const result = await cloneAdCampaign(
      templateCampaignId,
      post.pageId,
      post.fbPostId,
      rawAdAccountId,
      accessToken,
      dailyBudget ?? "100000",
      fbConn.accessToken,
      campaignName || undefined,
      ageMin,
      ageMax,
      gender,
      adStatus ?? "PAUSED"
    );

    // Save campaign ID + ad params back to post so dashboard can show them
    await prisma.$executeRawUnsafe(
      `UPDATE "Post" SET "adCampaignId" = $1, "adBudget" = $2, "adAgeMin" = $3, "adAgeMax" = $4, "adGender" = $5 WHERE "id" = $6`,
      result.campaignId,
      dailyBudget ?? "100000",
      ageMin ?? null,
      ageMax ?? null,
      gender ?? "",
      postId
    );

    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
