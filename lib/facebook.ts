const FB_API = "https://graph.facebook.com/v19.0";
const FB_VIDEO_API = "https://graph-video.facebook.com/v19.0";

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
    const res = await fetch(`${FB_API}/act_${adAccountId}?fields=currency&access_token=${accessToken}`);
    const json = await res.json();
    const currency = (json.currency as string | undefined)?.toUpperCase();
    const decimals = currency && ZERO_DECIMAL_CURRENCIES.has(currency) ? 0 : 2;
    return String(Math.round(Number(amount) * 10 ** decimals));
  } catch {
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
      const res = await fetch(`${FB_API}/${pageId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, published: false, access_token: accessToken }),
      });
      const json = await res.json();
      if (json.error) throw new Error(`Carousel photo upload failed: ${json.error.message}`);
      photoIds.push(json.id as string);
    }
    const attached_media = photoIds.map((id) => ({ media_fbid: id }));
    const res = await fetch(`${FB_API}/${pageId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: caption, attached_media, published: publishedToPage, access_token: accessToken }),
    });
    const json = await res.json();
    if (json.error) throw new Error(json.error.message);
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
    const res = await fetch(`${FB_VIDEO_API}/${pageId}/videos`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const json = await res.json();
    // json.id here is the permanent FB-native video id (not a temp URL), so
    // it can be reused later (e.g. for an auto-story) without depending on
    // the original temp Cloudinary asset still being alive.
    if (!json.error) return { ...json, mediaId: json.id };

    // Fallback: post as feed with video link in caption
    console.warn("Video upload failed, falling back to feed post:", json.error?.message);
    const fallbackCaption = `${caption}\n\n🎬 ${mediaUrl}`;
    const fbRes = await fetch(`${FB_API}/${pageId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: fallbackCaption, published: publishedToPage, access_token: accessToken }),
    });
    const fbJson = await fbRes.json();
    if (fbJson.error) throw new Error(`Video: ${json.error?.message} | Feed: ${fbJson.error.message}`);
    return fbJson;
  }

  if (mediaUrl) {
    // Photo post
    const res = await fetch(`${FB_API}/${pageId}/photos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caption, url: mediaUrl, published: publishedToPage, access_token: accessToken }),
    });
    const json = await res.json();
    if (json.error) throw new Error(json.error.message);
    // json.id here is the permanent FB-native photo id, reusable later the
    // same way as the video case above.
    // Photo dark post: FB returns {id} but post_id is pageId_id
    if (!publishedToPage && json.id && !json.post_id) {
      return { ...json, post_id: `${pageId}_${json.id}`, mediaId: json.id };
    }
    return { ...json, mediaId: json.id };
  }

  // Text-only post — no media, so nothing to reuse for a story.
  const res = await fetch(`${FB_API}/${pageId}/feed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: caption, published: publishedToPage, access_token: accessToken }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
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
  const storyRes = await fetch(`${FB_API}/${pageId}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ [idField]: fbMediaId, access_token: accessToken }),
  });
  const storyJson = await storyRes.json();
  if (storyJson.error) throw new Error(`[${endpoint}] ${storyJson.error.message}`);
  return { postId: storyJson.post_id ?? storyJson.id };
}

export async function postComment(objectId: string, accessToken: string, message: string, attachmentUrl?: string): Promise<{ id: string }> {
  const res = await fetch(`${FB_API}/${objectId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, ...(attachmentUrl ? { attachment_url: attachmentUrl } : {}), access_token: accessToken }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json;
}

export async function exchangeForLongLivedToken(
  shortToken: string
): Promise<string> {
  const url = new URL(`${FB_API}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", process.env.FACEBOOK_CLIENT_ID!);
  url.searchParams.set("client_secret", process.env.FACEBOOK_CLIENT_SECRET!);
  url.searchParams.set("fb_exchange_token", shortToken);

  const res = await fetch(url.toString());
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.access_token;
}

export async function getPages(
  longLivedToken: string
): Promise<Array<{ id: string; name: string; access_token: string }>> {
  const res = await fetch(
    `${FB_API}/me/accounts?access_token=${longLivedToken}&fields=id,name,access_token`
  );
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.data ?? [];
}

export async function getAdAccounts(
  longLivedToken: string
): Promise<Array<{ id: string; name: string; account_status: number }>> {
  const res = await fetch(
    `${FB_API}/me/adaccounts?access_token=${longLivedToken}&fields=id,name,account_status`
  );
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.data ?? [];
}

export async function cloneAdCampaign(
  templateCampaignId: string,
  pageId: string,
  fbPostId: string,
  adAccountId: string,
  accessToken: string,
  dailyBudget = "100000",
  pageAccessToken?: string,
  campaignName?: string,
  ageMin?: number,
  ageMax?: number,
  gender?: string,
  adStatus: "ACTIVE" | "PAUSED" = "PAUSED"
): Promise<{ campaignId: string; adSetId: string; adId: string }> {
  // 1. Get template campaign objective + adset targeting (like FB Ads tool),
  // and convert dailyBudget (in the account's display currency, e.g. "2.75"
  // USD) into the minor-unit integer the Marketing API actually expects
  // (e.g. "275" cents) — sending the display value directly only happens to
  // work for zero-decimal currencies like VND, and silently fails/creates a
  // near-zero budget for anything else (USD, EUR, ...).
  const [campRes, adSetsRes, minorUnitBudget] = await Promise.all([
    fetch(`${FB_API}/${templateCampaignId}?fields=name,objective,special_ad_categories,daily_budget,lifetime_budget&access_token=${accessToken}`),
    fetch(`${FB_API}/${templateCampaignId}/adsets?fields=name,targeting,billing_event,optimization_goal&access_token=${accessToken}`),
    toFbMinorUnits(adAccountId, accessToken, dailyBudget),
  ]);
  dailyBudget = minorUnitBudget;
  const camp = await campRes.json();
  if (camp.error) throw new Error(`[get campaign] ${camp.error.message}`);
  const adSets = await adSetsRes.json();
  const templateAdSet = adSets.data?.[0];
  if (!templateAdSet) throw new Error("No ad sets in template campaign");

  // Remove instagram_positions entirely — FB validation is strict about required combinations.
  // Omitting it lets FB use Advantage+ placements automatically.
  const targeting = { ...(templateAdSet.targeting ?? {}) };
  delete (targeting as Record<string, unknown>).instagram_positions;

  // Apply user-specified age/gender overrides
  if (ageMin !== undefined) targeting.age_min = ageMin;
  if (ageMax !== undefined) targeting.age_max = ageMax;
  if (gender === "1" || gender === "2") {
    (targeting as Record<string, unknown>).genders = [Number(gender)];
  } else {
    delete (targeting as Record<string, unknown>).genders;
  }

  // Detect if template uses CBO (campaign-level budget)
  const useCBO = !!(camp.daily_budget || camp.lifetime_budget);

  // 2. Create campaign
  // is_adset_budget_sharing_enabled is a distinct, mutually-exclusive
  // alternative to setting daily_budget directly on the campaign (classic
  // CBO) — FB rejects the request if both are present, so it must stay
  // false/omitted whenever we're setting an explicit campaign daily_budget.
  const campBody: Record<string, unknown> = {
    name: campaignName || `${camp.name} [PostFlow]`,
    objective: camp.objective,
    status: adStatus,
    special_ad_categories: camp.special_ad_categories ?? [],
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

  const newCampRes = await fetch(`${FB_API}/act_${adAccountId}/campaigns`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(campBody),
  });
  const newCamp = await newCampRes.json();
  if (newCamp.error) throw new Error(`[create campaign] ${JSON.stringify(newCamp.error)}`);

  // 3. Create adset — budget + bid_strategy only at adset level when not CBO
  // (with CBO both live on the campaign instead, see above).
  const adSetBody: Record<string, unknown> = {
    name: campaignName || `${templateAdSet.name} [PostFlow]`,
    campaign_id: newCamp.id,
    targeting,
    billing_event: templateAdSet.billing_event ?? "IMPRESSIONS",
    optimization_goal: templateAdSet.optimization_goal ?? "LINK_CLICKS",
    status: adStatus,
    access_token: accessToken,
  };
  if (!useCBO) {
    adSetBody.daily_budget = dailyBudget;
    adSetBody.bid_strategy = "LOWEST_COST_WITHOUT_CAP";
  }

  const newAdSetRes = await fetch(`${FB_API}/act_${adAccountId}/adsets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(adSetBody),
  });
  const newAdSet = await newAdSetRes.json();
  if (newAdSet.error) throw new Error(`[create adset] ${JSON.stringify(newAdSet.error)}`);

  // 5. Resolve correct page post story ID
  // fbPostId may be a bare video ID — look up actual page post ID from published_posts
  let objectStoryId = fbPostId.includes("_") ? fbPostId : `${pageId}_${fbPostId}`;
  if (!fbPostId.includes("_")) {
    // Use page access token (not ad account token) to read published posts
    const lookupToken = pageAccessToken ?? accessToken;
    const postsRes = await fetch(
      `${FB_API}/${pageId}/published_posts?fields=id,attachments{target{id}}&limit=10&access_token=${lookupToken}`
    );
    const postsData = await postsRes.json();
    console.log("[published_posts]", JSON.stringify(postsData.data?.slice(0, 3)));
    if (!postsData.error) {
      const match = (postsData.data ?? []).find((p: Record<string, unknown>) => {
        const attData = ((p.attachments as Record<string, unknown>) ?? {}).data as Record<string, unknown>[] ?? [];
        return attData.some((a) => (a.target as Record<string, string> | undefined)?.id === fbPostId);
      });
      if (match) objectStoryId = match.id as string;
    }
  }
  console.log("[creative] using objectStoryId:", objectStoryId);

  // A post just published (especially video) often isn't immediately eligible
  // for ads yet — FB needs a few seconds to finish processing it before it can
  // be referenced by an ad creative. Retry with backoff instead of failing on
  // the first attempt (OAuthException 2446187 "post cannot be advertised").
  let creative: { id?: string; error?: unknown } = {};
  const delaysMs = [3000, 5000, 8000, 10000];
  for (let attempt = 0; attempt <= delaysMs.length; attempt++) {
    const creativeRes = await fetch(`${FB_API}/act_${adAccountId}/adcreatives`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: campaignName || "PostFlow Creative",
        object_story_id: objectStoryId,
        access_token: accessToken,
      }),
    });
    creative = await creativeRes.json();
    if (!creative.error) break;
    console.log(`[creative] attempt ${attempt + 1} failed:`, JSON.stringify(creative.error));
    if (attempt < delaysMs.length) {
      await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]));
    }
  }
  if (creative.error) throw new Error(`[creative] ${JSON.stringify(creative.error)}`);

  // 6. Create ad
  const adRes = await fetch(`${FB_API}/act_${adAccountId}/ads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: campaignName || "PostFlow Ad",
      adset_id: newAdSet.id,
      creative: { creative_id: creative.id },
      status: adStatus,
      access_token: accessToken,
    }),
  });
  const ad = await adRes.json();
  if (ad.error) throw new Error(`[create ad] ${JSON.stringify(ad.error)}`);

  return { campaignId: newCamp.id, adSetId: newAdSet.id, adId: ad.id };
}
