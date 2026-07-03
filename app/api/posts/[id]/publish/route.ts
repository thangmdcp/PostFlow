import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publishToPage, cloneAdCampaign } from "@/lib/facebook";
import { uploadFromUrl, deleteFile } from "@/lib/cloudinary";
import { randomStep, randomInteger } from "@/lib/adSettings";
import { autodownDownload, autodownCleanup, isAutoDownAsset } from "@/lib/autodown";

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

    await prisma.post.update({ where: { id: params.id }, data: { status: "publishing", pageId } });

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
      post.finalCaption,
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

    // Auto-ads: create campaign immediately if configured
    let autoAdsResult: { campaignId?: string; pickedAccount?: string; error?: string } | null = null;
    try {
      const configs = await prisma.appConfig.findMany({
        where: { key: { in: ["autoAdsTemplateId", "autoAdsAdAccountId", "autoAdsStatus",
                             "autoAdsAgeMinFrom", "autoAdsAgeMinTo", "autoAdsAgeMaxFrom", "autoAdsAgeMaxTo", "autoAdsGender",
                             "autoAdsBudgetMin", "autoAdsBudgetMax", "autoAdsBudgetStep"] } },
      });
      const cfg: Record<string, string> = {};
      for (const c of configs) cfg[c.key] = c.value;

      // Only run ads if templateId explicitly passed (runAds=true at publish time)
      const batchTemplateId = body.templateId ?? null;
      const adsEnabled = !!batchTemplateId;
      const effectiveTemplateId = batchTemplateId;
      if (adsEnabled && effectiveTemplateId && fbPostId && post.pageId) {
        // --- Load multi-account rows ---
        interface AdsAccountRow {
          id: string; accountId: string; weight: number; assignedCount: number;
          budgetMin: string; budgetMax: string; budgetStep: string; templateId: string | null;
        }
        const accountRows = await prisma.$queryRawUnsafe<AdsAccountRow[]>(
          `SELECT * FROM "AutoAdsAccount" ORDER BY "sortOrder" ASC, "id" ASC`
        );

        // Determine which account + budget to use
        let pickedAccountId: string;
        let pickedBudgetMin: number;
        let pickedBudgetMax: number;
        let pickedBudgetStep: number;
        let pickedTemplateId: string;
        let pickedRowId: string | null = null;

        const rowOverride = body.adAccountId ? accountRows.find(r => r.accountId === body.adAccountId) : undefined;

        if (rowOverride) {
          // Explicit TKQC chosen client-side (e.g. per-row pick in the batch table) — use it directly.
          pickedAccountId  = rowOverride.accountId;
          pickedBudgetMin  = Number(rowOverride.budgetMin)  || 100000;
          pickedBudgetMax  = Number(rowOverride.budgetMax)  || 200000;
          pickedBudgetStep = Number(rowOverride.budgetStep) || 10000;
          pickedTemplateId = rowOverride.templateId ?? cfg.autoAdsTemplateId;
          pickedRowId      = rowOverride.id;
        } else if (accountRows.length > 0) {
          // Deficit-based weighted round-robin:
          // Pick the account with the largest gap between expected share and actual assigned count.
          // This guarantees exact ratios over any number of posts, regardless of rounding.
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
          // Fallback: old single-account config
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
        const adsAccessToken = adAccount?.accessToken ?? fbConn.accessToken;

        // Extract campaign name from utm_content
        const postFull = await prisma.post.findUnique({
          where: { id: params.id },
          include: { extractedLinks: { orderBy: { order: "asc" } } },
        });
        const affUrl = postFull?.extractedLinks?.find((l) => l.myUrl)?.myUrl ?? "";
        let campaignName = "";
        try {
          const parsed = new URL(affUrl);
          campaignName = decodeURIComponent(parsed.searchParams.get("utm_content") ?? "").trim().replace(/[-_]+$/, "");
        } catch { /* ignore */ }

        // Per-TKQC budget wins; batch panel is fallback (already stored in row defaults)
        const dailyBudget = String(randomStep(pickedBudgetMin, pickedBudgetMax, pickedBudgetStep));

        // Randomize age — body overrides AppConfig
        const ageMinFrom = Number(body.ageMinFrom ?? cfg.autoAdsAgeMinFrom ?? 18);
        const ageMinTo   = Number(body.ageMinTo   ?? cfg.autoAdsAgeMinTo   ?? 25);
        const ageMaxFrom = Number(body.ageMaxFrom ?? cfg.autoAdsAgeMaxFrom ?? 45);
        const ageMaxTo   = Number(body.ageMaxTo   ?? cfg.autoAdsAgeMaxTo   ?? 65);
        const ageMin = randomInteger(ageMinFrom, ageMinTo);
        const ageMax = randomInteger(Math.max(ageMinTo, ageMaxFrom), ageMaxTo);
        const effGender = body.gender ?? cfg.autoAdsGender ?? "";

        // Use body templateId for batch, else picked from account row
        const finalTemplateId = batchTemplateId ?? pickedTemplateId;

        const result = await cloneAdCampaign(
          finalTemplateId,
          post.pageId,
          fbPostId,
          rawAdAccountId,
          adsAccessToken,
          dailyBudget,
          fbConn.accessToken,
          campaignName || undefined,
          ageMin,
          ageMax,
          effGender,
          (cfg.autoAdsStatus as "ACTIVE" | "PAUSED") ?? "PAUSED"
        );
        autoAdsResult = { campaignId: result.campaignId, pickedAccount: pickedAccountId };
        console.log("[auto-ads] created campaign:", result.campaignId, "budget:", dailyBudget);

        // Save campaign ID + ad params to post
        await prisma.$executeRawUnsafe(
          `UPDATE "Post" SET "adCampaignId" = $1, "adBudget" = $2, "adAgeMin" = $3, "adAgeMax" = $4, "adGender" = $5 WHERE "id" = $6`,
          result.campaignId, dailyBudget, ageMin, ageMax, cfg.autoAdsGender ?? "", params.id
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

    return NextResponse.json({ ok: true, fbPostUrl, autoAds: autoAdsResult });
  } catch (err) {
    console.error("[publish] FULL ERROR:", JSON.stringify(err, null, 2), err);
    const msg = err instanceof Error ? err.message : (typeof err === "object" ? JSON.stringify(err) : String(err));
    await prisma.post.update({ where: { id: params.id }, data: { status: "failed", errorMsg: msg } }).catch(() => {});
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
