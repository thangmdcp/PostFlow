import { cleanSourceLinks, MAX_BATCH_LINKS, sourceLinkKey, type BankSelection } from "./linkBank.ts";

export type ImportableBankEntry = { id: string; sourceUrl: string; lastUsedAt: string | null };

export function composerSourceUrls(text: string): string[] {
  return cleanSourceLinks(text.split("\n").map(line => line.match(/https?:\/\/\S+/)?.[0] ?? line.trim()).filter(Boolean)).urls;
}

export function quantityImportRequest(text: string, count: string, includeUsed: boolean) {
  const excludeUrls = composerSourceUrls(text);
  const capacity = Math.max(0, MAX_BATCH_LINKS - excludeUrls.length);
  const amount = Number(count);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > MAX_BATCH_LINKS || amount > capacity) {
    throw new Error(`Số lượng cần 1–200 và không vượt chỗ trống của batch (còn ${capacity}).`);
  }
  return { count: amount, includeUsed, excludeUrls };
}

export function bankEntriesImport(text: string, entries: ImportableBankEntry[], includeUsed: boolean) {
  const existing = composerSourceUrls(text);
  const seen = new Set(existing.map(sourceLinkKey));
  const selections: BankSelection[] = [];
  for (const entry of entries) {
    const key = sourceLinkKey(entry.sourceUrl);
    if (!key || seen.has(key) || (entry.lastUsedAt && !includeUsed)) continue;
    seen.add(key);
    selections.push({ entryId: entry.id, url: entry.sourceUrl, allowUsed: includeUsed });
  }
  if (existing.length + selections.length > MAX_BATCH_LINKS) throw new Error("Batch tối đa 200 link.");
  return { urls: selections.map(entry => entry.url), selections };
}
