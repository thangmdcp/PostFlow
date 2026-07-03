import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/prisma";
import { publishToPage, cloneAdCampaign } from "@/lib/facebook";
import { uploadFromUrl, deleteFile } from "@/lib/cloudinary";
import { randomStep, randomInteger } from "@/lib/adSettings";
import { autodownDownload, autodownCleanup, isAutoDownAsset } from "@/lib/autodown";

// Ads are created ~1 minute after each post publishes (waitUntil, doesn't
// block the response) — covers that delay for however many posts are due.
export const maxDuration = 90;

interface CronAutoAdsParams {
  postId: string;
  pageId: string;
  fbPostId: string;
  fbConnAccessToken: string;
  adTemplateId: string | null;
  isBatchPost: boolean;
  cfg: Record<string, string>;
}

// Runs ~1 minute after a successful publish — a post just published,
// especially video, often isn't immediately ad-eligible on FB's side yet.
async function runAutoAdsForCron(p: CronAutoAdsParams): Promise<void> {
  let autoAdsResult: { campaignId?: string; error?: string } | null = null;
  try {
    const batchTemplateId = p.adTemplateId ?? null;
    const adsEnabled = !!batchTemplateId;

    if (adsEnabled && batchTemplateId && p.fbPostId) {
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
        pickedBudgetMin  = Number(picked.budgetMin) || Number(p.cfg.batchBudgetMin) || 100000;
        pickedBudgetMax  = Number(picked.budgetMax) || Number(p.cfg.batchBudgetMax) || 200000;
        pickedBudgetStep = Number(picked.budgetStep) || Number(p.cfg.batchBudgetStep) || 10000;
        pickedRowId = picked.id;
      } else {
        if (!p.cfg.autoAdsAdAccountId) throw new Error("No ad account configured");
        pickedAccountId  = p.cfg.autoAdsAdAccountId;
        pickedBudgetMin  = Number(p.cfg.batchBudgetMin)  || 100000;
        pickedBudgetMax  = Number(p.cfg.batchBudgetMax)  || 200000;
        pickedBudgetStep = Number(p.cfg.batchBudgetStep) || 10000;
      }

      const rawAdAccountId = pickedAccountId.replace(/^act_/, "");
      const adAccount = await prisma.fbAdAccount.findUnique({ where: { accountId: pickedAccountId } });
      const adsAccessToken = adAccount?.accessToken ?? p.fbConnAccessToken;

      const dailyBudget = String(randomStep(pickedBudgetMin, pickedBudgetMax, pickedBudgetStep));

      const pfx = p.isBatchPost ? "batch" : "autoAds";
      const ageMinFrom = Number(p.cfg[`${pfx}AgeMinFrom`] ?? p.cfg.autoAdsAgeMinFrom ?? 18);
      const ageMinTo   = Number(p.cfg[`${pfx}AgeMinTo`]   ?? p.cfg.autoAdsAgeMinTo   ?? 25);
      const ageMaxFrom = Number(p.cfg[`${pfx}AgeMaxFrom`] ?? p.cfg.autoAdsAgeMaxFrom ?? 45);
      const ageMaxTo   = Number(p.cfg[`${pfx}AgeMaxTo`]   ?? p.cfg.autoAdsAgeMaxTo   ?? 65);
      const gender     = p.cfg[`${pfx}Gender`] ?? p.cfg.autoAdsGender ?? "";

      const ageMin = randomInteger(ageMinFrom, ageMinTo);
      const ageMax = randomInteger(Math.max(ageMinTo, ageMaxFrom), ageMaxTo);

      const postFull = await prisma.post.findUnique({
        where: { id: p.postId }, include: { extractedLinks: { orderBy: { order: "asc" } } },
      });
      const affUrl = postFull?.extractedLinks?.find((l) => l.myUrl)?.myUrl ?? "";
      let campaignName = "";
      try {
        const parsed = new URL(affUrl);
        campaignName = decodeURIComponent(parsed.searchParams.get("utm_content") ?? "").trim().replace(/[-_]+$/, "");
      } catch { /* ignore */ }

      const adResult = await cloneAdCampaign(
        batchTemplateId, p.pageId, p.fbPostId, rawAdAccountId, adsAccessToken,
        dailyBudget, p.fbConnAccessToken, campaignName || undefined,
        ageMin, ageMax, gender, (p.cfg.autoAdsStatus as "ACTIVE" | "PAUSED") ?? "PAUSED"
      );

      await prisma.$executeRawUnsafe(
        `UPDATE "Post" SET "adCampaignId" = $1, "adBudget" = $2, "adAgeMin" = $3, "adAgeMax" = $4, "adGender" = $5 WHERE "id" = $6`,
        adResult.campaignId, dailyBudget, ageMin, ageMax, gender, p.postId
      );

      if (pickedRowId) {
        await prisma.$executeRawUnsafe(
          `UPDATE "AutoAdsAccount" SET "assignedCount" = "assignedCount" + 1 WHERE "id" = $1`, pickedRowId
        );
      }

      autoAdsResult = { campaignId: adResult.campaignId };
      console.log(`[cron] post ${p.postId}: ad campaign ${adResult.campaignId}`);
    }
  } catch (adsErr) {
    console.error(`[cron] auto-ads failed for post ${p.postId}:`, adsErr);
    autoAdsResult = { error: adsErr instanceof Error ? adsErr.message : "auto-ads failed" };
  }

  if (autoAdsResult?.error) {
    await prisma.post.update({ where: { id: p.postId }, data: { errorMsg: `[ads] ${autoAdsResult.error}` } }).catch(() => {});
  } else if (autoAdsResult?.campaignId) {
    await prisma.post.update({ where: { id: p.postId }, data: { errorMsg: null } }).catch(() => {});
  }
}

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

      // Ads are created ~1 minute after the post publishes, in the background.
      const adsWillRun = !!post.adTemplateId && !!fbPostId;
      if (adsWillRun) {
        waitUntil(
          new Promise<void>((resolve) => setTimeout(resolve, 60_000)).then(() =>
            runAutoAdsForCron({
              postId: post.id,
              pageId: post.pageId!,
              fbPostId,
              fbConnAccessToken: fbConn.accessToken,
              adTemplateId: post.adTemplateId,
              isBatchPost,
              cfg,
            })
          )
        );
      }

      results.push({ id: post.id, status: "done", ...(adsWillRun ? { adsScheduled: "true" } : {}) });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      await prisma.post.update({ where: { id: post.id }, data: { status: "failed", errorMsg: msg } });
      results.push({ id: post.id, status: "failed", error: msg });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
