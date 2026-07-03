import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/prisma";
import { cloneAdCampaign } from "@/lib/facebook";
import { randomStep, randomInteger } from "@/lib/adSettings";

// Facebook needs a bit of time after a post publishes (especially video)
// before it's eligible to be referenced by an ad creative. Instead of
// racing it, ads are attempted on a schedule — 1 min after publish, then
// +2 min, then +5 min if still failing — with the wait times visible to the
// user via adStatus/adNextAttemptAt so the UI can show a countdown instead
// of the process being invisible.
//
// Only the FIRST attempt is a real in-process wait (via waitUntil) — a
// serverless invocation's lifetime is capped (tens of seconds to a few
// minutes depending on plan), nowhere near enough to hold open a chain
// summing to 1+2+5 = 8 minutes. Retries after a failed first attempt instead
// just persist adNextAttemptAt and get picked up by the existing cron tick
// (app/api/cron/publish, polled every ~5 min by UptimeRobot) — see
// processDueAdRetries. This means a 2nd/3rd attempt may fire a few minutes
// later than its nominal delay if it lands between cron ticks.
const RETRY_DELAYS_MS = [60_000, 120_000, 300_000]; // 1m, then +2m, then +5m
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length;

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
  adStatus?: "ACTIVE" | "PAUSED"; // campaign/adset/ad status once created — defaults to PAUSED
}

// Call this right after a post publishes successfully. Schedules (and
// persists) the first attempt — doesn't block the caller.
export function scheduleAutoAds(params: AutoAdsRunParams): void {
  if (!params.templateId || !params.fbPostId || !params.pageId) {
    // Structural skip (ads not enabled / bad state) — record immediately,
    // nothing to wait for.
    prisma.post.update({
      where: { id: params.postId },
      data: {
        adStatus: "skipped",
        errorMsg: `[ads] Bỏ qua tạo ads: ${!params.templateId ? "không có template" : !params.fbPostId ? "không có fbPostId" : "thiếu pageId"}.`,
      },
    }).catch(() => {});
    return;
  }

  const nextAttemptAt = new Date(Date.now() + RETRY_DELAYS_MS[0]);
  prisma.post.update({
    where: { id: params.postId },
    data: { adStatus: "pending", adNextAttemptAt: nextAttemptAt, adAttempt: 0 },
  }).catch(() => {});

  waitUntil(
    new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[0])).then(() =>
      attemptAutoAds(params, 0)
    )
  );
}

// Exported so the cron route can also call it directly (for retries beyond
// the first attempt) without going through scheduleAutoAds' waitUntil.
export async function attemptAutoAds(params: AutoAdsRunParams, attemptIndex: number): Promise<void> {
  const attemptNumber = attemptIndex + 1;
  await prisma.post.update({
    where: { id: params.postId },
    data: { adStatus: "creating" },
  }).catch(() => {});

  try {
    const { campaignId, adAccountId } = await createAdCampaignForPost(params);
    await prisma.post.update({
      where: { id: params.postId },
      data: { adStatus: "done", adCampaignId: campaignId, adAccountUsed: adAccountId, adAttempt: attemptNumber, errorMsg: null, adNextAttemptAt: null },
    });
    console.log(`[auto-ads] post ${params.postId}: campaign ${campaignId} created in account ${adAccountId} (attempt ${attemptNumber})`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "auto-ads failed";
    console.error(`[auto-ads] post ${params.postId} attempt ${attemptNumber} failed:`, msg);

    if (attemptIndex + 1 < MAX_ATTEMPTS) {
      // Don't chain another waitUntil here — 2m/5m delays would exceed the
      // invocation's remaining lifetime. Just record when the next attempt
      // is due; the cron tick picks it up (see processDueAdRetries).
      const delay = RETRY_DELAYS_MS[attemptIndex + 1];
      const nextAttemptAt = new Date(Date.now() + delay);
      await prisma.post.update({
        where: { id: params.postId },
        data: { adStatus: "pending", adNextAttemptAt: nextAttemptAt, adAttempt: attemptNumber, errorMsg: `[ads] ${msg}` },
      }).catch(() => {});
    } else {
      await prisma.post.update({
        where: { id: params.postId },
        data: { adStatus: "failed", adAttempt: attemptNumber, adNextAttemptAt: null, errorMsg: `[ads] ${msg}` },
      }).catch(() => {});
    }
  }
}

// Called from the cron tick for posts whose adNextAttemptAt has passed
// (2nd/3rd attempt) or whose "creating" status has been stuck for a while
// (invocation died mid-attempt, e.g. a cold-start timeout) — treats stuck
// "creating" as a retry so it doesn't get orphaned forever.
export async function processDueAdRetries(): Promise<void> {
  const now = new Date();
  const stuckSince = new Date(now.getTime() - 3 * 60_000);
  const due = await prisma.post.findMany({
    where: {
      OR: [
        { adStatus: "pending", adNextAttemptAt: { lte: now } },
        { adStatus: "creating", updatedAt: { lte: stuckSince } },
      ],
    },
  });

  for (const post of due) {
    if (!post.pageId || !post.fbPostId) continue;
    const fbConn = await prisma.fbConnection.findUnique({ where: { pageId: post.pageId } });
    if (!fbConn) continue;

    await attemptAutoAds(
      {
        postId: post.id,
        pageId: post.pageId,
        fbPostId: post.fbPostId,
        fbConnAccessToken: fbConn.accessToken,
        templateId: post.adTemplateId,
        isBatchPost: !!post.adTemplateId,
        adStatus: (post.adPublishStatus as "ACTIVE" | "PAUSED" | null) ?? undefined,
      },
      post.adAttempt ?? 0
    );
  }
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
  const affUrl = postFull?.extractedLinks?.find((l) => l.myUrl)?.myUrl ?? "";
  let campaignName = "";
  try {
    const parsed = new URL(affUrl);
    campaignName = decodeURIComponent(parsed.searchParams.get("utm_content") ?? "").trim().replace(/[-_]+$/, "");
  } catch { /* ignore */ }

  const dailyBudget = String(randomStep(pickedBudgetMin, pickedBudgetMax, pickedBudgetStep));

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
    p.adStatus ?? (cfg.autoAdsStatus as "ACTIVE" | "PAUSED") ?? "PAUSED"
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
