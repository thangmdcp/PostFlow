import { prisma } from "@/lib/prisma";
import {
  isMetaRateLimit,
  metaErrorCategory,
  metaErrorFromBody,
  parseMetaUsageHeaders,
  type MetaErrorPayload,
  type MetaRequestContext,
  type MetaUsageSnapshot,
} from "@/lib/metaUsage";

export class MetaApiError extends Error {
  readonly status: number;
  readonly code?: number;
  readonly subcode?: number;
  readonly isTransient: boolean;
  readonly fbtraceId?: string;
  readonly category: ReturnType<typeof metaErrorCategory>;
  readonly retryAfterSeconds?: number;

  constructor(status: number, payload: MetaErrorPayload, retryAfterSeconds?: number) {
    const detail = payload.error_user_msg || payload.message || "Meta API request failed";
    const tags = [
      payload.code != null ? `code=${payload.code}` : "",
      payload.error_subcode != null ? `subcode=${payload.error_subcode}` : "",
      payload.fbtrace_id ? `fbtrace_id=${payload.fbtrace_id}` : "",
    ].filter(Boolean).join(" ");
    super(tags ? `${detail} [Meta ${tags}]` : detail);
    this.name = "MetaApiError";
    this.status = status;
    this.code = payload.code;
    this.subcode = payload.error_subcode;
    this.isTransient = Boolean(payload.is_transient);
    this.fbtraceId = payload.fbtrace_id;
    this.category = metaErrorCategory(status, payload);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function retryAfter(headers: Headers, snapshots: MetaUsageSnapshot[]): number | undefined {
  const explicit = Number(headers.get("retry-after"));
  if (Number.isFinite(explicit) && explicit > 0) return Math.ceil(explicit);
  const estimated = Math.max(0, ...snapshots.map((item) => item.estimatedRecoverySeconds ?? 0));
  return estimated || undefined;
}

async function recordUsage(
  snapshots: MetaUsageSnapshot[],
  error: MetaErrorPayload | null,
  status: number,
  retryAfterSeconds?: number,
) {
  if (!snapshots.length && !error) return;
  const now = new Date();
  const blockedUntil = isMetaRateLimit(status, error)
    ? new Date(now.getTime() + Math.max(60, retryAfterSeconds ?? 300) * 1000)
    : null;
  const rows = snapshots.length ? snapshots : [{
    scopeKey: "app:current", scopeType: "app" as const, scopeId: "current",
    callCount: 0, totalCpuTime: 0, totalTime: 0,
  }];
  await Promise.all(rows.map((snapshot) => prisma.metaThrottleState.upsert({
    where: { scopeKey: snapshot.scopeKey },
    create: {
      scopeKey: snapshot.scopeKey,
      scopeType: snapshot.scopeType,
      scopeId: snapshot.scopeId,
      callCount: snapshot.callCount,
      totalCpuTime: snapshot.totalCpuTime,
      totalTime: snapshot.totalTime,
      accessTier: snapshot.accessTier,
      estimatedRecoveryAt: snapshot.estimatedRecoverySeconds ? new Date(now.getTime() + snapshot.estimatedRecoverySeconds * 1000) : null,
      blockedUntil,
      lastErrorCode: error?.code,
      lastErrorSubcode: error?.error_subcode,
      lastFbtraceId: error?.fbtrace_id,
      lastErrorMessage: error?.message,
    },
    update: {
      callCount: snapshot.callCount,
      totalCpuTime: snapshot.totalCpuTime,
      totalTime: snapshot.totalTime,
      ...(snapshot.accessTier ? { accessTier: snapshot.accessTier } : {}),
      ...(snapshot.estimatedRecoverySeconds ? { estimatedRecoveryAt: new Date(now.getTime() + snapshot.estimatedRecoverySeconds * 1000) } : {}),
      ...(blockedUntil ? { blockedUntil } : {}),
      ...(error ? {
        lastErrorCode: error.code,
        lastErrorSubcode: error.error_subcode,
        lastFbtraceId: error.fbtrace_id,
        lastErrorMessage: error.message,
      } : {}),
    },
  }))).catch((recordError) => console.error("[meta-usage] could not persist usage", recordError));
}

export async function metaRequestJson<T = Record<string, unknown>>(
  url: string,
  init: RequestInit = {},
  context: MetaRequestContext = {},
  options: { allowError?: boolean } = {},
): Promise<{ data: T; response: Response; usage: MetaUsageSnapshot[] }> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({})) as T;
  const usage = parseMetaUsageHeaders(response.headers, context);
  const error = metaErrorFromBody(data);
  const waitSeconds = retryAfter(response.headers, usage);
  await recordUsage(usage, error, response.status, waitSeconds);
  if (!options.allowError && (!response.ok || error)) {
    throw new MetaApiError(response.status, error ?? { message: `Meta HTTP ${response.status}`, is_transient: response.status >= 500 }, waitSeconds);
  }
  return { data, response, usage };
}
