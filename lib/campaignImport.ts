import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { META_GRAPH_API } from "@/lib/meta";
import { MetaApiError, metaRequestJson } from "@/lib/metaApiClient";
import { reserveMetaJob, scopesForPost } from "@/lib/metaThrottle";
import { enqueueQueueJob } from "@/lib/cloudflareQueue";
import { EXISTING_FACEBOOK_SOURCE, parseCampaignIds, storyIdFromCreative, mergeCampaignCandidates, readCampaignCandidates, type CampaignPostCandidate } from "@/lib/campaignSource";

const json = (value: unknown) => value as Prisma.InputJsonValue;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export async function createCampaignImport(input: { campaignIds?: unknown; requestKey?: unknown }) {
  const ids = parseCampaignIds(input.campaignIds);
  if (typeof input.requestKey !== "string" || !/^[\w-]{16,100}$/.test(input.requestKey)) throw new Error("Mã yêu cầu không hợp lệ.");
  const requestKey = input.requestKey;
  const requestHash = hash(ids);
  return prisma.$transaction(async tx => {
    await tx.$queryRawUnsafe('SELECT 1 FROM pg_advisory_xact_lock(hashtext($1)::bigint)', `campaign-import:${requestKey}`);
    const existing = await tx.campaignImport.findUnique({ where: { requestKey }, include: { sources: true } });
    if (existing) {
      if (existing.requestHash !== requestHash) throw new Error("Nội dung yêu cầu đã thay đổi; hãy tạo yêu cầu mới.");
      return existing;
    }
    return tx.campaignImport.create({ data: { requestKey, requestHash, sources: { create: ids.map(campaignId => ({ campaignId })) } }, include: { sources: true } });
  });
}

export async function enqueueCampaignSource(sourceId: string, delaySeconds = 0) {
  return enqueueQueueJob({ type: "campaign-source", sourceId }, delaySeconds);
}

async function graph<T>(node: string, token: string, fields: string, accountId?: string, after?: string) {
  const url = new URL(`${META_GRAPH_API}/${node}`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("fields", fields);
  url.searchParams.set("limit", "3");
  if (after) url.searchParams.set("after", after);
  return (await metaRequestJson<T>(url.toString(), { cache: "no-store", signal: AbortSignal.timeout(12_000) }, { adAccountId: accountId })).data;
}

export async function processCampaignSource(sourceId: string): Promise<{ retry: boolean; retryAfterSeconds?: number }> {
  const source = await prisma.campaignImportSource.findUnique({ where: { id: sourceId } });
  if (!source || ["done", "failed"].includes(source.status)) return { retry: false };
  const now = Date.now();
  const waitUntil = Math.max(source.nextAttemptAt?.getTime() ?? 0, source.leaseUntil?.getTime() ?? 0);
  if (waitUntil > now) return { retry: true, retryAfterSeconds: Math.max(1, Math.ceil((waitUntil - now) / 1000)) };
  const lease = new Date(now + 120_000);
  const claim = await prisma.campaignImportSource.updateMany({ where: { id: sourceId, updatedAt: source.updatedAt, status: { in: ["pending", "resolving"] } }, data: { status: "resolving", leaseUntil: lease } });
  if (!claim.count) return { retry: false };
  const owned = { id: sourceId, leaseUntil: lease };
  try {
    const gate = await reserveMetaJob("campaign_read", scopesForPost(null, source.accountId), sourceId);
    if (!gate.allowed) {
      await prisma.campaignImportSource.updateMany({ where: owned, data: { status: "pending", leaseUntil: null, nextAttemptAt: new Date(now + gate.retryAfterSeconds * 1000), errorMsg: gate.reason ?? "Chờ quota Meta" } });
      return { retry: true, retryAfterSeconds: gate.retryAfterSeconds };
    }
    const accounts = await prisma.fbAdAccount.findMany({ orderBy: { createdAt: "asc" } });
    let tokenAccount = accounts.find(a => a.accountId === source.tokenAccountId);
    let accountId = source.accountId;
    let accountName = source.accountName;
    let campaignName = source.campaignName;
    if (!accountId || !tokenAccount) {
      const knownPost = await prisma.post.findFirst({ where: { adCampaignId: source.campaignId }, select: { adAccountUsed: true } });
      const template = await prisma.campaignTemplate.findFirst({ where: { campaignId: source.campaignId }, select: { adAccountId: true } });
      const hint = knownPost?.adAccountUsed ?? template?.adAccountId;
      const ordered = [...accounts].sort((a, b) => Number(b.accountId === hint) - Number(a.accountId === hint));
      const seen = new Set<string>();
      const unique = ordered.filter(candidate => {
        if (!candidate.accessToken || seen.has(candidate.accessToken)) return false;
        seen.add(candidate.accessToken); return true;
      });
      for (const candidate of unique.slice(source.tokenCursor, source.tokenCursor + 1)) {
        try {
          const campaign = await graph<{ id: string; name: string; account_id: string; objective?: string }>(source.campaignId, candidate.accessToken, "id,name,account_id,objective", candidate.accountId);
          if (campaign.id !== source.campaignId || !/^\d+$/.test(campaign.account_id) || !campaign.objective) throw new Error("ID đã nhập không phải campaign Facebook hợp lệ.");
          const owner = accounts.find(a => a.accountId.replace(/^act_/, "") === campaign.account_id);
          if (!owner) throw new Error("TKQC gốc của campaign chưa kết nối trong PostFlow.");
          tokenAccount = candidate; accountId = owner.accountId; accountName = owner.name; campaignName = campaign.name;
          break;
        } catch (error) {
          if (!(error instanceof MetaApiError) || ["rate_limit", "transient", "unknown"].includes(error.category)) throw error;
          // Only a definite denial/missing object allows trying another saved user token.
          if (source.tokenCursor + 1 < unique.length) {
            await prisma.campaignImportSource.updateMany({ where: owned, data: { tokenCursor: source.tokenCursor + 1, status: "pending", leaseUntil: null, nextAttemptAt: new Date(Date.now() + 3000), errorMsg: "Đang kiểm tra quyền đọc campaign qua kết nối tiếp theo." } });
            return { retry: true, retryAfterSeconds: 3 };
          }
        }
      }
      if (!tokenAccount || !accountId) throw new Error("Không đọc được campaign: ID không đúng, token hết hạn hoặc thiếu quyền ads_read.");
      await prisma.campaignImportSource.updateMany({ where: owned, data: { tokenAccountId: tokenAccount.accountId, accountId, accountName, campaignName } });
    }
    const page = await graph<{ data?: Array<{ id: string; effective_status?: string; creative?: { id: string; effective_object_story_id?: string; object_story_id?: string; thumbnail_url?: string } }>; paging?: { next?: string; cursors?: { after?: string } } }>(
      `${source.campaignId}/ads`, tokenAccount.accessToken, "id,effective_status,creative{id,effective_object_story_id,object_story_id,thumbnail_url}", accountId, source.cursor ?? undefined);
    const found = readCampaignCandidates(source.candidates);
    const issues = Array.isArray(source.issues) ? [...source.issues] : [];
    // Serial reads keep one campaign page inside the serverless budget and avoid Page request bursts.
    for (const ad of page.data ?? []) {
      const storyId = storyIdFromCreative(ad.creative ?? {});
      if (!storyId) { issues.push({ adId: ad.id, error: "Creative không có Story ID Facebook có thể dùng lại." }); continue; }
      const pageId = storyId.split("_")[0];
      const connection = await prisma.fbConnection.findUnique({ where: { pageId } });
      if (!connection) { issues.push({ adId: ad.id, storyId, error: "Page của bài chưa kết nối trong PostFlow." }); continue; }
      let candidate = found.find(item => item.storyId === storyId);
      if (!candidate) {
        try {
          const post = await graph<{ id: string; message?: string; full_picture?: string; permalink_url?: string; from?: { id: string }; is_eligible_for_promotion?: boolean }>(storyId, connection.accessToken, "id,message,full_picture,permalink_url,from,is_eligible_for_promotion", accountId);
          if (post.id !== storyId || (post.from?.id && post.from.id !== pageId) || post.is_eligible_for_promotion === false) throw new Error("Bài không còn hợp lệ để quảng bá.");
          candidate = { storyId, pageId, pageName: connection.pageName, message: post.message ?? "", thumbnailUrl: post.full_picture ?? ad.creative?.thumbnail_url ?? null, permalink: post.permalink_url ?? `https://www.facebook.com/${storyId}`, sources: [] };
          found.push(candidate);
        } catch (error) {
          if (error instanceof MetaApiError && ["rate_limit", "transient", "token"].includes(error.category)) throw error;
          if (!(error instanceof MetaApiError) && !(error instanceof Error && error.message === "Bài không còn hợp lệ để quảng bá.")) throw error;
          issues.push({ adId: ad.id, storyId, error: "Không đọc được bài: bài đã xóa, thiếu quyền hoặc không thể quảng bá." }); continue;
        }
      }
      candidate.sources.push({ campaignId: source.campaignId, campaignName: campaignName!, accountId: accountId!, accountName: accountName!, adId: ad.id, creativeId: ad.creative!.id, adStatus: ad.effective_status ?? "UNKNOWN" });
    }
    const next = page.paging?.next ? page.paging.cursors?.after : null;
    if (page.paging?.next && (!next || next === source.cursor)) throw new Error("Meta trả phân trang không hợp lệ; chưa đọc hết campaign.");
    const merged = mergeCampaignCandidates(found);
    await prisma.campaignImportSource.updateMany({ where: owned, data: {
      candidates: json(merged), issues: json(issues), cursor: next ?? source.cursor,
      status: next ? "pending" : merged.length ? "done" : "failed", leaseUntil: null,
      nextAttemptAt: next ? new Date(Date.now() + 3000) : null, attempt: 0,
      errorMsg: next || merged.length ? null : "Campaign không có bài Facebook đủ điều kiện dùng lại; xem lỗi từng ads.",
    } });
    return next ? { retry: true, retryAfterSeconds: 3 } : { retry: false };
  } catch (error) {
    const databaseTransient = typeof error === "object" && error !== null && "code" in error && ["P1001", "P1002", "P1008", "P1017", "P2024", "P2028", "P2034"].includes(String(error.code));
    const retryable = !(error instanceof MetaApiError) ? databaseTransient || /timeout|aborted|fetch|network/i.test(error instanceof Error ? error.message : "") : ["rate_limit", "transient", "unknown"].includes(error.category);
    const rateLimited = error instanceof MetaApiError && error.category === "rate_limit";
    const attempt = source.attempt + (rateLimited ? 0 : 1);
    const retry = retryable && attempt <= 5;
    const delay = Math.max(error instanceof MetaApiError ? error.retryAfterSeconds ?? 0 : 0, rateLimited ? 300 : Math.min(900, 30 * 2 ** attempt));
    const message = error instanceof MetaApiError ? error.message : retryable ? "Kết nối Meta/DB tạm thời không phản hồi; đang chờ thử lại." : error instanceof Error ? error.message : "Không thể đọc campaign.";
    await prisma.campaignImportSource.updateMany({ where: owned, data: { status: retry ? "pending" : "failed", leaseUntil: null, nextAttemptAt: retry ? new Date(Date.now() + delay * 1000) : null, attempt, errorMsg: message } });
    return { retry, retryAfterSeconds: delay };
  }
}

export async function getCampaignImport(id: string) {
  const session = await prisma.campaignImport.findUnique({ where: { id }, include: { sources: { orderBy: { id: "asc" } } } });
  if (!session) return null;
  return { id: session.id, batchId: session.batchId, candidates: mergeCampaignCandidates(session.sources.flatMap(s => readCampaignCandidates(s.candidates))),
    sources: session.sources.map(({ tokenAccountId: _tokenAccount, leaseUntil: _lease, candidates: _candidates, ...publicSource }) => publicSource) };
}

export async function confirmCampaignImport(id: string, selected: unknown) {
  if (!Array.isArray(selected) || !selected.length || selected.length > 200 || selected.some(s => typeof s !== "string") || new Set(selected).size !== selected.length) throw new Error("Chọn từ 1 đến 200 bài khác nhau.");
  const ids = selected as string[];
  const selectionHash = hash([...ids].sort());
  return prisma.$transaction(async tx => {
    await tx.$queryRawUnsafe('SELECT 1 FROM pg_advisory_xact_lock(hashtext($1)::bigint)', `campaign-selection:${id}`);
    const session = await tx.campaignImport.findUnique({ where: { id }, include: { sources: true } });
    if (!session) throw new Error("Không tìm thấy phiên nhập.");
    if (session.batchId) {
      if (session.selectionHash !== selectionHash) throw new Error("Phiên nhập đã xác nhận với danh sách bài khác.");
      return session.batchId;
    }
    if (session.sources.some(s => !["done", "failed"].includes(s.status))) throw new Error("Chờ đọc xong tất cả campaign trước khi chọn bài.");
    const pool = mergeCampaignCandidates(session.sources.flatMap(s => readCampaignCandidates(s.candidates)));
    const chosen = ids.map(id => { const row = pool.find(r => r.storyId === id); if (!row) throw new Error("Bài được chọn không thuộc kết quả đọc campaign."); return row; });
    const batch = await tx.batch.create({ data: { sourceKind: EXISTING_FACEBOOK_SOURCE } });
    await tx.post.createMany({ data: chosen.map((row, order) => ({ batchId: batch.id, order, sourceKind: EXISTING_FACEBOOK_SOURCE, sourceStoryId: row.storyId,
      adSourceSnapshot: json(row), sourceUrl: row.permalink, title: row.sources[0].campaignName, rawCaption: row.message, finalCaption: row.message,
      thumbnailUrl: row.thumbnailUrl, pageId: row.pageId, fbPostId: row.storyId, fbObjectStoryId: row.storyId, fbPostUrl: row.permalink,
      status: "done", fbPublishStatus: "done", publishToFacebook: true, publishToInstagram: false, adCtaType: "NO_BUTTON", adCtaScope: "AD_ONLY",
      campaignName: `${row.sources[0].campaignName} [Reuse ${batch.id.slice(-6)}-${order + 1}]`,
    })) });
    await tx.campaignImport.update({ where: { id }, data: { batchId: batch.id, selectionHash } });
    return batch.id;
  }, { timeout: 20_000 });
}

export async function recoverCampaignImports() {
  const now = new Date();
  const sources = await prisma.campaignImportSource.findMany({ where: { OR: [
    { status: "pending", updatedAt: { lt: new Date(Date.now() - 120_000) }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
    { status: "resolving", leaseUntil: { lte: now } },
  ] }, take: 50 });
  for (const source of sources) {
    const claim = await prisma.campaignImportSource.updateMany({ where: { id: source.id, updatedAt: source.updatedAt }, data: { status: "pending", nextAttemptAt: now, leaseUntil: null } });
    if (claim.count) {
      const queued = await enqueueCampaignSource(source.id);
      if (!queued) await prisma.campaignImportSource.updateMany({ where: { id: source.id, status: "pending" }, data: { nextAttemptAt: now, errorMsg: "Queue chưa sẵn sàng; cron sẽ thử lại." } });
    }
  }
  return sources.length;
}
