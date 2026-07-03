import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publishToPage } from "@/lib/facebook";
import { uploadFromUrl, deleteFile } from "@/lib/cloudinary";
import { autodownDownload, autodownCleanup, isAutoDownAsset } from "@/lib/autodown";
import { scheduleAutoAds, processDueAdRetries } from "@/lib/autoAdsRunner";

// Covers: publishing whatever posts are due, the ~1 min first-attempt ads
// wait (via scheduleAutoAds' waitUntil) for however many just published, and
// processDueAdRetries for posts whose 2nd/3rd attempt has come due.
export const maxDuration = 90;

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
        where: { key: { in: ["autoAdsTemplateId"] } },
      });
      const cfg: Record<string, string> = {};
      for (const c of configs) cfg[c.key] = c.value;

      // Determine publishToPageFlag from active template
      let publishToPageFlag = true;
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

      if (isAutoDownAsset(cloudinaryId)) {
        await autodownCleanup([cloudinaryId]);
        console.log(`[cleanup] post ${post.id}: deleted AutoDown asset ${cloudinaryId}`);
      } else if (cloudinaryId) {
        await deleteFile(cloudinaryId, mediaType ?? "image");
        console.log(`[cleanup] post ${post.id}: deleted Cloudinary asset ${cloudinaryId}`);
      }

      await prisma.post.update({
        where: { id: post.id },
        data: { status: "done", fbPostId, fbPostUrl, cloudinaryId: null, stableMediaUrl: null },
      });

      // Ads are attempted on a schedule (1m, then +2m, +5m if still failing) —
      // see lib/autoAdsRunner.ts.
      const adsWillRun = !!post.adTemplateId && !!fbPostId;
      if (adsWillRun) {
        await scheduleAutoAds({
          postId: post.id,
          pageId: post.pageId,
          fbPostId,
          fbConnAccessToken: fbConn.accessToken,
          templateId: post.adTemplateId,
          isBatchPost: !!post.adTemplateId,
          adStatus: (post.adPublishStatus as "ACTIVE" | "PAUSED" | null) ?? undefined,
        });
      }

      results.push({ id: post.id, status: "done", ...(adsWillRun ? { adsScheduled: "true" } : {}) });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      await prisma.post.update({ where: { id: post.id }, data: { status: "failed", errorMsg: msg } });
      results.push({ id: post.id, status: "failed", error: msg });
    }
  }

  // Ads retries (2nd/3rd attempt) that came due since the last tick.
  await processDueAdRetries().catch((err) => console.error("[cron] processDueAdRetries failed:", err));

  return NextResponse.json({ processed: results.length, results });
}
