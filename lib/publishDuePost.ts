import type { Post } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { publishToPage } from "@/lib/facebook";
import { publishToInstagram, InstagramPublishError } from "@/lib/instagram";
import { prepareInstagramMedia, cleanupInstagramMedia } from "@/lib/instagramMedia";
import { uploadFromUrl, deleteFile } from "@/lib/cloudinary";
import { autodownDownload, autodownCleanup, isAutoDownAsset } from "@/lib/autodown";
import { scheduleAutoAds } from "@/lib/autoAdsRunner";
import { scheduleCommentJobs } from "@/lib/autoCommentsRunner";
import { topUpPageStories } from "@/lib/autoStoryRunner";

export interface PublishDuePostResult {
  id: string;
  status: string;
  error?: string;
  retryable?: boolean;
  adsScheduled?: string;
}

export async function publishDuePost(
  inputPost: Post,
  options: { publishToPage?: boolean } = {}
): Promise<PublishDuePostResult> {
  const claim = await prisma.post.updateMany({
    where: { id: inputPost.id, status: { in: ["pending", "queued", "partial", "failed"] } },
    data: { status: "publishing" },
  });
  if (claim.count === 0) return { id: inputPost.id, status: "skipped" };

  let post = await prisma.post.findUniqueOrThrow({ where: { id: inputPost.id } });
  let fbError: Error | null = null;
  let igError: Error | null = null;
  let retryable = false;
  let fbPublishedNow = false;
  let fbPostId = post.fbPostId ?? "";
  let mediaUrl = post.stableMediaUrl ?? undefined;
  let cloudinaryId = post.cloudinaryId;
  let mediaType = post.mediaType ?? undefined;

  try {
    if (!post.pageId || !post.finalCaption) throw new Error("Missing pageId or finalCaption");
    if (!post.publishToFacebook && !post.publishToInstagram) throw new Error("Phải chọn ít nhất một nền tảng");
    const pageId = post.pageId;
    const finalCaption = post.finalCaption;

    const connection = await prisma.fbConnection.findUnique({ where: { pageId } });
    if (!connection) throw new Error(`No FB connection for page ${pageId}`);
    if (post.publishToInstagram && !connection.instagramUserId) {
      igError = new Error("Page chưa kết nối Instagram Professional. Hãy nhập lại token trong Cài đặt > Kết nối.");
      await prisma.post.update({ where: { id: post.id }, data: { igPublishStatus: "failed", igErrorMsg: igError.message } });
    }

    if (mediaUrl && isAutoDownAsset(cloudinaryId)) {
      const stillThere = await fetch(mediaUrl, { method: "HEAD" }).then((r) => r.ok).catch(() => false);
      if (!stillThere) {
        const fresh = await autodownDownload(post.sourceUrl);
        const freshVideo = fresh?.media?.find((item) => item.type === "video");
        if (!freshVideo) throw new Error("Media gốc đã hết hạn và không tải lại được — link gốc có thể đã bị xoá.");
        mediaUrl = freshVideo.url;
        cloudinaryId = freshVideo.public_id;
        post = await prisma.post.update({ where: { id: post.id }, data: { stableMediaUrl: mediaUrl, cloudinaryId } });
      }
    }

    let preparedInstagram: Awaited<ReturnType<typeof prepareInstagramMedia>> = [];
    if (post.publishToInstagram && !post.igPostId && !igError) {
      try {
        await prisma.post.update({ where: { id: post.id }, data: { igPublishStatus: "publishing", igErrorMsg: null } });
        preparedInstagram = await prepareInstagramMedia(post);
      } catch (error) {
        igError = error instanceof Error ? error : new Error(String(error));
        retryable = true;
        await prisma.post.update({ where: { id: post.id }, data: { igPublishStatus: "failed", igErrorMsg: igError.message } });
      }
    }

    if (post.publishToFacebook && !post.fbPostId) {
      try {
        await prisma.post.update({ where: { id: post.id }, data: { fbPublishStatus: "publishing", fbErrorMsg: null } });
        const configs = await prisma.appConfig.findMany({ where: { key: { in: ["autoAdsTemplateId"] } } });
        const cfg = Object.fromEntries(configs.map((item) => [item.key, item.value]));
        let publishToPageFlag = options.publishToPage ?? true;
        const resolvedTemplateId = post.adTemplateId ?? cfg.autoAdsTemplateId;
        if (options.publishToPage === undefined && resolvedTemplateId) {
          const tpl = await prisma.campaignTemplate.findFirst({ where: { campaignId: resolvedTemplateId } });
          if ((tpl?.settings as Record<string, unknown> | null)?.postType === "dark") publishToPageFlag = false;
        }
        if (mediaUrl && !cloudinaryId && mediaType === "video" && !preparedInstagram.length) {
          const uploaded = await uploadFromUrl(mediaUrl);
          mediaUrl = uploaded.secureUrl;
          cloudinaryId = uploaded.publicId;
          mediaType = uploaded.resourceType;
          await prisma.post.update({ where: { id: post.id }, data: { stableMediaUrl: mediaUrl, cloudinaryId, mediaType } });
        }
        const caption = !publishToPageFlag && post.ctaHeadline ? `${post.ctaHeadline}\n\n${finalCaption}` : finalCaption;
        const fbMediaUrl = preparedInstagram[0]?.url ?? mediaUrl;
        const fbMediaUrls = preparedInstagram.length > 1 ? JSON.stringify(preparedInstagram.map((item) => item.url)) : post.mediaUrls;
        const result = await publishToPage(pageId, connection.accessToken, caption, fbMediaUrl, mediaType, fbMediaUrls, publishToPageFlag);
        fbPostId = result.post_id ?? result.id ?? "";
        const fbPostUrl = publishToPageFlag && fbPostId ? `https://www.facebook.com/${fbPostId.replace("_", "/posts/")}` : "";
        fbPublishedNow = true;
        await prisma.post.update({ where: { id: post.id }, data: {
          fbPostId, fbPostUrl, fbMediaId: result.mediaId ?? null, fbPublishStatus: "done", fbErrorMsg: null,
        } });
      } catch (error) {
        fbError = error instanceof Error ? error : new Error(String(error));
        retryable = true;
        await prisma.post.update({ where: { id: post.id }, data: { fbPublishStatus: "failed", fbErrorMsg: fbError.message } });
      }
    } else if (post.publishToFacebook && post.fbPostId && post.fbPublishStatus !== "done") {
      await prisma.post.update({ where: { id: post.id }, data: { fbPublishStatus: "done", fbErrorMsg: null } });
    }

    if (post.publishToInstagram && !post.igPostId && !igError && connection.instagramUserId) {
      try {
        if (!preparedInstagram.length) preparedInstagram = await prepareInstagramMedia(post);
        const result = await publishToInstagram({
          instagramUserId: connection.instagramUserId,
          accessToken: connection.accessToken,
          caption: finalCaption,
          mediaType: mediaType === "video" ? "video" : mediaType === "carousel" ? "carousel" : "image",
          mediaUrls: preparedInstagram.map((item) => item.url),
          existingContainerId: post.igContainerId,
          onContainerCreated: async (containerId) => {
            await prisma.post.update({ where: { id: post.id }, data: { igContainerId: containerId } });
          },
          onMediaPublished: async (mediaId) => {
            await prisma.post.update({ where: { id: post.id }, data: { igPostId: mediaId, igPublishStatus: "done", igErrorMsg: null } });
          },
        });
        await prisma.post.update({ where: { id: post.id }, data: {
          igContainerId: result.containerId, igPostId: result.mediaId, igPostUrl: result.permalink,
          igPublishStatus: "done", igErrorMsg: null,
        } });
      } catch (error) {
        igError = error instanceof Error ? error : new Error(String(error));
        retryable ||= error instanceof InstagramPublishError ? error.retryable : true;
        await prisma.post.update({ where: { id: post.id }, data: { igPublishStatus: "failed", igErrorMsg: igError.message } });
      }
    } else if (post.publishToInstagram && post.igPostId && post.igPublishStatus !== "done") {
      await prisma.post.update({ where: { id: post.id }, data: { igPublishStatus: "done", igErrorMsg: null } });
    }

    const fresh = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    const fbDone = !fresh.publishToFacebook || fresh.fbPublishStatus === "done" || Boolean(fresh.fbPostId);
    const igDone = !fresh.publishToInstagram || fresh.igPublishStatus === "done" || Boolean(fresh.igPostId);
    const successCount = Number(fresh.publishToFacebook && fbDone) + Number(fresh.publishToInstagram && igDone);
    const requestedCount = Number(fresh.publishToFacebook) + Number(fresh.publishToInstagram);
    const status = successCount === requestedCount ? "done" : successCount > 0 ? "partial" : "failed";
    const errorMsg = [fbError?.message, igError?.message].filter(Boolean).join(" | ") || null;
    await prisma.post.update({ where: { id: post.id }, data: { status, errorMsg } });

    const instagramOnlyAds = fresh.publishToInstagram && !fresh.publishToFacebook;
    const adSourceReady = instagramOnlyAds ? Boolean(fresh.igPostId) : Boolean(fresh.fbPostId);
    let adsScheduledNow = false;
    if (post.adTemplateId && adSourceReady && !fresh.adStatus) {
      let destinationUrl = fresh.adDestinationUrl ?? undefined;
      if (instagramOnlyAds && !destinationUrl) {
        const firstAffiliate = await prisma.extractedLink.findFirst({
          where: { postId: post.id, myUrl: { not: null } },
          orderBy: { order: "asc" },
        });
        destinationUrl = firstAffiliate?.myUrl ?? undefined;
        if (destinationUrl) {
          await prisma.post.update({ where: { id: post.id }, data: { adDestinationUrl: destinationUrl } });
        }
      }
      try {
        await scheduleAutoAds({
          postId: post.id,
          pageId,
          adPlatform: instagramOnlyAds ? "instagram" : "facebook",
          fbPostId: instagramOnlyAds ? undefined : fbPostId,
          igPostId: instagramOnlyAds ? fresh.igPostId ?? undefined : undefined,
          instagramUserId: instagramOnlyAds ? connection.instagramUserId ?? undefined : undefined,
          destinationUrl: instagramOnlyAds ? destinationUrl : undefined,
          fbConnAccessToken: connection.accessToken,
          templateId: post.adTemplateId,
          isBatchPost: true,
          adAccountId: post.adAccountUsed ?? undefined,
          adStatus: post.adStartAt ? "ACTIVE" : (post.adPublishStatus as "ACTIVE" | "PAUSED" | null) ?? undefined,
          adStartAt: post.adStartAt ?? undefined,
          ...(post.adAgeMin != null ? { ageMinFrom: String(post.adAgeMin), ageMinTo: String(post.adAgeMin) } : {}),
          ...(post.adAgeMax != null ? { ageMaxFrom: String(post.adAgeMax), ageMaxTo: String(post.adAgeMax) } : {}),
          ...(post.adGender != null ? { gender: post.adGender } : {}),
          ...(post.adBudget != null ? { budgetMin: post.adBudget, budgetMax: post.adBudget, budgetStep: "1" } : {}),
        });
        adsScheduledNow = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[ads] post ${post.id}: scheduling failed`, error);
        await prisma.post.update({
          where: { id: post.id },
          data: { adStatus: "failed", adNextAttemptAt: null, errorMsg: `[ads] ${message}` },
        }).catch(() => {});
      }
    }

    if (fbPublishedNow && fbPostId) {
      await scheduleCommentJobs(post.id).catch((error) => console.error(`[comment] post ${post.id}: scheduling failed`, error));
      if (post.storyEnabled && post.storyCount) {
        await topUpPageStories(pageId, post.storyCount, post.id).catch((error) => console.error(`[story] post ${post.id}: scheduling failed`, error));
      }
    }

    if (status === "done") {
      try {
        const latest = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
        await cleanupInstagramMedia(post.id, latest.igMediaManifest);
        if (isAutoDownAsset(cloudinaryId)) await autodownCleanup([cloudinaryId]);
        else if (cloudinaryId) {
          await deleteFile(cloudinaryId, mediaType ?? "image");
          await prisma.post.update({ where: { id: post.id }, data: { cloudinaryId: null, stableMediaUrl: null } });
        }
      } catch (error) {
        console.error(`[cleanup] post ${post.id}: failed after publish`, error);
      }
    }

    return { id: post.id, status, ...(errorMsg ? { error: errorMsg } : {}), retryable, ...(adsScheduledNow ? { adsScheduled: "true" } : {}) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.post.update({ where: { id: inputPost.id }, data: { status: "failed", errorMsg: message } }).catch(() => {});
    return { id: inputPost.id, status: "failed", error: message, retryable: true };
  }
}
