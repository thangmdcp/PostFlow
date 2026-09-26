import { META_GRAPH_API as FB_API, META_GRAPH_VIDEO_API as FB_VIDEO_API } from "@/lib/meta";
import {
  buildFacebookExistingPostCreative,
  buildInstagramExistingPostCreative,
  restrictTargetingToInstagram,
  sanitizeMetaTargeting,
} from "@/lib/instagramAds";
import {
  templateBlueprintFromSettings,
  type AdTemplateBlueprint,
} from "@/lib/adTemplateBlueprint";
import { applyAdPlacements, validateAdPlacements, type AdPlacementConfig } from "@/lib/adPlacements";
import { metaRequestJson, MetaApiError } from "@/lib/metaApiClient";
import type { MetaRequestContext } from "@/lib/metaUsage";
import { prisma } from "@/lib/prisma";

async function metaJson<T>(url: string, init: RequestInit = {}, context: MetaRequestContext = {}): Promise<T> {
  return (await metaRequestJson<T>(url, init, context)).data;
}

// Lets the queue runner distinguish a broken template from a transient Meta
// API failure. The former must be reported immediately instead of retried.
export class AdTemplateConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdTemplateConfigurationError";
  }
}

// Facebook's Marketing API takes daily_budget in the account currency's
// smallest unit (cents for USD, etc.) — a "zero decimal" currency like VND
// or JPY has no subunit, so its display value already IS the API value.
// Full list per Meta's currency docs.
const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG",
  "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);

async function toFbMinorUnits(adAccountId: string, accessToken: string, amount: string): Promise<string> {
  try {
    const normalizedId = adAccountId.replace(/^act_/, "");
    const saved = await prisma.fbAdAccount.findFirst({ where: { accountId: { in: [normalizedId, `act_${normalizedId}`] } }, select: { currency: true, currencyUpdatedAt: true } });
    const fresh = saved?.currency && saved.currencyUpdatedAt && saved.currencyUpdatedAt.getTime() > Date.now() - 24 * 60 * 60_000;
    const currency = fresh
      ? saved.currency!.toUpperCase()
      : String((await metaJson<Record<string, unknown>>(`${FB_API}/act_${normalizedId}?fields=currency&access_token=${accessToken}`, {}, { adAccountId: normalizedId })).currency ?? "").toUpperCase();
    if (!fresh && currency) {
      await prisma.fbAdAccount.updateMany({
        where: { accountId: { in: [normalizedId, `act_${normalizedId}`] } },
        data: { currency, currencyUpdatedAt: new Date() },
      }).catch(() => {});
    }
    const decimals = currency && ZERO_DECIMAL_CURRENCIES.has(currency) ? 0 : 2;
    return String(Math.round(Number(amount) * 10 ** decimals));
  } catch (error) {
    if (error instanceof MetaApiError && ["rate_limit", "permission", "token"].includes(error.category)) throw error;
    // If the currency lookup itself fails, fall back to the raw amount
    // (matches the previous behavior) rather than blocking ad creation.
    return amount;
  }
}

export async function publishToPage(
  pageId: string,
  accessToken: string,
  caption: string,
  mediaUrl?: string,
  mediaType?: string,
  mediaUrls?: string | null,
  publishedToPage = true
): Promise<{ id: string; post_id?: string; mediaId?: string }> {
  // Carousel post: upload each photo as unpublished then attach all
  if (mediaType === "carousel" && (mediaUrls || mediaUrl)) {
    const urls: string[] = mediaUrls ? JSON.parse(mediaUrls) : [mediaUrl!];
    const photoIds: string[] = [];
    for (const url of urls) {
      const json = await metaJson<{ id: string }>(`${FB_API}/${pageId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, published: false, access_token: accessToken }),
      }, { pageId });
      photoIds.push(json.id as string);
    }
    const attached_media = photoIds.map((id) => ({ media_fbid: id }));
    const json = await metaJson<{ id: string; post_id?: string }>(`${FB_API}/${pageId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: caption, attached_media, published: publishedToPage, access_token: accessToken }),
    }, { pageId });
    // A Story can only use one image — the first of the carousel is as
    // good a pick as any since there's no "primary" concept for carousels.
    return { ...json, mediaId: photoIds[0] };
  }

  if (mediaUrl && mediaType === "video") {
    // Try video upload via graph-video endpoint
    const params = new URLSearchParams({
      description: caption,
      file_url: mediaUrl,
      published: publishedToPage ? "true" : "false",
      access_token: accessToken,
    });
    let videoError: unknown;
    try {
      const json = await metaJson<{ id: string; post_id?: string }>(`${FB_VIDEO_API}/${pageId}/videos`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      }, { pageId });
      return { ...json, mediaId: json.id };
    } catch (error) {
      videoError = error;
      if (error instanceof MetaApiError && ["rate_limit", "permission", "token"].includes(error.category)) throw error;
    }
    // json.id here is the permanent FB-native video id (not a temp URL), so
    // it can be reused later (e.g. for an auto-story) without depending on
    // the original temp Cloudinary asset still being alive.
    // Fallback: post as feed with video link in caption
    console.warn("Video upload failed, falling back to feed post:", videoError instanceof Error ? videoError.message : videoError);
    const fallbackCaption = `${caption}\n\n🎬 ${mediaUrl}`;
    const fbJson = await metaJson<{ id: string; post_id?: string }>(`${FB_API}/${pageId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: fallbackCaption, published: publishedToPage, access_token: accessToken }),
    }, { pageId });
    return fbJson;
  }

  if (mediaUrl) {
    // Photo post
    const json = await metaJson<{ id: string; post_id?: string }>(`${FB_API}/${pageId}/photos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caption, url: mediaUrl, published: publishedToPage, access_token: accessToken }),
    }, { pageId });
    // json.id here is the permanent FB-native photo id, reusable later the
    // same way as the video case above.
    // Photo dark post: FB returns {id} but post_id is pageId_id
    if (!publishedToPage && json.id && !json.post_id) {
      return { ...json, post_id: `${pageId}_${json.id}`, mediaId: json.id };
    }
    return { ...json, mediaId: json.id };
  }

  // Text-only post — no media, so nothing to reuse for a story.
  const json = await metaJson<{ id: string; post_id?: string }>(`${FB_API}/${pageId}/feed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: caption, published: publishedToPage, access_token: accessToken }),
  }, { pageId });
  return json;
}

// Facebook Stories are media-only via the Graph API — there is no caption/
// text-overlay field and no way to attach a clickable link (link stickers
// are a manual mobile-app-only feature), confirmed against the actual API
// during development. Reuses the FB-native photo/video id already uploaded
// for the feed post itself (Post.fbMediaId) rather than re-uploading —
// the original temp Cloudinary URL is deleted right after the feed post
// publishes, long before the ~15-minute story delay elapses.
export async function publishStoryToPage(
  pageId: string,
  accessToken: string,
  fbMediaId: string,
  mediaType: string | null
): Promise<{ postId: string }> {
  const isVideo = mediaType === "video";
  const endpoint = isVideo ? "video_stories" : "photo_stories";
  const idField = isVideo ? "video_id" : "photo_id";
  const storyJson = await metaJson<{ post_id?: string; id?: string }>(`${FB_API}/${pageId}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // video_stories treats a pre-existing video_id as having already gone
    // through the resumable upload's "start"/"transfer" phases, so it still
    // requires upload_phase=finish to actually register it as a story —
    // omitting it throws "The parameter upload_phase is required" even
    // though a real upload never happens here. photo_stories has no such
    // phase concept.
    body: JSON.stringify({ [idField]: fbMediaId, ...(isVideo ? { upload_phase: "finish" } : {}), access_token: accessToken }),
  }, { pageId });
  const postId = storyJson.post_id ?? storyJson.id;
  if (!postId) throw new Error("Meta không trả về Story ID");
  return { postId };
}

export async function postComment(objectId: string, accessToken: string, message: string, attachmentUrl?: string): Promise<{ id: string }> {
  const pageId = objectId.includes("_") ? objectId.split("_")[0] : undefined;
  const json = await metaJson<{ id: string }>(`${FB_API}/${objectId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, ...(attachmentUrl ? { attachment_url: attachmentUrl } : {}), access_token: accessToken }),
  }, { pageId });
  return json;
}

export interface FacebookComment {
  id: string;
  message?: string;
  from?: { id?: string };
}

/** Read enough top-level comments to detect comments previously left by this Page.
 * This makes retries safe when Facebook accepted a comment but the response was
 * lost before PostFlow could save its comment id. */
export async function getFacebookComments(objectId: string, accessToken: string): Promise<FacebookComment[]> {
  const comments: FacebookComment[] = [];
  const pageId = objectId.includes("_") ? objectId.split("_")[0] : undefined;
  let url: string | null = `${FB_API}/${objectId}/comments?fields=id,message,from{id}&limit=100&access_token=${encodeURIComponent(accessToken)}`;
  // A post with hundreds of comments should not turn one scheduled comment
  // into an unbounded Graph crawl; 500 is ample for the Page-owned count.
  for (let page = 0; url && page < 5; page++) {
    const json: { data?: FacebookComment[]; paging?: { next?: string } } = await metaJson(url, {}, { pageId });
    comments.push(...(json.data ?? []));
    url = json.paging?.next ?? null;
  }
  return comments;
}

export async function exchangeForLongLivedToken(
  shortToken: string
): Promise<string> {
  const url = new URL(`${FB_API}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", process.env.FACEBOOK_CLIENT_ID!);
  url.searchParams.set("client_secret", process.env.FACEBOOK_CLIENT_SECRET!);
  url.searchParams.set("fb_exchange_token", shortToken);

  const json = await metaJson<{ access_token: string }>(url.toString());
  return json.access_token;
}

export async function getPages(
  longLivedToken: string
): Promise<Array<{ id: string; name: string; access_token: string }>> {
  const json = await metaJson<{ data?: Array<{ id: string; name: string; access_token: string }> }>(
    `${FB_API}/me/accounts?access_token=${longLivedToken}&fields=id,name,access_token`
  );
  return json.data ?? [];
}

export async function getAdAccounts(
  longLivedToken: string
): Promise<Array<{ id: string; name: string; account_status: number }>> {
  const json = await metaJson<{ data?: Array<{ id: string; name: string; account_status: number }> }>(
    `${FB_API}/me/adaccounts?access_token=${longLivedToken}&fields=id,name,account_status`
  );
  return json.data ?? [];
}

export type AdPostSource =
  | { platform: "facebook"; fbPostId: string; instagramUserId?: string }
  | { platform: "instagram"; igPostId: string; instagramUserId: string; destinationUrl: string };

export interface AdCreationState {
  campaignId?: string | null;
  adSetId?: string | null;
  creativeId?: string | null;
  adId?: string | null;
  objectStoryId?: string | null;
}

export interface AdCreationProgress {
  campaignId?: string;
  adSetId?: string;
  creativeId?: string;
  adId?: string;
  objectStoryId?: string;
}

export async function fetchAdTemplateBlueprint(
  templateCampaignId: string,
  accessToken: string,
): Promise<AdTemplateBlueprint> {
  const [campaign, adSets] = await Promise.all([
    metaJson<Record<string, unknown>>(`${FB_API}/${templateCampaignId}?fields=name,objective,special_ad_categories,daily_budget,lifetime_budget&access_token=${encodeURIComponent(accessToken)}`),
    metaJson<{ data?: unknown[] }>(`${FB_API}/${templateCampaignId}/adsets?fields=name,targeting,billing_event,optimization_goal&limit=1&access_token=${encodeURIComponent(accessToken)}`),
  ]);
  const blueprint = templateBlueprintFromSettings({ ...campaign, adsets: adSets.data ?? [] });
  if (!blueprint) {
    throw new AdTemplateConfigurationError("Template quảng cáo không có Ad Set/targeting khả dụng. Hãy quét và lưu lại campaign mẫu.");
  }
  return blueprint;
}

function permissionCacheKey(adAccountId: string, pageId: string, instagramUserId?: string) {
  return [adAccountId.replace(/^act_/, ""), pageId, instagramUserId ?? "facebook"].join(":");
}

export async function ensureAdAssetAccess(
  adAccountId: string,
  pageId: string,
  instagramUserId: string | undefined,
  accessToken: string,
  options: { forceRefresh?: boolean } = {},
) {
  const normalizedId = adAccountId.replace(/^act_/, "");
  const cacheKey = permissionCacheKey(normalizedId, pageId, instagramUserId);
  if (options.forceRefresh) await prisma.metaPermissionCache.deleteMany({ where: { cacheKey } });
  const cached = await prisma.metaPermissionCache.findUnique({ where: { cacheKey } });
  if (cached && cached.expiresAt.getTime() > Date.now()) {
    if (!cached.allowed) throw new AdTemplateConfigurationError(cached.errorMsg || "TKQC chưa được cấp quyền dùng Page/Instagram.");
    return;
  }

  let errorMsg: string | null = null;
  try {
    const promotePages = await metaJson<{ data?: Array<{ id?: string }> }>(
      `${FB_API}/act_${normalizedId}/promote_pages?fields=id&limit=200&access_token=${encodeURIComponent(accessToken)}`,
      {},
      { adAccountId: normalizedId },
    );
    let canPromotePage = (promotePages.data ?? []).some((page) => page.id === pageId);
    // A Page newly shared as a partner asset can appear in the ad account's
    // owning Business client_pages before Meta adds it to promote_pages.
    // Treat that authoritative Business assignment as valid instead of
    // blocking legitimate partner Pages indefinitely.
    if (!canPromotePage) {
      const account = await metaJson<{ business?: { id?: string } }>(
        `${FB_API}/act_${normalizedId}?fields=business{id}&access_token=${encodeURIComponent(accessToken)}`,
        {},
        { adAccountId: normalizedId },
      );
      const businessId = account.business?.id;
      if (businessId) {
        const [ownedPages, clientPages] = await Promise.all([
          metaJson<{ data?: Array<{ id?: string }> }>(
            `${FB_API}/${businessId}/owned_pages?fields=id&limit=200&access_token=${encodeURIComponent(accessToken)}`,
            {},
            { adAccountId: normalizedId },
          ),
          metaJson<{ data?: Array<{ id?: string }> }>(
            `${FB_API}/${businessId}/client_pages?fields=id&limit=200&access_token=${encodeURIComponent(accessToken)}`,
            {},
            { adAccountId: normalizedId },
          ),
        ]);
        canPromotePage = [...(ownedPages.data ?? []), ...(clientPages.data ?? [])].some((page) => page.id === pageId);
      }
    }
    if (!canPromotePage) {
      errorMsg = "Tài khoản quảng cáo chưa được cấp quyền quảng bá Page đã chọn.";
    }
    if (!errorMsg && instagramUserId) {
      const instagramAccounts = await metaJson<{ data?: Array<{ id?: string }> }>(
        `${FB_API}/act_${normalizedId}/instagram_accounts?fields=id&access_token=${encodeURIComponent(accessToken)}`,
        {},
        { adAccountId: normalizedId },
      );
      if (!(instagramAccounts.data ?? []).some((account) => account.id === instagramUserId)) {
        errorMsg = "Tài khoản quảng cáo chưa được cấp quyền dùng tài khoản Instagram đã chọn.";
      }
    }
  } catch (error) {
    if (error instanceof MetaApiError && ["rate_limit", "token", "transient"].includes(error.category)) throw error;
    errorMsg = error instanceof Error ? error.message : "Không kiểm tra được quyền Page/Instagram";
  }

  await prisma.metaPermissionCache.upsert({
    where: { cacheKey },
    create: {
      cacheKey, adAccountId: normalizedId, pageId, instagramUserId,
      allowed: !errorMsg, errorMsg,
      expiresAt: new Date(Date.now() + 6 * 60 * 60_000),
    },
    update: {
      allowed: !errorMsg, errorMsg, checkedAt: new Date(),
      expiresAt: new Date(Date.now() + 6 * 60 * 60_000),
    },
  });
  if (errorMsg) throw new AdTemplateConfigurationError(errorMsg);
}

export async function cloneAdCampaign(
  template: AdTemplateBlueprint,
  pageId: string,
  source: AdPostSource,
  adAccountId: string,
  accessToken: string,
  dailyBudget = "100000",
  pageAccessToken?: string,
  campaignName?: string,
  ageMin?: number,
  ageMax?: number,
  gender?: string,
  adStatus: "ACTIVE" | "PAUSED" = "PAUSED",
  startTime?: Date,
  placementOverride?: AdPlacementConfig,
  existing: AdCreationState = {},
  onProgress?: (progress: AdCreationProgress) => Promise<void>
): Promise<{ campaignId: string; adSetId: string; creativeId: string; adId: string }> {
  const needsInstagramIdentity = source.platform === "instagram"
    || Boolean(placementOverride?.publisherPlatforms.some((platform) => platform === "instagram" || platform === "threads"));
  const instagramIdentityId = source.instagramUserId;
  if (needsInstagramIdentity && !instagramIdentityId) {
    throw new AdTemplateConfigurationError("Placement Instagram/Threads yêu cầu Page đã liên kết Instagram Professional.");
  }
  await ensureAdAssetAccess(adAccountId, pageId, needsInstagramIdentity ? instagramIdentityId : undefined, accessToken);

  // Permission preflight deliberately runs before even the cached currency
  // lookup, so a bad Page/TKQC assignment cannot create requests or empty
  // campaign shells in the destination account.
  dailyBudget = await toFbMinorUnits(adAccountId, accessToken, dailyBudget);

  let targeting = sanitizeMetaTargeting(template.targeting);
  if (placementOverride) {
    const placementError = validateAdPlacements(placementOverride, {
      instagramOnly: source.platform === "instagram",
      hasInstagram: true,
    });
    if (placementError) throw new AdTemplateConfigurationError(placementError);
    targeting = applyAdPlacements(targeting, placementOverride);
  }
  if (source.platform === "instagram") {
    // Keep template instagram_positions when present, but hard-limit delivery
    // to Instagram and remove placement families belonging to other surfaces.
    targeting = restrictTargetingToInstagram(targeting);
  } else if (!placementOverride) {
    // Preserve the legacy Facebook flow: omitting instagram_positions lets
    // Meta use the template/Advantage+ placement combination it already used.
    delete (targeting as Record<string, unknown>).instagram_positions;
  }

  // Apply user-specified age/gender overrides
  if (ageMin !== undefined) targeting.age_min = ageMin;
  if (ageMax !== undefined) targeting.age_max = ageMax;
  if (gender === "1" || gender === "2") {
    (targeting as Record<string, unknown>).genders = [Number(gender)];
  } else {
    delete (targeting as Record<string, unknown>).genders;
  }
  // Since Marketing API v24+, this flag is mandatory INSIDE the targeting
  // object. Sending it as an Ad Set sibling is accepted by neither v24 nor
  // v25 and results in OAuth subcode 1870227.
  targeting.targeting_automation = template.targetingAutomation;

  // Detect if template uses CBO (campaign-level budget)
  const useCBO = template.useCampaignBudget;

  // 2. Create campaign
  // is_adset_budget_sharing_enabled is a distinct, mutually-exclusive
  // alternative to setting daily_budget directly on the campaign (classic
  // CBO) — FB rejects the request if both are present, so it must stay
  // false/omitted whenever we're setting an explicit campaign daily_budget.
  const campBody: Record<string, unknown> = {
    name: campaignName || `${template.name} [PostFlow]`,
    objective: template.objective,
    status: adStatus,
    special_ad_categories: template.specialAdCategories,
    buying_type: "AUCTION",
    access_token: accessToken,
  };
  // With CBO, bid_strategy belongs on the campaign — setting it on the ad set
  // instead makes FB fall back to a bid-cap strategy that then demands a
  // bid_amount we never provide (OAuthException 1815857).
  if (useCBO) {
    campBody.daily_budget = dailyBudget;
    campBody.bid_strategy = "LOWEST_COST_WITHOUT_CAP";
  }

  let campaignId = existing.campaignId ?? undefined;
  let adSetId = existing.adSetId ?? undefined;
  let creativeId = existing.creativeId ?? undefined;
  let adId = existing.adId ?? undefined;
  try {
    if (!campaignId) {
      const newCamp = await metaJson<{ id: string }>(`${FB_API}/act_${adAccountId}/campaigns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(campBody),
      }, { adAccountId });
      campaignId = newCamp.id;
      await onProgress?.({ campaignId });
    }

    // 3. Create adset — budget + bid_strategy only at adset level when not CBO
    // (with CBO both live on the campaign instead, see above).
    const adSetBody: Record<string, unknown> = {
      name: campaignName || `${template.name} [PostFlow]`,
      campaign_id: campaignId,
      targeting,
      billing_event: template.billingEvent,
      optimization_goal: template.optimizationGoal,
      status: adStatus,
      access_token: accessToken,
    };
    if (!useCBO) {
      adSetBody.daily_budget = dailyBudget;
      adSetBody.bid_strategy = "LOWEST_COST_WITHOUT_CAP";
    }
    if (startTime) adSetBody.start_time = startTime.toISOString();

    if (!adSetId) {
      const newAdSet = await metaJson<{ id: string }>(`${FB_API}/act_${adAccountId}/adsets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(adSetBody),
      }, { adAccountId });
      adSetId = newAdSet.id;
      await onProgress?.({ adSetId });
    }

    // 5. Resolve and persist the canonical Page story ID once. A bare video
    // ID is not a valid object_story_id, so wait until published_posts exposes
    // the matching Page post instead of inventing pageId_videoId.
    let objectStoryId = existing.objectStoryId ?? "";
    if (source.platform === "facebook") {
      const fbPostId = source.fbPostId;
      if (!objectStoryId && fbPostId.includes("_")) objectStoryId = fbPostId;
      if (!objectStoryId && !fbPostId.includes("_")) {
        const lookupToken = pageAccessToken ?? accessToken;
        const postsUrl = `${FB_API}/${pageId}/published_posts?fields=id,attachments{target{id}}&limit=25&access_token=${lookupToken}`;
        const postsData: { data?: Record<string, unknown>[] } = await metaJson(postsUrl, {}, { pageId });
        const match = (postsData.data ?? []).find((publishedPost) => {
          const attData = (((publishedPost.attachments as Record<string, unknown>) ?? {}).data ?? []) as Record<string, unknown>[];
          return attData.some((attachment) => (attachment.target as Record<string, string> | undefined)?.id === fbPostId);
        });
        if (match) objectStoryId = match.id as string;
      }
      if (!objectStoryId) throw new Error("Bài Facebook chưa sẵn sàng để làm nguồn quảng cáo");
      if (!existing.objectStoryId) await onProgress?.({ objectStoryId });
      console.log("[creative] using objectStoryId:", objectStoryId);
    }

  // A post just published (especially video) often isn't immediately eligible
  // for ads yet — FB needs a few seconds to finish processing it before it can
  // be referenced by an ad creative. Retry with backoff instead of failing on
  // the first attempt (OAuthException 2446187 "post cannot be advertised").
    if (!creativeId) {
      const creativeBody: Record<string, unknown> = source.platform === "instagram"
          ? buildInstagramExistingPostCreative({
              name: campaignName || "PostFlow Instagram Creative",
              pageId,
              instagramUserId: source.instagramUserId,
              igPostId: source.igPostId,
              destinationUrl: source.destinationUrl,
              accessToken,
            })
          : buildFacebookExistingPostCreative({
              name: campaignName || "PostFlow Creative",
              objectStoryId,
              accessToken,
            });
      const creative = await metaJson<{ id: string }>(`${FB_API}/act_${adAccountId}/adcreatives`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(creativeBody),
      }, { adAccountId });
      creativeId = creative.id;
      await onProgress?.({ creativeId });
    }

  // 6. Create ad
    if (!adId) {
      const ad = await metaJson<{ id: string }>(`${FB_API}/act_${adAccountId}/ads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: campaignName || "PostFlow Ad",
          adset_id: adSetId,
          creative: { creative_id: creativeId },
          status: adStatus,
          access_token: accessToken,
        }),
      }, { adAccountId });
      adId = ad.id;
      await onProgress?.({ adId });
    }

    return { campaignId: campaignId!, adSetId: adSetId!, creativeId: creativeId!, adId: adId! };
  } catch (error) {
    // Keep successfully-created IDs. The queue runner persists each stage and
    // resumes from it, avoiding duplicate campaigns/ads after transient errors.
    throw error;
  }
}
