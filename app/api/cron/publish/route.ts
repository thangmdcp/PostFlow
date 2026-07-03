import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publishToPage, cloneAdCampaign } from "@/lib/facebook";
import { uploadFromUrl, deleteFile } from "@/lib/cloudinary";
import { randomStep, randomInteger } from "@/lib/adSettings";
import { autodownDownload, autodownCleanup, isAutoDownAsset } from "@/lib/autodown";

// Loops multiple posts, each possibly retrying ad creative creation with
// backoff — default 10s Vercel timeout isn't enough.
export const maxDuration = 60;

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const querySecret = new URL(req.url).searchParams.get("secret")?.trim();
  const envSecret = process.env.CRON_SECRET?.trim();
  const isAuthorized =
    !!envSecret && (authHeader === `Bearer ${envSecret}` || querySecret === envSecret);
  console.log("[cron] auth check", {
    hasEnvSecret: !!envSecret, envSecretLen: envSecret?.length ?? 0,
    hasQuerySecret: !!querySecret, querySecretLen: querySecret?.length ?? 0,
    hasAuthHeader: !!authHeader, isAuthorized,
  });
  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const posts = await prisma.post.findMany({
    where: { status: "pending", scheduledAt: { lte: now } },
  });

  const results: { id: string; status: string; error?: string }[] = [];

  for (const post of posts) {
    await prisma.post.update({ where: { id: post.id }, data: { status: "publishing" } });

    try {
      if (!post.pageId || !post.finalCaption) throw new Error("Missing pageId or finalCaption");

      const fbConn = await prisma.fbConnection.findUnique({ where: { pageId: post.pageId } });
      if (!fbConn) throw new Error(`No FB connection for page ${post.pageId}`);

      // Load all relevant AppConfig keys
      const configs = await prisma.appConfig.findMany({
        where: {
          key: { in: [
            "autoAdsTemplateId", "autoAdsAdAccountId", "autoAdsStatus",
            "autoAdsAgeMinFrom", "autoAdsAgeMinTo", "autoAdsAgeMaxFrom", "autoAdsAgeMaxTo", "autoAdsGender",
            "batchTemplateId", "batchAgeMinFrom", "batchAgeMinTo", "batchAgeMaxFrom", "batchAgeMaxTo",
            "batchGender", "batchBudgetMin", "batchBudgetMax", "batchBudgetStep",
          ] },
        },
      });
      const cfg: Record<string, string> = {};
      for (const c of configs) cfg[c.key] = c.value;

      // Determine publishToPageFlag from active template
      let publishToPageFlag = true;
      const isBatchPost = !!post.adTemplateId;
      const resolvedTemplateId = post.adTemplateId ?? cfg.autoAdsTemplateId;
      if (resolvedTemplateId) {
        const tpl = await prisma.campaignTemplate.findFirst({ where: { campaignId: resolvedTemplateId } });
        if (tpl && (tpl.settings as Record<string, unknown>)?.postType === "dark") publishToPageFlag = false;
      }

      let mediaUrl = post.stableMediaUrl ?? undefined;
      let cloudinaryId = post.cloudinaryId;
      let mediaType = post.mediaType ?? undefined;

      if (mediaUrl && !cloudinaryId && mediaType === "video") {
        const uploaded = await uploadFromUrl(mediaUrl);
        mediaUrl = uploaded.secureUrl;
        cloudinaryId = uploaded.publicId;
        mediaType = uploaded.resourceType;
        await prisma.post.update({ where: { id: post.id }, data: { stableMediaUrl: mediaUrl, cloudinaryId, mediaType } });
      }

      // Safety net: AutoDown-sourced videos live on AutoDown's own temp Cloudinary
      // storage. If the post sat scheduled long enough for that asset to be swept,
      // re-fetch a fresh one from the original link before publishing.
      if (mediaUrl && isAutoDownAsset(cloudinaryId)) {
        const stillThere = await fetch(mediaUrl, { method: "HEAD" }).then((r) => r.ok).catch(() => false);
        if (!stillThere) {
          const fresh = await autodownDownload(post.sourceUrl);
          const freshVideo = fresh?.media?.find((m) => m.type === "video");
          if (!freshVideo) throw new Error("Media gốc đã hết hạn và không tải lại được — link gốc có thể đã bị xoá.");
          mediaUrl = freshVideo.url;
          cloudinaryId = freshVideo.public_id;
          await prisma.post.update({ where: { id: post.id }, data: { stableMediaUrl: mediaUrl, cloudinaryId } });
        }
      }

      // Dark-post ads have no separate headline field in the FB creative (the
      // ad just reuses this post's own message via object_story_id) — so the
      // CTA phrase chosen at schedule time gets prepended onto the message.
      const captionToPost = (!publishToPageFlag && post.ctaHeadline)
        ? `${post.ctaHeadline}\n\n${post.finalCaption}`
        : post.finalCaption;

      const result = await publishToPage(
        post.pageId, fbConn.accessToken, captionToPost,
        mediaUrl, mediaType, post.mediaUrls ?? null, publishToPageFlag
      );

      const fbPostId = result.post_id ?? result.id ?? "";
      const fbPostUrl = (publishToPageFlag && fbPostId) ? `https://www.facebook.com/${fbPostId.replace("_", "/posts/")}` : "";

      if (isAutoDownAsset(cloudinaryId)) await autodownCleanup([cloudinaryId]);
      else if (cloudinaryId) await deleteFile(cloudinaryId, mediaType ?? "image");

      await prisma.post.update({
        where: { id: post.id },
        data: { status: "done", fbPostId, fbPostUrl, cloudinaryId: null, stableMediaUrl: null },
      });

      // Auto-ads: create campaign for this post
      let autoAdsResult = null;
      try {
        // Only run ads if adTemplateId was explicitly set at schedule time (runAds=true)
        const batchTemplateId = post.adTemplateId ?? null;
        const effectiveTemplateId = batchTemplateId;
        const adsEnabled = !!batchTemplateId;

        if (adsEnabled && effectiveTemplateId && fbPostId) {
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
          let pickedRowId: string | null = null;

          if (accountRows.length > 0) {
            const totalWeight = accountRows.reduce((s, r) => s + (Number(r.weight) || 1), 0);
            const totalAssigned = accountRows.reduce((s, r) => s + (Number(r.assignedCount) || 0), 0);
            let maxDeficit = -Infinity;
            let picked = accountRows[0];
            for (const row of accountRows) {
              const deficit = ((Number(row.weight) / totalWeight) * (totalAssigned + 1)) - (Number(row.assignedCount) || 0);
              if (deficit > maxDeficit) { maxDeficit = deficit; picked = row; }
            }
            pickedAccountId  = picked.accountId;
            pickedBudgetMin  = Number(picked.budgetMin) || Number(cfg.batchBudgetMin) || 100000;
            pickedBudgetMax  = Number(picked.budgetMax) || Number(cfg.batchBudgetMax) || 200000;
            pickedBudgetStep = Number(picked.budgetStep) || Number(cfg.batchBudgetStep) || 10000;
            pickedRowId = picked.id;
          } else {
            if (!cfg.autoAdsAdAccountId) throw new Error("No ad account configured");
            pickedAccountId  = cfg.autoAdsAdAccountId;
            pickedBudgetMin  = Number(cfg.batchBudgetMin)  || 100000;
            pickedBudgetMax  = Number(cfg.batchBudgetMax)  || 200000;
            pickedBudgetStep = Number(cfg.batchBudgetStep) || 10000;
          }

          const rawAdAccountId = pickedAccountId.replace(/^act_/, "");
          const adAccount = await prisma.fbAdAccount.findUnique({ where: { accountId: pickedAccountId } });
          const adsAccessToken = adAccount?.accessToken ?? fbConn.accessToken;

          const dailyBudget = String(randomStep(pickedBudgetMin, pickedBudgetMax, pickedBudgetStep));

          const pfx = isBatchPost ? "batch" : "autoAds";
          const ageMinFrom = Number(cfg[`${pfx}AgeMinFrom`] ?? cfg.autoAdsAgeMinFrom ?? 18);
          const ageMinTo   = Number(cfg[`${pfx}AgeMinTo`]   ?? cfg.autoAdsAgeMinTo   ?? 25);
          const ageMaxFrom = Number(cfg[`${pfx}AgeMaxFrom`] ?? cfg.autoAdsAgeMaxFrom ?? 45);
          const ageMaxTo   = Number(cfg[`${pfx}AgeMaxTo`]   ?? cfg.autoAdsAgeMaxTo   ?? 65);
          const gender     = cfg[`${pfx}Gender`] ?? cfg.autoAdsGender ?? "";

          const ageMin = randomInteger(ageMinFrom, ageMinTo);
          const ageMax = randomInteger(Math.max(ageMinTo, ageMaxFrom), ageMaxTo);

          // Extract campaign name from utm_content
          const postFull = await prisma.post.findUnique({
            where: { id: post.id }, include: { extractedLinks: { orderBy: { order: "asc" } } },
          });
          const affUrl = postFull?.extractedLinks?.find((l) => l.myUrl)?.myUrl ?? "";
          let campaignName = "";
          try {
            const parsed = new URL(affUrl);
            campaignName = decodeURIComponent(parsed.searchParams.get("utm_content") ?? "").trim().replace(/[-_]+$/, "");
          } catch { /* ignore */ }

          const adResult = await cloneAdCampaign(
            effectiveTemplateId, post.pageId!, fbPostId, rawAdAccountId, adsAccessToken,
            dailyBudget, fbConn.accessToken, campaignName || undefined,
            ageMin, ageMax, gender, (cfg.autoAdsStatus as "ACTIVE" | "PAUSED") ?? "PAUSED"
          );

          await prisma.$executeRawUnsafe(
            `UPDATE "Post" SET "adCampaignId" = $1, "adBudget" = $2, "adAgeMin" = $3, "adAgeMax" = $4, "adGender" = $5 WHERE "id" = $6`,
            adResult.campaignId, dailyBudget, ageMin, ageMax, gender, post.id
          );

          if (pickedRowId) {
            await prisma.$executeRawUnsafe(
              `UPDATE "AutoAdsAccount" SET "assignedCount" = "assignedCount" + 1 WHERE "id" = $1`, pickedRowId
            );
          }

          autoAdsResult = { campaignId: adResult.campaignId };
          console.log(`[cron] post ${post.id}: published + ad campaign ${adResult.campaignId}`);
        }
      } catch (adsErr) {
        console.error(`[cron] auto-ads failed for post ${post.id}:`, adsErr);
      }

      results.push({ id: post.id, status: "done", ...(autoAdsResult ? { campaign: autoAdsResult.campaignId } as Record<string, string> : {}) });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      await prisma.post.update({ where: { id: post.id }, data: { status: "failed", errorMsg: msg } });
      results.push({ id: post.id, status: "failed", error: msg });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
