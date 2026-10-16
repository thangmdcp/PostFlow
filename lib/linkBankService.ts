import { Prisma } from "@prisma/client";
import { cleanSourceLinks, MAX_BANK_IMPORT, sourceLinkKey } from "@/lib/linkBank";

export async function appendBankLinks(tx: Prisma.TransactionClient, listId: string, values: unknown[]) {
  if (values.length > MAX_BANK_IMPORT) throw new Error(`Mỗi lần chỉ thêm tối đa ${MAX_BANK_IMPORT} link.`);
  const cleaned = cleanSourceLinks(values);
  const saved = await tx.linkBankEntry.createMany({
    data: cleaned.urls.map(sourceUrl => ({ listId, sourceUrl, urlKey: sourceLinkKey(sourceUrl)! })),
    skipDuplicates: true,
  });
  return { added: saved.count, duplicates: cleaned.duplicates + cleaned.urls.length - saved.count, invalid: cleaned.invalid };
}
