export const META_RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80001, 80002, 80004]);

export interface MetaErrorPayload {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  is_transient?: boolean;
  fbtrace_id?: string;
  error_user_title?: string;
  error_user_msg?: string;
}

export interface MetaUsageSnapshot {
  scopeKey: string;
  scopeType: "app" | "page" | "instagram" | "ad_account" | "business_use_case";
  scopeId: string;
  callCount: number;
  totalCpuTime: number;
  totalTime: number;
  accessTier?: string;
  estimatedRecoverySeconds?: number;
}

export interface MetaRequestContext {
  pageId?: string;
  instagramUserId?: string;
  adAccountId?: string;
}

function safeJson(value: string | null): unknown {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function basicSnapshot(
  scopeType: MetaUsageSnapshot["scopeType"],
  scopeId: string,
  value: unknown,
): MetaUsageSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  return {
    scopeKey: `${scopeType}:${scopeId}`,
    scopeType,
    scopeId,
    callCount: number(row.call_count ?? row.acc_id_util_pct),
    totalCpuTime: number(row.total_cputime),
    totalTime: number(row.total_time),
    ...(typeof row.ads_api_access_tier === "string" ? { accessTier: row.ads_api_access_tier } : {}),
    ...(row.estimated_time_to_regain_access != null
      ? { estimatedRecoverySeconds: number(row.estimated_time_to_regain_access) * 60 }
      : row.reset_time_duration != null
        ? { estimatedRecoverySeconds: number(row.reset_time_duration) }
        : {}),
  };
}

export function parseMetaUsageHeaders(headers: Headers, context: MetaRequestContext = {}): MetaUsageSnapshot[] {
  const snapshots: MetaUsageSnapshot[] = [];
  const app = basicSnapshot("app", "current", safeJson(headers.get("x-app-usage")));
  if (app) snapshots.push(app);

  if (context.pageId) {
    const page = basicSnapshot("page", context.pageId, safeJson(headers.get("x-page-usage")));
    if (page) snapshots.push(page);
  }
  if (context.instagramUserId) {
    const instagram = basicSnapshot("instagram", context.instagramUserId, safeJson(headers.get("x-page-usage")));
    if (instagram) snapshots.push(instagram);
  }
  if (context.adAccountId) {
    const ad = basicSnapshot("ad_account", context.adAccountId.replace(/^act_/, ""), safeJson(headers.get("x-ad-account-usage")));
    if (ad) snapshots.push(ad);
  }

  const business = safeJson(headers.get("x-business-use-case-usage"));
  if (business && typeof business === "object" && !Array.isArray(business)) {
    for (const [businessId, entries] of Object.entries(business as Record<string, unknown>)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (!entry || typeof entry !== "object") continue;
        const type = String((entry as Record<string, unknown>).type ?? "unknown");
        const snapshot = basicSnapshot("business_use_case", `${businessId}:${type}`, entry);
        if (snapshot) snapshots.push({ ...snapshot, scopeKey: `business_use_case:${businessId}:${type}` });
      }
    }
  }
  return snapshots;
}

export function metaErrorFromBody(body: unknown): MetaErrorPayload | null {
  if (!body || typeof body !== "object") return null;
  const error = (body as Record<string, unknown>).error;
  return error && typeof error === "object" ? error as MetaErrorPayload : null;
}

export function isMetaRateLimit(status: number, error: MetaErrorPayload | null): boolean {
  return status === 429 || Boolean(error?.code && META_RATE_LIMIT_CODES.has(error.code));
}

export function metaErrorCategory(status: number, error: MetaErrorPayload | null):
  "rate_limit" | "permission" | "token" | "transient" | "media" | "configuration" | "unknown" {
  if (isMetaRateLimit(status, error)) return "rate_limit";
  if (error?.code === 190) return "token";
  const message = `${error?.message ?? ""} ${error?.error_user_msg ?? ""}`.toLowerCase();
  if (error?.code === 10 || error?.code === 200 || /permission|not authorized|does not have access|promote.*page/.test(message)) return "permission";
  if (error?.is_transient || status >= 500) return "transient";
  if (/media|image|video|reel|copyright|music|cannot be advertised|not eligible/.test(message)) return "media";
  if (status >= 400 && status < 500) return "configuration";
  return "unknown";
}

export function usageLevel(snapshot: Pick<MetaUsageSnapshot, "callCount" | "totalCpuTime" | "totalTime">): number {
  return Math.max(snapshot.callCount, snapshot.totalCpuTime, snapshot.totalTime);
}
