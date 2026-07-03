import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/prisma";
import { publishToPage, cloneAdCampaign } from "@/lib/facebook";
import { uploadFromUrl, deleteFile } from "@/lib/cloudinary";
import { randomStep, randomInteger } from "@/lib/adSettings";
import { autodownDownload, autodownCleanup, isAutoDownAsset } from "@/lib/autodown";

// Ads are created ~1 minute after the post publishes (see waitUntil below) so
// this route itself returns fast — maxDuration just needs to cover the
// synchronous publish + the deferred work waitUntil keeps alive afterward.
export const maxDuration = 90;

interface AutoAdsParams {
  postId: string;
  pageId: string;
  fbPostId: string;
  fbConnAccessToken: string;
  templateId?: string;
  adAccountId?: string;
  ageMinFrom?: string; ageMinTo?: string;
  ageMaxFrom?: string; ageMaxTo?: string;
  gender?: string;
}

// Runs ~1 minute after a successful publish (scheduled via waitUntil so the
// HTTP response doesn't block on it) — a post just published, especially
// video, often isn't immediately ad-eligible on Facebook's side yet.
async function runAutoAds(p: AutoAdsParams): Promise<void> {
  let autoAdsResult: { campaignId?: string; pickedAccount?: string; error?: string } | null = null;
  try {
    const configs = await prisma.appConfig.findMany({
      where: { key: { in: ["autoAdsTemplateId", "autoAdsAdAccountId", "autoAdsStatus",
                           "autoAdsAgeMinFrom", "autoAdsAgeMinTo", "autoAdsAgeMaxFrom", "autoAdsAgeMaxTo", "autoAdsGender",
                           "autoAdsBudgetMin", "autoAdsBudgetMax", "autoAdsBudgetStep"] } },
    });
    const cfg: Record<string, string> = {};
    for (const c of configs) cfg[c.key] = c.value;

    const batchTemplateId = p.templateId ?? null;
    const adsEnabled = !!batchTemplateId;
    if (!adsEnabled) {
      autoAdsResult = { error: "Bỏ qua tạo ads: không có templateId (cột \"Chạy ads\" tắt hoặc chưa chọn template)." };
    } else if (!p.fbPostId) {
      autoAdsResult = { error: "Bỏ qua tạo ads: không lấy được fbPostId sau khi đăng bài." };
    } else if (!p.pageId) {
      autoAdsResult = { error: "Bỏ qua tạo ads: thiếu pageId." };
    }
    if (adsEnabled && batchTemplateId && p.fbPostId && p.pageId) {
      // --- Load multi-account rows ---
      interface AdsAccountRow {
        id: string; accountId: string; weight: number; assignedCount: number;
        budgetMin: string; budgetMax: string; budgetStep: string; templateId: string | null;
      }
      const accountRows = await prisma.$queryRawUnsafe<AdsAccountRow[]>(
        `SELECT * FROM "AutoAdsAccount" ORDER BY "sortOrder" ASC, "id" ASC`
      );

      let pickedAccountId: string;
      let pickedBudgetMin: number;
      let pickedBudgetMax: number;
      let pickedBudgetStep: number;
      let pickedTemplateId: string;
      let pickedRowId: string | null = null;

      const rowOverride = p.adAccountId ? accountRows.find(r => r.accountId === p.adAccountId) : undefined;

      if (rowOverride) {
        pickedAccountId  = rowOverride.accountId;
        pickedBudgetMin  = Number(rowOverride.budgetMin)  || 100000;
        pickedBudgetMax  = Number(rowOverride.budgetMax)  || 200000;
        pickedBudgetStep = Number(rowOverride.budgetStep) || 10000;
        pickedTemplateId = rowOverride.templateId ?? cfg.autoAdsTemplateId;
        pickedRowId      = rowOverride.id;
      } else if (accountRows.length > 0) {
        // Deficit-based weighted round-robin:
        // Pick the account with the largest gap between expected share and actual assigned count.
        const totalWeight = accountRows.reduce((s, r) => s + (Number(r.weight) || 1), 0);
        const totalAssigned = accountRows.reduce((s, r) => s + (Number(r.assignedCount) || 0), 0);

        let maxDeficit = -Infinity;
        let picked = accountRows[0];
        for (const row of accountRows) {
          const expectedShare = (Number(row.weight) / totalWeight) * (totalAssigned + 1);
          const deficit = expectedShare - (Number(row.assignedCount) || 0);
          if (deficit > maxDeficit) { maxDeficit = deficit; picked = row; }
        }

        pickedAccountId  = picked.accountId;
        pickedBudgetMin  = Number(picked.budgetMin)  || 100000;
        pickedBudgetMax  = Number(picked.budgetMax)  || 200000;
        pickedBudgetStep = Number(picked.budgetStep) || 10000;
        pickedTemplateId = picked.templateId ?? cfg.autoAdsTemplateId;
        pickedRowId      = picked.id;
        console.log(`[auto-ads] picked account: ${pickedAccountId} (deficit ${maxDeficit.toFixed(2)}, assigned ${picked.assignedCount}/${totalAssigned + 1})`);
      } else {
        if (!cfg.autoAdsAdAccountId) {
          autoAdsResult = { error: "No ad account configured" };
          throw new Error("No ad account configured for auto-ads");
        }
        pickedAccountId  = cfg.autoAdsAdAccountId;
        pickedBudgetMin  = Number(cfg.autoAdsBudgetMin  ?? 100000);
        pickedBudgetMax  = Number(cfg.autoAdsBudgetMax  ?? 200000);
        pickedBudgetStep = Number(cfg.autoAdsBudgetStep ?? 10000);
        pickedTemplateId = cfg.autoAdsTemplateId;
      }

      const rawAdAccountId = pickedAccountId.replace(/^act_/, "");
      const adAccount = await prisma.fbAdAccount.findUnique({ where: { accountId: pickedAccountId } });
      const adsAccessToken = adAccount?.accessToken ?? p.fbConnAccessToken;

      const postFull = await prisma.post.findUnique({
        where: { id: p.postId },
        include: { extractedLinks: { orderBy: { order: "asc" } } },
      });
      const affUrl = postFull?.extractedLinks?.find((l) => l.myUrl)?.myUrl ?? "";
      let campaignName = "";
      try {
        const parsed = new URL(affUrl);
        campaignName = decodeURIComponent(parsed.searchParams.get("utm_content") ?? "").trim().replace(/[-_]+$/, "");
      } catch { /* ignore */ }

      const dailyBudget = String(randomStep(pickedBudgetMin, pickedBudgetMax, pickedBudgetStep));

      const ageMinFrom = Number(p.ageMinFrom ?? cfg.autoAdsAgeMinFrom ?? 18);
      const ageMinTo   = Number(p.ageMinTo   ?? cfg.autoAdsAgeMinTo   ?? 25);
      const ageMaxFrom = Number(p.ageMaxFrom ?? cfg.autoAdsAgeMaxFrom ?? 45);
      const ageMaxTo   = Number(p.ageMaxTo   ?? cfg.autoAdsAgeMaxTo   ?? 65);
      const ageMin = randomInteger(ageMinFrom, ageMinTo);
      const ageMax = randomInteger(Math.max(ageMinTo, ageMaxFrom), ageMaxTo);
      const effGender = p.gender ?? cfg.autoAdsGender ?? "";

      const finalTemplateId = batchTemplateId ?? pickedTemplateId;

      const result = await cloneAdCampaign(
        finalTemplateId,
        p.pageId,
        p.fbPostId,
        rawAdAccountId,
        adsAccessToken,
        dailyBudget,
        p.fbConnAccessToken,
        campaignName || undefined,
        ageMin,
        ageMax,
        effGender,
        (cfg.autoAdsStatus as "ACTIVE" | "PAUSED") ?? "PAUSED"
      );
      autoAdsResult = { campaignId: result.campaignId, pickedAccount: pickedAccountId };
      console.log("[auto-ads] created campaign:", result.campaignId, "budget:", dailyBudget);

      await prisma.$executeRawUnsafe(
        `UPDATE "Post" SET "adCampaignId" = $1, "adBudget" = $2, "adAgeMin" = $3, "adAgeMax" = $4, "adGender" = $5 WHERE "id" = $6`,
        result.campaignId, dailyBudget, ageMin, ageMax, cfg.autoAdsGender ?? "", p.postId
      );

      if (pickedRowId) {
        await prisma.$executeRawUnsafe(
          `UPDATE "AutoAdsAccount" SET "assignedCount" = "assignedCount" + 1 WHERE "id" = $1`,
          pickedRowId
        );
      }
    }
  } catch (adsErr) {
    console.error("[auto-ads] failed:", adsErr);
    if (!autoAdsResult?.error) {
      autoAdsResult = { error: adsErr instanceof Error ? adsErr.message : "auto-ads failed" };
    }
  }

  // Post itself published fine even if ads failed — persist the ads error
  // onto the post (without touching status="done") so it's inspectable
  // later instead of only existing in server logs.
  if (autoAdsResult?.error) {
    await prisma.post.update({ where: { id: p.postId }, data: { errorMsg: `[ads] ${autoAdsResult.error}` } }).catch(() => {});
  } else if (autoAdsResult?.campaignId) {
    await prisma.post.update({ where: { id: p.postId }, data: { errorMsg: null } }).catch(() => {});
  }
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = (await req.json()) as {
      pageId: string;
      templateId?: string;
      publishToPage?: boolean;
      ageMinFrom?: string; ageMinTo?: string;
      ageMaxFrom?: string; ageMaxTo?: string;
      gender?: string;
      budgetMin?: string; budgetMax?: string; budgetStep?: string;
      adAccountId?: string;
      ctaHeadline?: string;
    };
    const { pageId } = body;

    const post = await prisma.post.findUnique({
      where: { id: params.id },
      include: { extractedLinks: true },
    });
    if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });
    if (!post.finalCaption) return NextResponse.json({ error: "Chưa có caption. Hãy lưu link aff trước." }, { status: 400 });

    // Block if any extracted link is missing affiliate URL
    const missingAff = post.extractedLinks.filter((l) => !l.myUrl);
    if (missingAff.length > 0) {
      return NextResponse.json(
        { error: `Còn ${missingAff.length} link chưa điền link aff. Vào batch để điền trước khi đăng.` },
        { status: 400 }
      );
    }

    // Block if finalCaption still contains any original competitor URL
    const leakedLink = post.extractedLinks.find(
      (l) => post.finalCaption!.includes(l.competitorUrl)
    );
    if (leakedLink) {
      return NextResponse.json(
        { error: "Caption vẫn còn chứa link gốc chưa được thay thế. Lưu lại link aff trong batch." },
        { status: 400 }
      );
    }

    const fbConn = await prisma.fbConnection.findUnique({ where: { pageId } });
    if (!fbConn) return NextResponse.json({ error: "Không tìm thấy kết nối FB Page" }, { status: 400 });

    // Determine publishToPageFlag: body.publishToPage explicit override > template postType > default true
    let publishToPageFlag = true;
    try {
      if (body.publishToPage === false) {
        publishToPageFlag = false;
      } else if (body.publishToPage === true) {
        publishToPageFlag = true;
      } else {
        // Auto-detect from template
        const resolvedTemplateId = body.templateId ?? post.adTemplateId;
        const templateCfgId = resolvedTemplateId
          ?? (await prisma.appConfig.findUnique({ where: { key: "autoAdsTemplateId" } }))?.value;
        if (templateCfgId) {
          const tpl = await prisma.campaignTemplate.findFirst({ where: { campaignId: templateCfgId } });
          if (tpl && (tpl.settings as Record<string, unknown>)?.postType === "dark") {
            publishToPageFlag = false;
          }
        }
      }
    } catch { /* ignore — default to published */ }

    await prisma.post.update({
      where: { id: params.id },
      data: { status: "publishing", pageId, ...(body.ctaHeadline ? { ctaHeadline: body.ctaHeadline } : {}) },
    });

    // Dark-post ads have no separate headline field in the FB creative (the
    // ad just reuses this post's own message via object_story_id) — so the
    // CTA phrase gets prepended directly onto the message sent to Facebook.
    const ctaHeadline = body.ctaHeadline ?? post.ctaHeadline;
    const captionToPost = (!publishToPageFlag && ctaHeadline)
      ? `${ctaHeadline}\n\n${post.finalCaption}`
      : post.finalCaption;

    // Auto-upload to Cloudinary if still using fbcdn URL (FB rejects its own CDN links)
    // Skip for carousel/image — FB Graph API accepts direct URLs for photos
    let mediaUrl = post.stableMediaUrl ?? undefined;
    let cloudinaryId = post.cloudinaryId;
    let mediaType = post.mediaType ?? undefined;

    if (mediaUrl && !cloudinaryId && mediaType === "video") {
      const uploaded = await uploadFromUrl(mediaUrl);
      mediaUrl = uploaded.secureUrl;
      cloudinaryId = uploaded.publicId;
      mediaType = uploaded.resourceType;
      await prisma.post.update({
        where: { id: params.id },
        data: { stableMediaUrl: mediaUrl, cloudinaryId, mediaType },
      });
    }

    // Safety net: AutoDown-sourced videos live on AutoDown's own temp Cloudinary
    // storage. If the post sat scheduled long enough for that asset to be swept,
    // re-fetch a fresh one from the original link before publishing.
    if (mediaUrl && isAutoDownAsset(cloudinaryId)) {
      const stillThere = await fetch(mediaUrl, { method: "HEAD" }).then((r) => r.ok).catch(() => false);
      if (!stillThere) {
        const fresh = await autodownDownload(post.sourceUrl);
        const freshVideo = fresh?.media?.find((m) => m.type === "video");
        if (!freshVideo) {
          throw new Error("Media gốc đã hết hạn và không tải lại được — link gốc có thể đã bị xoá.");
        }
        mediaUrl = freshVideo.url;
        cloudinaryId = freshVideo.public_id;
        await prisma.post.update({
          where: { id: params.id },
          data: { stableMediaUrl: mediaUrl, cloudinaryId },
        });
      }
    }

    const result = await publishToPage(
      pageId,
      fbConn.accessToken,
      captionToPost,
      mediaUrl,
      mediaType,
      post.mediaUrls ?? null,
      publishToPageFlag
    );

    // For videos, result.post_id is the page post ID (pageId_postId), result.id is just the video ID
    const fbPostId = result.post_id ?? result.id ?? "";
    const fbPostUrl = (publishToPageFlag && fbPostId) ? `https://www.facebook.com/${fbPostId.replace("_", "/posts/")}` : "";

    if (isAutoDownAsset(cloudinaryId)) {
      await autodownCleanup([cloudinaryId]);
    } else if (cloudinaryId) {
      await deleteFile(cloudinaryId, mediaType ?? "image");
    }

    await prisma.post.update({
      where: { id: params.id },
      data: { status: "done", fbPostId, fbPostUrl, cloudinaryId: null, stableMediaUrl: null },
    });

    // Ads are created ~1 minute after the post publishes, in the background —
    // this doesn't block the response. See runAutoAds's doc comment for why.
    const adsWillRun = !!body.templateId;
    if (adsWillRun) {
      waitUntil(
        new Promise<void>((resolve) => setTimeout(resolve, 60_000)).then(() =>
          runAutoAds({
            postId: params.id,
            pageId,
            fbPostId,
            fbConnAccessToken: fbConn.accessToken,
            templateId: body.templateId,
            adAccountId: body.adAccountId,
            ageMinFrom: body.ageMinFrom, ageMinTo: body.ageMinTo,
            ageMaxFrom: body.ageMaxFrom, ageMaxTo: body.ageMaxTo,
            gender: body.gender,
          })
        )
      );
    }

    return NextResponse.json({ ok: true, fbPostUrl, autoAds: adsWillRun ? { scheduled: true } : null });
  } catch (err) {
    console.error("[publish] FULL ERROR:", JSON.stringify(err, null, 2), err);
    const msg = err instanceof Error ? err.message : (typeof err === "object" ? JSON.stringify(err) : String(err));
    await prisma.post.update({ where: { id: params.id }, data: { status: "failed", errorMsg: msg } }).catch(() => {});
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
