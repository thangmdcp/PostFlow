import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publishToPage } from "@/lib/facebook";
import { uploadFromUrl, deleteFile } from "@/lib/cloudinary";
import { autodownDownload, autodownCleanup, isAutoDownAsset } from "@/lib/autodown";
import { scheduleAutoAds } from "@/lib/autoAdsRunner";

// The first ads attempt (1 min after publish) runs via waitUntil, which
// extends THIS invocation's lifetime — maxDuration must cover the publish
// itself plus that ~1 min wait plus the attempt. Later retries (if the first
// fails) are picked up by the cron tick instead, not chained here, since
// their delays (2m/5m) would blow well past any serverless duration limit.
export const maxDuration = 90;

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

    // Ads are attempted on a schedule (1m, then +2m, +5m if still failing) —
    // see lib/autoAdsRunner.ts. Doesn't block this response.
    const adsWillRun = !!body.templateId;
    if (adsWillRun) {
      scheduleAutoAds({
        postId: params.id,
        pageId,
        fbPostId,
        fbConnAccessToken: fbConn.accessToken,
        templateId: body.templateId ?? null,
        isBatchPost: true,
        adAccountId: body.adAccountId,
        ageMinFrom: body.ageMinFrom, ageMinTo: body.ageMinTo,
        ageMaxFrom: body.ageMaxFrom, ageMaxTo: body.ageMaxTo,
        gender: body.gender,
      });
    }

    return NextResponse.json({ ok: true, fbPostUrl, autoAds: adsWillRun ? { scheduled: true } : null });
  } catch (err) {
    console.error("[publish] FULL ERROR:", JSON.stringify(err, null, 2), err);
    const msg = err instanceof Error ? err.message : (typeof err === "object" ? JSON.stringify(err) : String(err));
    await prisma.post.update({ where: { id: params.id }, data: { status: "failed", errorMsg: msg } }).catch(() => {});
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
