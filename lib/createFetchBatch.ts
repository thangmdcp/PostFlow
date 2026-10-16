import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { cleanSourceLinks, MAX_BATCH_LINKS, MAX_BANK_IMPORT, sourceLinkKey, type BankSelection } from "@/lib/linkBank";

export class BatchInputError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export async function createFetchBatch(input: { urls?: unknown; bankSelections?: unknown; requestKey?: unknown }) {
  if (!input || typeof input !== "object") throw new BatchInputError("Cần danh sách link.");
  if (!Array.isArray(input.urls) || !input.urls.length) throw new BatchInputError("Cần danh sách link.");
  if (input.urls.length > MAX_BANK_IMPORT) throw new BatchInputError("Danh sách nhập quá lớn; hãy chia nhỏ.");
  const cleaned = cleanSourceLinks(input.urls);
  if (cleaned.urls.length > MAX_BATCH_LINKS) throw new BatchInputError("Mỗi batch tối đa 200 link. Các link vẫn được giữ lại; hãy giảm số lượng.");
  if (!cleaned.urls.length || cleaned.invalid) throw new BatchInputError("Có link không hợp lệ; hãy kiểm tra lại ô nhập.");
  if (input.requestKey != null && (typeof input.requestKey !== "string" || !/^[\w-]{16,100}$/.test(input.requestKey))) throw new BatchInputError("Mã yêu cầu không hợp lệ.");
  if (input.bankSelections != null && (!Array.isArray(input.bankSelections) || input.bankSelections.length > MAX_BATCH_LINKS)) throw new BatchInputError("Nguồn Kho link không hợp lệ.");
  const keys = new Set(cleaned.urls.map(u => sourceLinkKey(u)!));
  const selections: BankSelection[] = [];
  for (const raw of (input.bankSelections ?? []) as unknown[]) {
    if (!raw || typeof raw !== "object") throw new BatchInputError("Nguồn Kho link không hợp lệ.");
    const value = raw as Record<string, unknown>;
    if (typeof value.entryId !== "string" || typeof value.url !== "string" || typeof value.allowUsed !== "boolean") throw new BatchInputError("Nguồn Kho link không hợp lệ.");
    if (keys.has(sourceLinkKey(value.url)!)) selections.push(value as BankSelection);
  }
  if (new Set(selections.map(s => sourceLinkKey(s.url))).size !== selections.length) throw new BatchInputError("Một link chỉ được lấy từ một kho trong cùng batch.");
  const requestKey = typeof input.requestKey === "string" ? input.requestKey : null;
  const requestHash = createHash("sha256").update(JSON.stringify({ urls: cleaned.urls, selections })).digest("hex");
  return prisma.$transaction(async tx => {
    if (requestKey) {
      await tx.$queryRawUnsafe('SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtext($1)::bigint)', `batch:${requestKey}`);
      const previous = await tx.batch.findUnique({ where: { requestKey }, include: { posts: { include: { extractedLinks: true, comments: true }, orderBy: { order: "asc" } } } });
      if (previous) {
        if (previous.requestHash !== requestHash) throw new BatchInputError("Nội dung yêu cầu đã thay đổi. Hãy chỉnh ô nhập rồi thử lại.", 409);
        return { batch: previous, reused: true, duplicates: cleaned.duplicates };
      }
    }
    if (selections.length) {
      // Acquire all locks in stable order in one round-trip, not 200 queries.
      await tx.$queryRawUnsafe(`SELECT 1 AS "locked" FROM (
        SELECT pg_advisory_xact_lock(hashtext('bank-entry:' || item)::bigint)
        FROM (SELECT unnest($1::text[]) AS item ORDER BY item) ids
      ) locks`, [...new Set(selections.map(s => s.entryId))].sort());
    }
    const entries = await tx.linkBankEntry.findMany({ where: { id: { in: selections.map(s => s.entryId) } } });
    for (const selection of selections) {
      const entry = entries.find(e => e.id === selection.entryId);
      if (!entry || entry.urlKey !== sourceLinkKey(selection.url)) throw new BatchInputError("Link trong kho đã thay đổi; hãy nhập lại từ kho.", 409);
      if (entry.lastUsedAt && !selection.allowUsed) throw new BatchInputError("Một số link vừa được dùng ở batch khác. Hãy xóa các link đó khỏi ô nhập và lấy thêm từ kho, hoặc chủ động bật dùng lại.", 409);
    }
    const created = await tx.batch.create({ data: { requestKey, requestHash } });
    await tx.post.createMany({ data: cleaned.urls.map((sourceUrl, order) => ({ batchId: created.id, sourceUrl, order, status: "queued", linkBankEntryId: selections.find(s => sourceLinkKey(s.url) === sourceLinkKey(sourceUrl))?.entryId })) });
    const batch = await tx.batch.findUniqueOrThrow({ where: { id: created.id }, include: { posts: { include: { extractedLinks: true, comments: true }, orderBy: { order: "asc" } } } });
    if (selections.length) await tx.linkBankEntry.updateMany({ where: { id: { in: selections.map(s => s.entryId) } }, data: { lastUsedAt: new Date(), lastBatchId: batch.id, useCount: { increment: 1 } } });
    return { batch, reused: false, duplicates: cleaned.duplicates };
  }, { timeout: 20000, maxWait: 10000 });
}
