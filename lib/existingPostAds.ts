import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EXISTING_FACEBOOK_SOURCE, assertSourceStory } from "@/lib/campaignSource";
import { existingAdsTimes } from "@/lib/existingAdsPlan";
import { weightsAreValid, allocateByPercentage } from "@/lib/batchAction";
import type { BatchActionConfig } from "@/components/BatchActionDialog";
import type { BatchActionKind } from "@/lib/batchAction";
import { validateAdSelection } from "@/lib/adSelection";
import { resolveAdBudgetSnapshot } from "@/lib/adBudgetRequest";
import { resolvePostAdAdvantage } from "@/lib/adAdvantageServer";
import { parseAdPlacementConfig, validateAdPlacements } from "@/lib/adPlacements";
import { preflightPostAdPermission } from "@/lib/adPermissionPreflight";
import { randomMajorStep, majorToMinor } from "@/lib/adMoney";
import { validateMinorBudgetForAccount } from "@/lib/adBudgetPolicy";
import { randomInteger } from "@/lib/adSettings";
import { enqueueAds } from "@/lib/cloudflareQueue";

export async function configureExistingAds(input: { requestKey: string; postIds: string[]; kind: BatchActionKind; config: BatchActionConfig }) {
  if (!input || !/^[\w-]{16,100}$/.test(input.requestKey) || !Array.isArray(input.postIds) || !input.postIds.length || input.postIds.length > 200 || input.postIds.some(id => typeof id !== "string") || new Set(input.postIds).size !== input.postIds.length) throw new Error("Danh sách bài hoặc mã yêu cầu không hợp lệ.");
  const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const previous = await prisma.existingAdsAction.findUnique({ where: { requestKey: input.requestKey } });
  if (previous) {
    if (previous.requestHash !== requestHash) throw new Error("Mã yêu cầu đã dùng với cấu hình khác.");
    return { count: input.postIds.length, reused: true };
  }
  const config = input.config;
  if (!config || !Array.isArray(config.accountRows) || !weightsAreValid(config.accountRows.map(r => ({ id: r.accountId, weight: r.weight }))) || new Set(config.accountRows.map(r => r.accountId)).size !== config.accountRows.length) throw new Error("Tỷ lệ TKQC phải có tổng đúng 100%, không trùng TKQC.");
  if (!["ACTIVE", "PAUSED"].includes(config.adConfig?.adStatus)) throw new Error("Trạng thái Ads không hợp lệ.");
  const ad = config.adConfig;
  const numbers = [ad.ageMinFrom, ad.ageMinTo, ad.ageMaxFrom, ad.ageMaxTo].map(Number);
  if (numbers.some(n => !Number.isInteger(n) || n < 13 || n > 65) || numbers[1] < numbers[0] || numbers[3] < numbers[2] || numbers[3] < numbers[1] || !["", "1", "2"].includes(ad.gender)) throw new Error("Dải tuổi/giới tính không hợp lệ.");
  const posts = await prisma.post.findMany({ where: { id: { in: input.postIds }, sourceKind: EXISTING_FACEBOOK_SOURCE } });
  if (posts.length !== input.postIds.length) throw new Error("Chỉ dùng được với bài đã nhập từ campaign.");
  const times = existingAdsTimes({ ...config, ids: input.postIds, kind: input.kind });
  const allocation = allocateByPercentage(config.accountRows.map(r => ({ id: r.accountId, weight: r.weight })), posts.length);
  const checkedPairs = new Set<string>();
  const contexts = new Map<string, { budget: NonNullable<Awaited<ReturnType<typeof resolveAdBudgetSnapshot>>>; advantage: Awaited<ReturnType<typeof resolvePostAdAdvantage>>; placements: ReturnType<typeof parseAdPlacementConfig> }>();
  const pages = new Map<string, { instagramUserId: string | null }>();
  const plans: Array<{ post: (typeof posts)[number]; data: Prisma.PostUpdateManyMutationInput }> = [];
  for (let i = 0; i < input.postIds.length; i++) {
    const post = posts.find(p => p.id === input.postIds[i])!;
    assertSourceStory(post.adSourceSnapshot, post.pageId, post.fbObjectStoryId);
    if (post.fbPostId !== post.sourceStoryId || post.fbObjectStoryId !== post.sourceStoryId || post.adCampaignId || post.adSetId || post.adCreativeId || post.adId || post.adStatus) throw new Error("Bài đã được cấu hình Ads. Hủy lịch chưa chạy trước khi cấu hình lại, hoặc dùng nút thử lại.");
    const row = config.accountRows.find(r => r.accountId === allocation[i])!;
    if (!row.budgetCurrency) throw new Error("TKQC chưa có currency đã xác minh.");
    const amount = randomMajorStep(row.budgetMin, row.budgetMax, row.budgetStep, row.budgetCurrency);
    let context = contexts.get(row.accountId);
    if (!context) {
      const selectionError = await validateAdSelection(row.templateId, row.accountId);
      if (selectionError) throw new Error(selectionError);
      const budget = await resolveAdBudgetSnapshot({ templateId: row.templateId, accountId: row.accountId, budget: { amount, currency: row.budgetCurrency } });
      if (!budget) throw new Error("Thiếu snapshot ngân sách.");
      // Validate the entire requested range, not merely the randomly selected sample.
      for (const bound of [row.budgetMin, row.budgetMax]) validateMinorBudgetForAccount({ account: budget.account, currency: row.budgetCurrency, amountMinor: majorToMinor(bound, row.budgetCurrency) });
      const advantage = await resolvePostAdAdvantage(row.templateId, row.accountId, { ...ad.advantage, creativeEnabled: false });
      context = { budget, advantage, placements: advantage?.placementsEnabled ? null : parseAdPlacementConfig(ad.placements) };
      contexts.set(row.accountId, context);
    }
    const { advantage, placements } = context;
    const budget = validateMinorBudgetForAccount({ account: context.budget.account, currency: row.budgetCurrency, amountMinor: majorToMinor(amount, row.budgetCurrency) });
    let connection = pages.get(post.pageId!);
    if (!connection) {
      const saved = await prisma.fbConnection.findUnique({ where: { pageId: post.pageId! }, select: { instagramUserId: true } });
      if (!saved) throw new Error("Page của bài chưa kết nối.");
      connection = saved; pages.set(post.pageId!, saved);
    }
    if (!advantage?.placementsEnabled) {
      const error = validateAdPlacements(placements, { instagramOnly: false, hasInstagram: Boolean(connection.instagramUserId) });
      if (error) throw new Error(error);
    }
    const permission = { pageId: post.pageId, adAccountUsed: row.accountId, adPlatform: "facebook", adPlacementConfig: placements as unknown as Prisma.JsonValue };
    const pair = `${post.pageId}:${row.accountId}`;
    if (!checkedPairs.has(pair)) { await preflightPostAdPermission(permission); checkedPairs.add(pair); }
    const ageMin = randomInteger(numbers[0], numbers[1]);
    plans.push({ post, data: { adTemplateId: row.templateId!, adAccountUsed: row.accountId,
      adBudget: budget.amountMajor, adBudgetMinor: budget.amountMinor, adBudgetCurrency: budget.currency,
      adAgeMin: ageMin, adAgeMax: advantage?.audienceEnabled ? null : randomInteger(Math.max(numbers[1], numbers[2]), numbers[3]), adGender: advantage?.audienceEnabled ? null : ad.gender,
      adAdvantageConfig: advantage as unknown as Prisma.InputJsonValue, adPlacementConfig: placements ? placements as unknown as Prisma.InputJsonValue : Prisma.DbNull,
      adPublishStatus: ad.adStatus, scheduledAt: times[i].createAt, adNextAttemptAt: times[i].createAt, adStartAt: times[i].startAt,
      adStatus: "scheduled", adAttempt: 0, adPlatform: "facebook", adCtaType: "NO_BUTTON", adCtaScope: "AD_ONLY", fbCtaStatus: null,
      commentStatus: null, storyEnabled: false, storyStatus: null, errorMsg: null,
    } });
  }
  await prisma.$transaction(async tx => {
    await tx.$queryRawUnsafe('SELECT 1 FROM pg_advisory_xact_lock(hashtext($1)::bigint)', `existing-ads:${input.requestKey}`);
    const prior = await tx.existingAdsAction.findUnique({ where: { requestKey: input.requestKey } });
    if (prior) { if (prior.requestHash !== requestHash) throw new Error("Mã yêu cầu đã thay đổi."); return; }
    for (const plan of plans) {
      const claimed = await tx.post.updateMany({ where: { id: plan.post.id, updatedAt: plan.post.updatedAt, adStatus: null, adCampaignId: null, adSetId: null, adCreativeId: null, adId: null }, data: plan.data });
      if (!claimed.count) throw new Error("Bài vừa được cấu hình ở nơi khác. Tải lại batch.");
    }
    await tx.existingAdsAction.create({ data: { requestKey: input.requestKey, requestHash } });
  }, { timeout: 90_000 });
  await recoverExistingPostAds();
  return { count: plans.length, reused: false };
}

export async function recoverExistingPostAds() {
  const now = new Date();
  const due = await prisma.post.findMany({ where: { sourceKind: EXISTING_FACEBOOK_SOURCE, OR: [
    { adStatus: "scheduled", adNextAttemptAt: { lte: now } },
    { adStatus: { in: ["pending", "queued"] }, updatedAt: { lt: new Date(Date.now() - 180_000) }, OR: [{ adNextAttemptAt: null }, { adNextAttemptAt: { lte: now } }] },
    { adStatus: "creating", updatedAt: { lt: new Date(Date.now() - 600_000) } },
  ] }, take: 50, orderBy: { adNextAttemptAt: "asc" } });
  for (const post of due) {
    const claim = await prisma.post.updateMany({ where: { id: post.id, updatedAt: post.updatedAt, adStatus: post.adStatus }, data: { adStatus: "pending", adNextAttemptAt: now } });
    if (claim.count && !await enqueueAds(post.id, 0)) await prisma.post.updateMany({ where: { id: post.id, adStatus: "pending" }, data: { adStatus: "scheduled", adNextAttemptAt: new Date(Date.now() + 60_000), errorMsg: "Queue chưa sẵn sàng; tự thử lại sau 1 phút." } });
  }
  return due.length;
}

export async function cancelExistingAds(postIds: unknown) {
  if (!Array.isArray(postIds) || !postIds.length || postIds.length > 200 || postIds.some(id => typeof id !== "string")) throw new Error("Danh sách bài không hợp lệ.");
  const cancelled = await prisma.post.updateMany({ where: { id: { in: postIds }, sourceKind: EXISTING_FACEBOOK_SOURCE, adStatus: { in: ["scheduled", "pending", "queued"] }, adCampaignId: null, adSetId: null, adCreativeId: null, adId: null }, data: { adStatus: null, adNextAttemptAt: null, adStartAt: null, scheduledAt: null, adTemplateId: null, adAccountUsed: null, adBudget: null, adBudgetMinor: null, adBudgetCurrency: null, adAttempt: 0, errorMsg: null } });
  return cancelled.count;
}
