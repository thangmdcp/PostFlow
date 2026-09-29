import { prisma } from "@/lib/prisma";
import { AdTemplateConfigurationError, cloneAdCampaign, fetchAdTemplateBlueprint } from "@/lib/facebook";
import { AdSourceNotReadyError, SOURCE_READY_RETRY_DELAYS_MS } from "@/lib/adSourceReadiness";
import { portableTemplateBlueprint, templateBlueprintFromSettings } from "@/lib/adTemplateBlueprint";
import { randomInteger } from "@/lib/adSettings";
import { resolveUtmContent } from "@/lib/resolveUtmContent";
import { enqueueAds } from "@/lib/cloudflareQueue";
import { parseAdPlacementConfig, type AdPlacementConfig } from "@/lib/adPlacements";
import { MetaApiError } from "@/lib/metaApiClient";
import { BudgetPolicyError, getVerifiedAdAccountPolicy, validateMinorBudgetForAccount } from "@/lib/adBudgetPolicy";
import { parseAdCtaType, validateAdCta, type AdCtaType } from "@/lib/adCta";
import { parseAdAdvantageConfig, type AdAdvantageConfig } from "@/lib/adAdvantage";

// Facebook needs a bit of time after a post publishes (especially video)
// before it's eligible to be referenced by an ad creative. Instead of
// racing it, ads are attempted on a schedule — 15s after publish, then
// +30s, then +2m if still failing — with the wait times visible to the
// user via adStatus/adNextAttemptAt so the UI can show a countdown instead
// of the process being invisible.
//
// Cloudflare Queue owns delayed delivery and retry. Supabase
// stores state for the UI and idempotency, not a cron-owned retry schedule.
const RETRY_DELAYS_MS = [30_000, 120_000, 300_000];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length;
const DAY_MS = 86_400_000;
const BATCH_AD_SPACING_MS = 20_000;
const META_RATE_LIMIT_RETRY_MS = 5 * 60_000;

function stableJitterMs(value: string, maxMs = 30_000): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return hash % maxMs;
}

function isMetaRateLimited(message: string) {
  return /(?:user|application) request limit reached|rate limit|error code.?17|code[=": ]+(?:4|17|32|613|80001|80002|80004)/i.test(message);
}

function metaRateLimitDelayMs(attempt: number, postId: string): number {
  // Meta's per-user window commonly outlives a short 5-minute wait. Back off
  // exponentially, then cap at one hour; quota responses remain pending
  // rather than being misreported as a permanent ads failure.
  const base = Math.min(META_RATE_LIMIT_RETRY_MS * 2 ** Math.max(0, attempt - 1), 60 * 60_000);
  return base + stableJitterMs(postId);
}

// A queue delay or a slow Facebook upload can make a prepared post arrive
// after its originally selected Ads time. Keep the user's chosen clock time
// and roll it to the next day instead of creating an Ad Set with a start
// time that has already elapsed.
function rollPreparedStartForward(start: Date, now = Date.now()): Date {
  if (start.getTime() > now) return start;
  const days = Math.floor((now - start.getTime()) / DAY_MS) + 1;
  return new Date(start.getTime() + days * DAY_MS);
}

export interface AutoAdsRunParams {
  postId: string;
  pageId: string;
  adPlatform: "facebook" | "instagram";
  fbPostId?: string;
  igPostId?: string;
  instagramUserId?: string;
  destinationUrl?: string;
  ctaType: AdCtaType;
  fbConnAccessToken: string;
  templateId: string | null;
  isBatchPost: boolean;
  adAccountId?: string; // explicit per-row override (batch UI), skips weighted pick
  ageMinFrom?: string; ageMinTo?: string;
  ageMaxFrom?: string; ageMaxTo?: string;
  gender?: string;
  budgetCurrency?: string;
  budgetMinor?: string;
  adStatus?: "ACTIVE" | "PAUSED"; // campaign/adset/ad status once created — defaults to PAUSED
  adStartAt?: Date; // prepared campaigns are created before this time
  adPlacements?: AdPlacementConfig;
  adAdvantage?: AdAdvantageConfig;
}

export async function scheduleAutoAds(params: AutoAdsRunParams): Promise<void> {
  const missingSource = params.adPlatform === "instagram"
    ? !params.igPostId || !params.instagramUserId
    : !params.fbPostId;
  if (!params.templateId || missingSource || !params.pageId) {
    // Structural skip (ads not enabled / bad state) — record immediately,
    // nothing to wait for.
    await prisma.post.update({
      where: { id: params.postId },
      data: {
        adStatus: "skipped",
        errorMsg: `[ads] Bỏ qua tạo ads: ${!params.templateId ? "không có template" : missingSource ? "thiếu nguồn bài hoặc URL đích" : "thiếu pageId"}.`,
      },
    }).catch(() => {});
    return;
  }
  const cta = validateAdCta({ ctaType: params.ctaType, destinationUrl: params.destinationUrl, adsEnabled: true });
  if (cta.error) throw new AdTemplateConfigurationError(cta.error);
  if (!params.adAccountId || !params.budgetMinor || !params.budgetCurrency) {
    throw new BudgetPolicyError(
      "BUDGET_INVALID",
      "Thiếu snapshot TKQC, currency hoặc ngân sách minor units; không xếp hàng tạo Ads.",
      409,
    );
  }
  const verifiedAccount = await getVerifiedAdAccountPolicy(params.adAccountId);
  const verifiedBudget = validateMinorBudgetForAccount({
    account: verifiedAccount,
    amountMinor: params.budgetMinor,
    currency: params.budgetCurrency,
  });

  const resolvedAdStartAt = params.adStartAt ? rollPreparedStartForward(params.adStartAt) : undefined;
  const prepareForStart = !!resolvedAdStartAt;
  // Meta applies a strict per-user Graph API limit. Publishing a batch can
  // finish nearly simultaneously, so starting every ad 15 seconds later used
  // to burst dozens of Graph calls at once. Spread only batch rows by their
  // stable row order; normal one-off posts keep the quick 15-second start.
  const queuePost = await prisma.post.findUnique({ where: { id: params.postId }, select: { batchId: true, order: true } });
  const initialDelayMs = prepareForStart
    ? 0
    : RETRY_DELAYS_MS[0] + (queuePost?.batchId ? queuePost.order * BATCH_AD_SPACING_MS : 0);
  const nextAttemptAt = new Date(Date.now() + initialDelayMs);
  await prisma.post.update({
    where: { id: params.postId },
    data: {
      adStatus: "pending", adNextAttemptAt: nextAttemptAt, adAttempt: 0,
      adPlatform: params.adPlatform,
      ...(params.destinationUrl ? { adDestinationUrl: params.destinationUrl } : {}),
      adCtaType: cta.ctaType,
      ...(params.templateId ? { adTemplateId: params.templateId } : {}),
      ...(params.adAccountId ? { adAccountUsed: params.adAccountId } : {}),
      ...(params.ageMinFrom ? { adAgeMin: Number(params.ageMinFrom) } : {}),
      ...(params.ageMaxFrom ? { adAgeMax: Number(params.ageMaxFrom) } : {}),
      ...(params.gender !== undefined ? { adGender: params.gender } : {}),
      adBudget: verifiedBudget.amountMajor,
      adBudgetMinor: verifiedBudget.amountMinor,
      adBudgetCurrency: verifiedBudget.currency,
      ...(resolvedAdStartAt ? { adStartAt: resolvedAdStartAt } : {}),
      ...(params.adAdvantage ? { adAdvantageConfig: params.adAdvantage as unknown as import("@prisma/client").Prisma.InputJsonValue } : {}),
    },
  }).catch(() => {});
  if (!await enqueueAds(params.postId, Math.ceil(initialDelayMs / 1000))) {
    throw new Error("Không thể đưa Ads vào Cloudflare Queue");
  }
}

// Called only by the secure Queue consumer endpoint.
export async function attemptAutoAds(postId: string): Promise<{ retry: boolean; retryAfterSeconds?: number }> {
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post || !["pending", "queued", "creating"].includes(post.adStatus ?? "")) return { retry: false };
  if (post.adStatus === "creating") {
    if (post.updatedAt.getTime() > Date.now() - 10 * 60_000) return { retry: true, retryAfterSeconds: 60 };
    await prisma.post.updateMany({
      where: { id: postId, adStatus: "creating", updatedAt: { lte: new Date(Date.now() - 10 * 60_000) } },
      data: { adStatus: "pending" },
    });
  }
  const failStructural = async (message: string) => {
    await prisma.post.update({
      where: { id: postId },
      data: { adStatus: "failed", adNextAttemptAt: null, errorMsg: `[ads] ${message}` },
    }).catch(() => {});
    return { retry: false };
  };
  if (!post.pageId) return failStructural("Bài chưa có Page để tạo quảng cáo");
  if (!post.adAccountUsed || !post.adBudgetMinor || !post.adBudgetCurrency) {
    return failStructural("Thiếu snapshot TKQC/currency/ngân sách an toàn; không được phép random lại khi retry");
  }
  const fbConn = await prisma.fbConnection.findUnique({ where: { pageId: post.pageId } });
  if (!fbConn) return failStructural("Không tìm thấy kết nối Page");
  const adPlatform = post.adPlatform === "instagram" ? "instagram" : "facebook";
  if (adPlatform === "facebook" && !post.fbPostId) return failStructural("Bài Facebook chưa đăng thành công");
  if (adPlatform === "instagram" && !post.igPostId) return failStructural("Bài Instagram chưa đăng thành công");
  if (adPlatform === "instagram" && !fbConn.instagramUserId) return failStructural("Page chưa kết nối Instagram Professional");
  // Null is a legacy row from before CTA snapshots existed. Preserve the old
  // behavior even if a queued worker runs during the migration rollout.
  const ctaType = post.adCtaType === null
    ? adPlatform === "instagram" ? "LEARN_MORE" : "NO_BUTTON"
    : parseAdCtaType(post.adCtaType);
  if (!ctaType) return failStructural("Snapshot CTA không hợp lệ; hãy huỷ lịch và cấu hình lại bài.");
  const cta = validateAdCta({ ctaType, destinationUrl: post.adDestinationUrl, adsEnabled: true });
  if (cta.error) return failStructural(cta.error);
  const attemptNumber = (post.adAttempt ?? 0) + 1;
  const params: AutoAdsRunParams = {
    postId: post.id, pageId: post.pageId, adPlatform,
    fbPostId: post.fbPostId ?? undefined,
    igPostId: post.igPostId ?? undefined,
    instagramUserId: fbConn.instagramUserId ?? undefined,
    destinationUrl: post.adDestinationUrl ?? undefined,
    ctaType,
    fbConnAccessToken: fbConn.accessToken,
    templateId: post.adTemplateId, isBatchPost: !!post.adTemplateId,
    adAccountId: post.adAccountUsed ?? undefined,
    ...(post.adAgeMin != null ? { ageMinFrom: String(post.adAgeMin), ageMinTo: String(post.adAgeMin) } : {}),
    ...(post.adAgeMax != null ? { ageMaxFrom: String(post.adAgeMax), ageMaxTo: String(post.adAgeMax) } : {}),
    ...(post.adGender != null ? { gender: post.adGender } : {}),
    ...(post.adBudgetMinor != null ? { budgetMinor: post.adBudgetMinor } : {}),
    ...(post.adBudgetCurrency != null ? { budgetCurrency: post.adBudgetCurrency } : {}),
    adStatus: (post.adStartAt ? "ACTIVE" : post.adPublishStatus as "ACTIVE" | "PAUSED" | null) ?? undefined,
    adStartAt: post.adStartAt ?? undefined,
    adPlacements: parseAdPlacementConfig(post.adPlacementConfig) ?? undefined,
    adAdvantage: parseAdAdvantageConfig(post.adAdvantageConfig) ?? undefined,
  };
  // Record the attempt count BEFORE calling out to Facebook, not just on
  // completion — if the serverless invocation dies mid-call, the row is
  // left stuck on "creating" with the OLD attempt count, and
  // processDueAdRetries would otherwise retry it forever since it never
  // sees the count go up. Bumping it up-front means a stuck row hits
  // MAX_ATTEMPTS and gets marked failed instead of looping.
  const attemptClaim = await prisma.post.updateMany({
    where: { id: params.postId, adStatus: { in: ["pending", "queued"] } },
    data: { adStatus: "creating", adAttempt: attemptNumber },
  }).catch(() => ({ count: 0 }));
  if (!attemptClaim.count) return { retry: false };

  try {
    const { campaignId, adAccountId } = await createAdCampaignForPost(params);
    await prisma.post.update({
      where: { id: params.postId },
      data: { adStatus: "done", adCampaignId: campaignId, adAccountUsed: adAccountId, adAttempt: attemptNumber, errorMsg: null, adNextAttemptAt: null },
    });
    console.log(`[auto-ads] post ${params.postId}: campaign ${campaignId} created in account ${adAccountId} (attempt ${attemptNumber})`);
    return { retry: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "auto-ads failed";
    console.error(`[auto-ads] post ${params.postId} attempt ${attemptNumber} failed:`, msg);

    // A template without an Ad Set cannot become valid by waiting. Retrying
    // that error was both misleading in the UI and could leave users with
    // repeated empty campaign drafts in Ads Manager.
    const isConfigurationError = err instanceof AdTemplateConfigurationError || err instanceof BudgetPolicyError || /targeting_optimization|1870189|1870197|1870227|advantage_audience|placement_soft_opt_out|degrees_of_freedom_spec|creative_features_spec|standard_enhancements|Cần có cờ đối tượng Advantage|trường .* đã bị gỡ|field .* removed|publisher_platforms|device_platforms|facebook_positions|instagram_positions|messenger_positions|audience_network_positions|threads_positions|invalid placement/i.test(msg);
    const isPermanentInstagramError = params.adPlatform === "instagram" && /not eligible|cannot be advertised|can't be advertised|not authorized|permission|does not have access|invalid.*(?:media|post)|unsupported|copyright|music|access token.*(?:expired|invalid)|OAuthException[^\n]*190/i.test(msg);
    const rateLimited = (err instanceof MetaApiError && err.category === "rate_limit") || isMetaRateLimited(msg);
    const permanentMetaError = err instanceof MetaApiError && ["permission", "token", "configuration", "media"].includes(err.category);
    const sourceNotReady = err instanceof AdSourceNotReadyError || /AD_SOURCE_NOT_READY|chưa sẵn sàng|đang được xử lý|cannot be advertised|can't be advertised|không thể đưa vào quảng cáo|2446187|1487472/i.test(msg);
    const sourceCanRetry = sourceNotReady && attemptNumber <= SOURCE_READY_RETRY_DELAYS_MS.length;
    const normalCanRetry = !sourceNotReady && attemptNumber < MAX_ATTEMPTS;
    // A quota response needs a much longer, individually-jittered retry. It
    // must not be treated like a normal creative delay, otherwise every row
    // from the batch retries together and immediately exhausts Meta again.
    if (!isConfigurationError && !isPermanentInstagramError && (sourceCanRetry || rateLimited || (!permanentMetaError && normalCanRetry))) {
      const delay = rateLimited
        ? Math.max((err instanceof MetaApiError ? err.retryAfterSeconds ?? 0 : 0) * 1000, metaRateLimitDelayMs(attemptNumber, params.postId))
        : sourceNotReady
          ? SOURCE_READY_RETRY_DELAYS_MS[Math.min(attemptNumber - 1, SOURCE_READY_RETRY_DELAYS_MS.length - 1)]
          : RETRY_DELAYS_MS[Math.min(attemptNumber - 1, RETRY_DELAYS_MS.length - 1)];
      const nextAttemptAt = new Date(Date.now() + delay);
      await prisma.post.update({
        where: { id: params.postId },
        data: {
          adStatus: "pending", adNextAttemptAt: nextAttemptAt,
          // Waiting for quota is not a failed creation attempt. Keep the
          // previous count so a long throttle window cannot exhaust retries.
          adAttempt: rateLimited ? post.adAttempt ?? 0 : attemptNumber,
          errorMsg: `${rateLimited ? "[quota]" : sourceNotReady ? "[source]" : "[ads]"} ${msg}`,
        },
      }).catch(() => {});
      return { retry: true, retryAfterSeconds: Math.ceil(delay / 1000) };
    } else {
      await prisma.post.update({
        where: { id: params.postId },
        data: { adStatus: "failed", adAttempt: attemptNumber, adNextAttemptAt: null, errorMsg: `[ads] ${msg}` },
      }).catch(() => {});
      return { retry: false };
    }
  }
}

/**
 * Older queue consumers marked a Meta rate-limit response as permanently
 * failed after three quick attempts. Recover those rows once, with the same
 * batch spacing used for new jobs, so users do not need to republish posts.
 */
export async function recoverRateLimitedAds(): Promise<number> {
  const failed = await prisma.post.findMany({
    where: {
      status: "done",
      adStatus: "failed",
      errorMsg: { contains: "request limit reached", mode: "insensitive" },
      adBudgetMinor: { not: null },
      adBudgetCurrency: { not: null },
    },
    select: { id: true, order: true },
    take: 50,
  });

  let recovered = 0;
  await Promise.all(failed.map(async (post) => {
    const delay = metaRateLimitDelayMs(5, post.id) + post.order * BATCH_AD_SPACING_MS;
    const nextAttemptAt = new Date(Date.now() + delay);
    const claim = await prisma.post.updateMany({
      where: { id: post.id, adStatus: "failed", errorMsg: { contains: "request limit reached", mode: "insensitive" } },
      data: { adStatus: "pending", adNextAttemptAt: nextAttemptAt },
    });
    if (!claim.count) return;
    if (await enqueueAds(post.id, Math.ceil(delay / 1000))) {
      recovered++;
      return;
    }
    await prisma.post.updateMany({
      where: { id: post.id, adStatus: "pending" },
      data: { adStatus: "failed", adNextAttemptAt: null, errorMsg: "[ads] Không thể đưa lượt thử lại Meta vào Queue." },
    });
  }));
  return recovered;
}

async function createAdCampaignForPost(p: AutoAdsRunParams): Promise<{ campaignId: string; adAccountId: string }> {
  const configs = await prisma.appConfig.findMany({
    where: { key: { in: [
      "autoAdsTemplateId", "autoAdsAdAccountId", "autoAdsStatus",
      "autoAdsAgeMinFrom", "autoAdsAgeMinTo", "autoAdsAgeMaxFrom", "autoAdsAgeMaxTo", "autoAdsGender",
      "batchAgeMinFrom", "batchAgeMinTo", "batchAgeMaxFrom", "batchAgeMaxTo",
      "batchGender",
    ] } },
  });
  const cfg: Record<string, string> = {};
  for (const c of configs) cfg[c.key] = c.value;

  interface AdsAccountRow {
    id: string; accountId: string; weight: number; assignedCount: number;
    budgetMin: string; budgetMax: string; budgetStep: string; templateId: string | null;
    budgetCurrency: string | null; budgetMinMinor: string | null;
    budgetMaxMinor: string | null; budgetStepMinor: string | null;
  }
  const accountRows = await prisma.$queryRawUnsafe<AdsAccountRow[]>(
    `SELECT * FROM "AutoAdsAccount" ORDER BY "sortOrder" ASC, "id" ASC`
  );

  let pickedAccountId: string;
  let pickedTemplateId: string;
  let pickedRowId: string | null = null;

  const rowOverride = p.adAccountId ? accountRows.find((r) => r.accountId === p.adAccountId) : undefined;

  if (p.adAccountId) {
    // Post.adAccountUsed is authoritative. AutoAdsAccount only supplies
    // weighted defaults and must never redirect an explicit user choice.
    pickedAccountId = p.adAccountId;
    pickedTemplateId = p.templateId ?? rowOverride?.templateId ?? "";
    pickedRowId = rowOverride?.id ?? null;
  } else if (accountRows.length > 0) {
    // Deficit-based weighted round-robin — see publish route history for why.
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
    pickedTemplateId = picked.templateId ?? cfg.autoAdsTemplateId;
    pickedRowId      = picked.id;
  } else {
    throw new AdTemplateConfigurationError("Chưa cấu hình TKQC với currency và trần ngân sách đã xác nhận.");
  }

  const rawAdAccountId = pickedAccountId.replace(/^act_/, "");
  const adAccount = await getVerifiedAdAccountPolicy(pickedAccountId);
  const adsAccessToken = adAccount.accessToken;

  const postFull = await prisma.post.findUnique({
    where: { id: p.postId },
    include: { extractedLinks: { orderBy: { order: "asc" } } },
  });
  // Post.campaignName is persisted at link-save time (either an explicit
  // Sub_id-derived name from the file-import flow, or auto-detected from a
  // manually-pasted long-form link's ?utm_content=). Most real affiliate
  // links are shortened (s.shopee.vn/xxx) and carry no visible query string
  // at all, so re-parsing utm_content from the link here — after the fact —
  // essentially never finds anything; that's why this reads the persisted
  // field instead. The URL-parse below is only a last-resort fallback.
  let campaignName = postFull?.campaignName ?? "";
  if (!campaignName) {
    // Safety net for links saved before campaignName started getting
    // persisted at save time — resolve it now the same way.
    const affUrl = postFull?.extractedLinks?.find((l) => l.myUrl)?.myUrl ?? "";
    if (affUrl) campaignName = (await resolveUtmContent(affUrl)) ?? "";
  }

  // Every queue attempt, including the first one, must carry the immutable
  // snapshot chosen before enqueueing. Never randomize again in a worker.
  if (!p.budgetMinor || !p.budgetCurrency) {
    throw new AdTemplateConfigurationError("Thiếu snapshot ngân sách/currency; không được phép random lại trong Queue.");
  }
  const verifiedBudget = validateMinorBudgetForAccount({
    account: adAccount,
    amountMinor: p.budgetMinor,
    currency: p.budgetCurrency,
  });
  const dailyBudgetMinor = verifiedBudget.amountMinor;
  const dailyBudget = verifiedBudget.amountMajor;
  const budgetCurrency = verifiedBudget.currency;

  const pfx = p.isBatchPost ? "batch" : "autoAds";
  const ageMinFrom = Number(p.ageMinFrom ?? cfg[`${pfx}AgeMinFrom`] ?? cfg.autoAdsAgeMinFrom ?? 18);
  const ageMinTo   = Number(p.ageMinTo   ?? cfg[`${pfx}AgeMinTo`]   ?? cfg.autoAdsAgeMinTo   ?? 25);
  const ageMaxFrom = Number(p.ageMaxFrom ?? cfg[`${pfx}AgeMaxFrom`] ?? cfg.autoAdsAgeMaxFrom ?? 45);
  const ageMaxTo   = Number(p.ageMaxTo   ?? cfg[`${pfx}AgeMaxTo`]   ?? cfg.autoAdsAgeMaxTo   ?? 65);
  const ageMin = randomInteger(ageMinFrom, ageMinTo);
  const ageMax = randomInteger(Math.max(ageMinTo, ageMaxFrom), ageMaxTo);
  const effGender = p.gender ?? cfg[`${pfx}Gender`] ?? cfg.autoAdsGender ?? "";

  const finalTemplateId = p.templateId ?? pickedTemplateId;
  if (!finalTemplateId) throw new Error("Không xác định được template quảng cáo");
  const templateSnapshot = await prisma.campaignTemplate.findFirst({
    where: { campaignId: finalTemplateId },
    select: { adAccountId: true, settings: true },
  });
  if (!templateSnapshot) throw new AdTemplateConfigurationError("Không tìm thấy template quảng cáo đã chọn.");
  const crossAccount = templateSnapshot.adAccountId !== pickedAccountId;
  let templateBlueprint = templateBlueprintFromSettings(templateSnapshot.settings);
  if (!templateBlueprint) {
    if (crossAccount) {
      throw new AdTemplateConfigurationError("Template cũ thiếu snapshot Ad Set; hãy quét và lưu lại trước khi dùng cho TKQC khác.");
    }
    templateBlueprint = await fetchAdTemplateBlueprint(finalTemplateId, adsAccessToken);
  }
  const portableTemplate = portableTemplateBlueprint(templateBlueprint, crossAccount);
  if (portableTemplate.removedFields.length) {
    console.warn(`[auto-ads] stripped account-bound template fields for ${pickedAccountId}: ${portableTemplate.removedFields.join(", ")}`);
  }

  // Persist the exact account and randomized parameters before the first
  // external create call. If Meta fails halfway through, the next queue
  // attempt resumes the saved campaign/ad set with the same configuration.
  await prisma.post.update({
    where: { id: p.postId },
    data: {
      adAccountUsed: pickedAccountId,
      adBudget: dailyBudget,
      adBudgetMinor: dailyBudgetMinor,
      adBudgetCurrency: budgetCurrency,
      adAgeMin: ageMin,
      adAgeMax: ageMax,
      adGender: effGender,
      adPlatform: p.adPlatform,
      adCtaType: p.ctaType,
      ...(p.destinationUrl ? { adDestinationUrl: p.destinationUrl } : {}),
    },
  });

  const result = await cloneAdCampaign(
    portableTemplate.blueprint,
    p.pageId,
    p.adPlatform === "instagram"
      ? {
          platform: "instagram",
          igPostId: p.igPostId!,
          instagramUserId: p.instagramUserId!,
          destinationUrl: p.destinationUrl!,
          ctaType: p.ctaType,
        }
      : { platform: "facebook", fbPostId: p.fbPostId!, instagramUserId: p.instagramUserId, destinationUrl: p.destinationUrl, ctaType: p.ctaType },
    rawAdAccountId,
    adsAccessToken,
    dailyBudgetMinor,
    p.fbConnAccessToken,
    campaignName || undefined,
    ageMin,
    ageMax,
    effGender,
    p.adStatus ?? (cfg.autoAdsStatus as "ACTIVE" | "PAUSED") ?? "PAUSED",
    p.adStartAt,
    p.adPlacements,
    p.adAdvantage,
    {
      campaignId: postFull?.adCampaignId,
      adSetId: postFull?.adSetId,
      creativeId: postFull?.adCreativeId,
      adId: postFull?.adId,
      objectStoryId: postFull?.fbObjectStoryId,
    },
    async (progress) => {
      await prisma.post.update({
        where: { id: p.postId },
        data: {
          ...(progress.campaignId ? { adCampaignId: progress.campaignId } : {}),
          ...(progress.adSetId ? { adSetId: progress.adSetId } : {}),
          ...(progress.creativeId ? { adCreativeId: progress.creativeId } : {}),
          ...(progress.adId ? { adId: progress.adId } : {}),
          ...(progress.objectStoryId ? { fbObjectStoryId: progress.objectStoryId } : {}),
        },
      });
    }
  );

  await prisma.$executeRawUnsafe(
    `UPDATE "Post" SET "adBudget" = $1, "adBudgetMinor" = $2, "adBudgetCurrency" = $3, "adAgeMin" = $4, "adAgeMax" = $5, "adGender" = $6 WHERE "id" = $7`,
    dailyBudget, dailyBudgetMinor, budgetCurrency, ageMin, ageMax, effGender, p.postId
  );

  if (pickedRowId) {
    await prisma.$executeRawUnsafe(
      `UPDATE "AutoAdsAccount" SET "assignedCount" = "assignedCount" + 1 WHERE "id" = $1`,
      pickedRowId
    );
  }

  return { campaignId: result.campaignId, adAccountId: pickedAccountId };
}
