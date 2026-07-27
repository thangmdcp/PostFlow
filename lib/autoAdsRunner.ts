import { prisma } from "@/lib/prisma";
import { AdTemplateConfigurationError, cloneAdCampaign } from "@/lib/facebook";
import { randomStep, randomInteger } from "@/lib/adSettings";
import { resolveUtmContent } from "@/lib/resolveUtmContent";
import { enqueueAds } from "@/lib/cloudflareQueue";

// Facebook needs a bit of time after a post publishes (especially video)
// before it's eligible to be referenced by an ad creative. Instead of
// racing it, ads are attempted on a schedule — 15s after publish, then
// +30s, then +2m if still failing — with the wait times visible to the
// user via adStatus/adNextAttemptAt so the UI can show a countdown instead
// of the process being invisible.
//
// Cloudflare Queue owns delayed delivery and retry. Supabase
// stores state for the UI and idempotency, not a cron-owned retry schedule.
const RETRY_DELAYS_MS = [15_000, 30_000, 120_000]; // 15s, then +30s, then +2m
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
  return /(?:user|application) request limit reached|rate limit|error code.?17/i.test(message);
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
  fbPostId: string;
  fbConnAccessToken: string;
  templateId: string | null;
  isBatchPost: boolean;
  adAccountId?: string; // explicit per-row override (batch UI), skips weighted pick
  ageMinFrom?: string; ageMinTo?: string;
  ageMaxFrom?: string; ageMaxTo?: string;
  gender?: string;
  budgetMin?: string; budgetMax?: string; budgetStep?: string; // explicit per-row budget — the batch table already rolled and displayed this value, so it must be the one actually used, not re-rolled from the TKQC account's own range
  adStatus?: "ACTIVE" | "PAUSED"; // campaign/adset/ad status once created — defaults to PAUSED
  adStartAt?: Date; // prepared campaigns are created before this time
}

export async function scheduleAutoAds(params: AutoAdsRunParams): Promise<void> {
  if (!params.templateId || !params.fbPostId || !params.pageId) {
    // Structural skip (ads not enabled / bad state) — record immediately,
    // nothing to wait for.
    await prisma.post.update({
      where: { id: params.postId },
      data: {
        adStatus: "skipped",
        errorMsg: `[ads] Bỏ qua tạo ads: ${!params.templateId ? "không có template" : !params.fbPostId ? "không có fbPostId" : "thiếu pageId"}.`,
      },
    }).catch(() => {});
    return;
  }

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
      ...(params.templateId ? { adTemplateId: params.templateId } : {}),
      ...(params.adAccountId ? { adAccountUsed: params.adAccountId } : {}),
      ...(params.ageMinFrom ? { adAgeMin: Number(params.ageMinFrom) } : {}),
      ...(params.ageMaxFrom ? { adAgeMax: Number(params.ageMaxFrom) } : {}),
      ...(params.gender !== undefined ? { adGender: params.gender } : {}),
      ...(params.budgetMin ? { adBudget: params.budgetMin } : {}),
      ...(resolvedAdStartAt ? { adStartAt: resolvedAdStartAt } : {}),
    },
  }).catch(() => {});
  if (!await enqueueAds(params.postId, Math.ceil(initialDelayMs / 1000))) {
    throw new Error("Không thể đưa Ads vào Cloudflare Queue");
  }
}

// Called only by the secure Queue consumer endpoint.
export async function attemptAutoAds(postId: string): Promise<{ retry: boolean; retryAfterSeconds?: number }> {
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post || post.adStatus === "done" || post.adStatus === "failed") return { retry: false };
  if (!post.pageId || !post.fbPostId) return { retry: false };
  const fbConn = await prisma.fbConnection.findUnique({ where: { pageId: post.pageId } });
  if (!fbConn) return { retry: false };
  const attemptNumber = (post.adAttempt ?? 0) + 1;
  const params: AutoAdsRunParams = {
    postId: post.id, pageId: post.pageId, fbPostId: post.fbPostId, fbConnAccessToken: fbConn.accessToken,
    templateId: post.adTemplateId, isBatchPost: !!post.adTemplateId,
    adAccountId: post.adAccountUsed ?? undefined,
    ...(post.adAgeMin != null ? { ageMinFrom: String(post.adAgeMin), ageMinTo: String(post.adAgeMin) } : {}),
    ...(post.adAgeMax != null ? { ageMaxFrom: String(post.adAgeMax), ageMaxTo: String(post.adAgeMax) } : {}),
    ...(post.adGender != null ? { gender: post.adGender } : {}),
    ...(post.adBudget != null ? { budgetMin: post.adBudget, budgetMax: post.adBudget, budgetStep: "1" } : {}),
    adStatus: (post.adStartAt ? "ACTIVE" : post.adPublishStatus as "ACTIVE" | "PAUSED" | null) ?? undefined,
    adStartAt: post.adStartAt ?? undefined,
  };
  // Record the attempt count BEFORE calling out to Facebook, not just on
  // completion — if the serverless invocation dies mid-call, the row is
  // left stuck on "creating" with the OLD attempt count, and
  // processDueAdRetries would otherwise retry it forever since it never
  // sees the count go up. Bumping it up-front means a stuck row hits
  // MAX_ATTEMPTS and gets marked failed instead of looping.
  await prisma.post.update({
    where: { id: params.postId },
    data: { adStatus: "creating", adAttempt: attemptNumber },
  }).catch(() => {});

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
    const isConfigurationError = err instanceof AdTemplateConfigurationError;
    const rateLimited = isMetaRateLimited(msg);
    // A quota response needs a much longer, individually-jittered retry. It
    // must not be treated like a normal creative delay, otherwise every row
    // from the batch retries together and immediately exhausts Meta again.
    const canRetryRateLimit = rateLimited && attemptNumber < MAX_ATTEMPTS + 2;
    if (!isConfigurationError && (attemptNumber < MAX_ATTEMPTS || canRetryRateLimit)) {
      const delay = rateLimited
        ? META_RATE_LIMIT_RETRY_MS + stableJitterMs(params.postId)
        : RETRY_DELAYS_MS[attemptNumber];
      const nextAttemptAt = new Date(Date.now() + delay);
      await prisma.post.update({
        where: { id: params.postId },
        data: { adStatus: "pending", adNextAttemptAt: nextAttemptAt, adAttempt: attemptNumber, errorMsg: `[ads] ${msg}` },
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
      adAttempt: { lt: MAX_ATTEMPTS + 2 },
    },
    select: { id: true, order: true },
    take: 50,
  });

  let recovered = 0;
  await Promise.all(failed.map(async (post) => {
    const delay = META_RATE_LIMIT_RETRY_MS + post.order * BATCH_AD_SPACING_MS + stableJitterMs(post.id);
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
      "autoAdsBudgetMin", "autoAdsBudgetMax", "autoAdsBudgetStep",
      "batchAgeMinFrom", "batchAgeMinTo", "batchAgeMaxFrom", "batchAgeMaxTo",
      "batchGender", "batchBudgetMin", "batchBudgetMax", "batchBudgetStep",
    ] } },
  });
  const cfg: Record<string, string> = {};
  for (const c of configs) cfg[c.key] = c.value;

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

  const rowOverride = p.adAccountId ? accountRows.find((r) => r.accountId === p.adAccountId) : undefined;

  if (rowOverride) {
    pickedAccountId  = rowOverride.accountId;
    pickedBudgetMin  = Number(rowOverride.budgetMin)  || 100000;
    pickedBudgetMax  = Number(rowOverride.budgetMax)  || 200000;
    pickedBudgetStep = Number(rowOverride.budgetStep) || 10000;
    pickedTemplateId = rowOverride.templateId ?? cfg.autoAdsTemplateId;
    pickedRowId      = rowOverride.id;
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
    pickedBudgetMin  = Number(picked.budgetMin) || Number(cfg.batchBudgetMin) || 100000;
    pickedBudgetMax  = Number(picked.budgetMax) || Number(cfg.batchBudgetMax) || 200000;
    pickedBudgetStep = Number(picked.budgetStep) || Number(cfg.batchBudgetStep) || 10000;
    pickedTemplateId = picked.templateId ?? cfg.autoAdsTemplateId;
    pickedRowId      = picked.id;
  } else {
    if (!cfg.autoAdsAdAccountId) throw new Error("Chưa cấu hình tài khoản quảng cáo");
    pickedAccountId  = cfg.autoAdsAdAccountId;
    pickedBudgetMin  = Number(cfg.batchBudgetMin  ?? cfg.autoAdsBudgetMin ?? 100000);
    pickedBudgetMax  = Number(cfg.batchBudgetMax  ?? cfg.autoAdsBudgetMax ?? 200000);
    pickedBudgetStep = Number(cfg.batchBudgetStep ?? cfg.autoAdsBudgetStep ?? 10000);
    pickedTemplateId = cfg.autoAdsTemplateId;
  }

  const rawAdAccountId = pickedAccountId.replace(/^act_/, "");
  const adAccount = await prisma.fbAdAccount.findUnique({ where: { accountId: pickedAccountId } });
  const adsAccessToken = adAccount?.accessToken ?? p.fbConnAccessToken;

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

  // The batch table already rolled and showed a specific budget for this
  // post — use it exactly instead of re-rolling from the TKQC account row's
  // own range, which is what caused the ad's actual budget to end up
  // different from what the table displayed.
  //
  // SAFETY NET: a stale client bundle or a client-side account/budget
  // pairing bug can persist an explicit budget that was actually rolled for
  // a DIFFERENT account (e.g. a VND account's 40000-55000 range attached to
  // a USD account whose own range is 2-3). Combined with the currency
  // minor-unit conversion in lib/facebook.ts, that turns a should-be
  // $2-3/day budget into tens of thousands of USD/day — this happened for
  // real and cost real money. Reject any explicit budget that's wildly
  // outside the picked account's OWN currently configured range and fall
  // back to rolling fresh from the account's real config instead, no matter
  // what the client sent.
  const explicitMin = p.budgetMin !== undefined && p.budgetMin !== "" ? Number(p.budgetMin) : null;
  const explicitMax = p.budgetMax !== undefined && p.budgetMax !== "" ? Number(p.budgetMax) : explicitMin;
  const SAFETY_MULTIPLIER = 5; // generous margin over the account's own configured max
  const explicitInRange =
    explicitMin !== null && explicitMax !== null &&
    explicitMin > 0 && explicitMax > 0 &&
    explicitMax <= pickedBudgetMax * SAFETY_MULTIPLIER;

  if (explicitMin !== null && !explicitInRange) {
    console.error(
      `[auto-ads] SAFETY: rejected out-of-range explicit budget ${p.budgetMin}-${p.budgetMax} for account ${pickedAccountId} ` +
      `(account's configured max is ${pickedBudgetMax}) — rolling from the account's own range instead`
    );
  }

  const dailyBudget = explicitInRange
    ? String(randomStep(explicitMin!, explicitMax!, Number(p.budgetStep ?? 1)))
    : String(randomStep(pickedBudgetMin, pickedBudgetMax, pickedBudgetStep));

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
    p.adStatus ?? (cfg.autoAdsStatus as "ACTIVE" | "PAUSED") ?? "PAUSED",
    p.adStartAt
  );

  await prisma.$executeRawUnsafe(
    `UPDATE "Post" SET "adBudget" = $1, "adAgeMin" = $2, "adAgeMax" = $3, "adGender" = $4 WHERE "id" = $5`,
    dailyBudget, ageMin, ageMax, effGender, p.postId
  );

  if (pickedRowId) {
    await prisma.$executeRawUnsafe(
      `UPDATE "AutoAdsAccount" SET "assignedCount" = "assignedCount" + 1 WHERE "id" = $1`,
      pickedRowId
    );
  }

  return { campaignId: result.campaignId, adAccountId: pickedAccountId };
}
