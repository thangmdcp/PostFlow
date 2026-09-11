export type BatchActionKind = "schedule" | "prepare" | "publish";
export type BatchRunMode = "publish_only" | "publish_and_ads";

export interface WeightedDestination {
  id: string;
  weight: number;
}

export interface BatchActionAllocation {
  pageByPost: Record<string, string>;
  accountByPost: Record<string, string>;
  pageCounts: Record<string, number>;
  accountCounts: Record<string, number>;
}

export const BATCH_ACTION_STORAGE_VERSION = 1 as const;
export const BATCH_ACTION_STORAGE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function batchActionStorageKey(kind: BatchActionKind): string {
  return `postflow_batch_action_v1_${kind}`;
}

export function weightTotal(rows: readonly WeightedDestination[]): number {
  return rows.reduce((sum, row) => sum + (Number.isFinite(Number(row.weight)) ? Number(row.weight) : 0), 0);
}

export function weightsAreValid(rows: readonly WeightedDestination[]): boolean {
  return rows.length > 0 && rows.every((row) => row.id && Number(row.weight) > 0) && weightTotal(rows) === 100;
}

/**
 * Smooth weighted round-robin. It follows percentages as closely as the
 * number of posts permits and avoids putting one destination in a long block.
 * Candidate order is rotated per action to keep repeated batches varied.
 */
export function allocateByPercentage(
  rows: readonly WeightedDestination[],
  count: number,
  random: () => number = Math.random,
): string[] {
  if (count <= 0 || rows.length === 0) return [];
  const usable = rows
    .filter((row) => row.id && Number(row.weight) > 0)
    .map((row) => ({ id: row.id, weight: Number(row.weight), current: 0 }));
  if (!usable.length) return [];
  const offset = usable.length > 1 ? Math.floor(random() * usable.length) : 0;
  const rotated = [...usable.slice(offset), ...usable.slice(0, offset)];
  const total = rotated.reduce((sum, row) => sum + row.weight, 0);
  const result: string[] = [];
  for (let index = 0; index < count; index++) {
    let picked = rotated[0];
    for (const row of rotated) {
      row.current += row.weight;
      if (row.current > picked.current) picked = row;
    }
    picked.current -= total;
    result.push(picked.id);
  }
  return result;
}

export function allocationCounts(ids: readonly string[]): Record<string, number> {
  return ids.reduce<Record<string, number>>((counts, id) => {
    counts[id] = (counts[id] ?? 0) + 1;
    return counts;
  }, {});
}

export function buildBatchActionAllocation(
  postIds: readonly string[],
  pages: readonly WeightedDestination[],
  accounts: readonly WeightedDestination[] = [],
  random: () => number = Math.random,
): BatchActionAllocation {
  const pageIds = allocateByPercentage(pages, postIds.length, random);
  const accountIds = allocateByPercentage(accounts, postIds.length, random);
  return {
    pageByPost: Object.fromEntries(postIds.map((postId, index) => [postId, pageIds[index] ?? ""])),
    accountByPost: Object.fromEntries(postIds.map((postId, index) => [postId, accountIds[index] ?? ""])),
    pageCounts: allocationCounts(pageIds),
    accountCounts: allocationCounts(accountIds),
  };
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function readLastBatchAction<T>(storage: StorageLike, kind: BatchActionKind, now = Date.now()): T | null {
  const key = batchActionStorageKey(kind);
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { version?: number; updatedAt?: number; config?: unknown };
    if (value.version !== BATCH_ACTION_STORAGE_VERSION || typeof value.updatedAt !== "number" || now - value.updatedAt > BATCH_ACTION_STORAGE_TTL_MS) {
      storage.removeItem(key);
      return null;
    }
    return value.config as T;
  } catch {
    storage.removeItem(key);
    return null;
  }
}

export function writeLastBatchAction<T>(storage: StorageLike, kind: BatchActionKind, config: T, now = Date.now()): void {
  storage.setItem(batchActionStorageKey(kind), JSON.stringify({
    version: BATCH_ACTION_STORAGE_VERSION,
    updatedAt: now,
    config,
  }));
}
