export const BATCH_DRAFT_VERSION = 2 as const;
export const BATCH_DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const COMPOSER_DRAFT_KEY = "postflow_batch_compose_draft_v1";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface BatchDraft {
  version: typeof BATCH_DRAFT_VERSION;
  updatedAt: number;
  selectedPageIds?: string[];
  scheduleMode?: "manual" | "interval" | "daily";
  baseTime?: string;
  manualApplyTime?: string;
  stepMinutes?: string;
  postsPerDay?: string;
  endTime?: string;
  postTimes?: Record<string, string>;
  checkedIds?: string[];
  rowOverrides?: Record<string, boolean>;
  rowAdParams?: Record<string, unknown>;
  rowPageId?: Record<string, string>;
  rowAccountId?: Record<string, string>;
  rowRunAds?: Record<string, boolean>;
  rowPublishTargets?: Record<string, unknown>;
  defaultPublishTargets?: string[];
  bulkAccountId?: string;
  randomFields?: string[];
  pageFilterIds?: string[];
  tkqcFilterIds?: string[];
  detailTab?: "ads" | "engagement";
  activeDetailPresetId?: string | null;
  commentCustomEntryEnabled?: Record<string, boolean>;
  adLaunchAt?: string;
  prepareSpacing?: string;
}

type ReadOptions = {
  now?: number;
  validPostIds?: Iterable<string>;
  validPageIds?: Iterable<string>;
};

export function batchDraftKey(batchId: string): string {
  return `postflow_batch_draft_v2_${batchId}`;
}

export function legacyBatchDraftKey(batchId: string): string {
  return `pf_batch_draft_${batchId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function pruneRecord<T>(value: unknown, validIds?: Set<string>): Record<string, T> | undefined {
  if (!isRecord(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value).filter(([id]) => !validIds || validIds.has(id))
  ) as Record<string, T>;
}

function stringArray(value: unknown, validIds?: Set<string>): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string" && (!validIds || validIds.has(item)));
}

function stringRecord(value: unknown, validIds?: Set<string>, validValues?: Set<string>): Record<string, string> | undefined {
  const record = pruneRecord<unknown>(value, validIds);
  if (!record) return undefined;
  return Object.fromEntries(Object.entries(record).filter(([, item]) => typeof item === "string" && (!validValues || validValues.has(item)))) as Record<string, string>;
}

function booleanRecord(value: unknown, validIds?: Set<string>): Record<string, boolean> | undefined {
  const record = pruneRecord<unknown>(value, validIds);
  if (!record) return undefined;
  return Object.fromEntries(Object.entries(record).filter(([, item]) => typeof item === "boolean")) as Record<string, boolean>;
}

function publishTargetsRecord(value: unknown, validIds?: Set<string>): Record<string, string[]> | undefined {
  const record = pruneRecord<unknown>(value, validIds);
  if (!record) return undefined;
  return Object.fromEntries(Object.entries(record).flatMap(([id, targets]) => {
    const safe = stringArray(targets)?.filter((target) => target === "facebook" || target === "instagram");
    return safe?.length ? [[id, safe]] : [];
  }));
}

export function parseBatchDraft(raw: string | null, options: ReadOptions = {}): BatchDraft | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value) || value.version !== BATCH_DRAFT_VERSION || typeof value.updatedAt !== "number") return null;
    const now = options.now ?? Date.now();
    if (now - value.updatedAt > BATCH_DRAFT_TTL_MS) return null;

    const postIds = options.validPostIds ? new Set(options.validPostIds) : undefined;
    const pageIds = options.validPageIds ? new Set(options.validPageIds) : undefined;
    const draft = value as unknown as BatchDraft;
    const scheduleMode = draft.scheduleMode === "manual" || draft.scheduleMode === "interval" || draft.scheduleMode === "daily" ? draft.scheduleMode : undefined;
    const detailTab = draft.detailTab === "ads" || draft.detailTab === "engagement" ? draft.detailTab : undefined;
    return {
      ...draft,
      scheduleMode,
      detailTab,
      selectedPageIds: stringArray(draft.selectedPageIds, pageIds),
      checkedIds: stringArray(draft.checkedIds, postIds),
      pageFilterIds: stringArray(draft.pageFilterIds, pageIds),
      tkqcFilterIds: stringArray(draft.tkqcFilterIds),
      randomFields: stringArray(draft.randomFields),
      defaultPublishTargets: stringArray(draft.defaultPublishTargets)?.filter((target) => target === "facebook" || target === "instagram"),
      postTimes: stringRecord(draft.postTimes, postIds),
      rowOverrides: booleanRecord(draft.rowOverrides, postIds),
      rowAdParams: pruneRecord<unknown>(draft.rowAdParams, postIds),
      rowPageId: stringRecord(draft.rowPageId, postIds, pageIds),
      rowAccountId: stringRecord(draft.rowAccountId, postIds),
      rowRunAds: booleanRecord(draft.rowRunAds, postIds),
      rowPublishTargets: publishTargetsRecord(draft.rowPublishTargets, postIds),
      commentCustomEntryEnabled: booleanRecord(draft.commentCustomEntryEnabled),
    };
  } catch {
    return null;
  }
}

export function readBatchDraft(storage: StorageLike, batchId: string, options: ReadOptions = {}): BatchDraft | null {
  const key = batchDraftKey(batchId);
  const raw = storage.getItem(key);
  const draft = parseBatchDraft(raw, options);
  if (raw && !draft) storage.removeItem(key);
  return draft;
}

export function writeBatchDraft(storage: StorageLike, batchId: string, draft: Omit<BatchDraft, "version" | "updatedAt">, now = Date.now()): BatchDraft {
  const value: BatchDraft = { ...draft, version: BATCH_DRAFT_VERSION, updatedAt: now };
  storage.setItem(batchDraftKey(batchId), JSON.stringify(value));
  return value;
}

export function migrateLegacyBatchDraft(
  localStorage: StorageLike,
  sessionStorage: StorageLike,
  batchId: string,
  options: ReadOptions = {}
): BatchDraft | null {
  const current = readBatchDraft(localStorage, batchId, options);
  if (current) return current;
  const legacyKey = legacyBatchDraftKey(batchId);
  const raw = sessionStorage.getItem(legacyKey);
  if (!raw) return null;
  try {
    const legacy = JSON.parse(raw) as Record<string, unknown>;
    const migrated = writeBatchDraft(localStorage, batchId, {
      rowAdParams: isRecord(legacy.rowAdParams) ? legacy.rowAdParams : {},
      rowPageId: isRecord(legacy.rowPageId) ? legacy.rowPageId as Record<string, string> : {},
      rowAccountId: isRecord(legacy.rowAccountId) ? legacy.rowAccountId as Record<string, string> : {},
      rowRunAds: isRecord(legacy.rowRunAds) ? legacy.rowRunAds as Record<string, boolean> : {},
      rowPublishTargets: isRecord(legacy.rowPublishTargets) ? legacy.rowPublishTargets : {},
    }, options.now);
    sessionStorage.removeItem(legacyKey);
    return parseBatchDraft(JSON.stringify(migrated), options);
  } catch {
    sessionStorage.removeItem(legacyKey);
    return null;
  }
}

export function readComposerDraft(storage: StorageLike, now = Date.now()): string {
  const raw = storage.getItem(COMPOSER_DRAFT_KEY);
  if (!raw) return "";
  try {
    const value = JSON.parse(raw) as { version?: number; updatedAt?: number; urlText?: unknown };
    if (value.version !== 1 || typeof value.updatedAt !== "number" || now - value.updatedAt > BATCH_DRAFT_TTL_MS || typeof value.urlText !== "string") {
      storage.removeItem(COMPOSER_DRAFT_KEY);
      return "";
    }
    return value.urlText;
  } catch {
    storage.removeItem(COMPOSER_DRAFT_KEY);
    return "";
  }
}

export function writeComposerDraft(storage: StorageLike, urlText: string, now = Date.now()): void {
  if (!urlText) {
    storage.removeItem(COMPOSER_DRAFT_KEY);
    return;
  }
  storage.setItem(COMPOSER_DRAFT_KEY, JSON.stringify({ version: 1, updatedAt: now, urlText }));
}

export function linkDraftKey(linkId: string): string {
  return `postflow_affiliate_link_draft_v1_${linkId}`;
}

export function readLinkDraft(storage: StorageLike, linkId: string, serverValue: string, now = Date.now()): string | null {
  const key = linkDraftKey(linkId);
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { version?: number; updatedAt?: number; value?: unknown; serverValue?: unknown };
    if (value.version !== 1 || typeof value.updatedAt !== "number" || now - value.updatedAt > BATCH_DRAFT_TTL_MS || typeof value.value !== "string" || value.serverValue !== serverValue) {
      storage.removeItem(key);
      return null;
    }
    return value.value;
  } catch {
    storage.removeItem(key);
    return null;
  }
}

export function writeLinkDraft(storage: StorageLike, linkId: string, value: string, serverValue: string, now = Date.now()): void {
  const key = linkDraftKey(linkId);
  if (value === serverValue) {
    storage.removeItem(key);
    return;
  }
  storage.setItem(key, JSON.stringify({ version: 1, updatedAt: now, value, serverValue }));
}
