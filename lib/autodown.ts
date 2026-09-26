import { prisma } from "@/lib/prisma";
import { assertFetchProviderAvailable, recordFetchProviderFailure, recordFetchProviderSuccess } from "@/lib/fetchProviderCircuit";
import { parseRetryAfter, SourceFetchError } from "@/lib/sourceFetchError";

const BASE_URL = (process.env.AUTODOWN_BASE_URL ?? "https://autodown.vibevic.com").replace(/\/$/, "");

// Key can be set via the web UI (stored in AppConfig, works on Vercel without
// a redeploy) or fall back to the env var for local/manual setups.
async function getApiKeys(): Promise<string[]> {
  const keys: string[] = [];
  try {
    const row = await prisma.appConfig.findUnique({ where: { key: "autodownApiKey" } });
    if (row?.value) keys.push(row.value);
  } catch { /* DB not reachable — fall back to env */ }
  if (process.env.AUTODOWN_API_KEY) keys.push(process.env.AUTODOWN_API_KEY);
  return [...new Set(keys)];
}

function headers(apiKey: string) {
  return {
    "Content-Type": "application/json",
    "X-API-Key": apiKey,
  };
}

export interface AutoDownExtractResult {
  success: boolean;
  platform: string;
  type: string;
  caption: string;
  thumbnail: string;
  mediaCount: number;
}

export interface AutoDownMedia {
  type: string;
  url: string;
  public_id: string;
}

export interface AutoDownDownloadResult {
  success: boolean;
  caption: string;
  type: string;
  thumbnail?: string;
  media: AutoDownMedia[];
  cached?: boolean;
}

interface AutoDownErrorBody {
  code?: string;
  error?: string;
  retryable?: boolean;
  retryAfterSeconds?: number;
}

// Metadata only — no download, no Cloudinary side effect. Used to cheaply
// detect whether a URL is an AutoDown-eligible public video before committing
// to a download.
export async function autodownExtract(url: string): Promise<AutoDownExtractResult | null> {
  try {
    for (const apiKey of await getApiKeys()) {
      const res = await fetch(`${BASE_URL}/api/extract`, {
        method: "POST",
        headers: headers(apiKey),
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(25_000),
      });
      // A stale key saved from the UI must not disable a valid deploy-time
      // key. Try the next configured key only for authentication failures.
      if (res.status === 401 || res.status === 403) continue;
      if (!res.ok) return null;
      const data = await res.json();
      if (!data?.success) return null;
      return data as AutoDownExtractResult;
    }
    return null;
  } catch {
    return null;
  }
}

// Downloads + uploads to AutoDown's Cloudinary in one call. Can take up to
// ~60s per the API guide.
export async function autodownDownload(url: string): Promise<AutoDownDownloadResult | null> {
  await assertFetchProviderAvailable("autodown");
  const keys = await getApiKeys();
  if (!keys.length) {
    throw new SourceFetchError({
      provider: "autodown", code: "AUTODOWN_NOT_CONFIGURED",
      message: "AutoDown chưa được cấu hình API key.", retryable: false,
    });
  }
  let authenticationFailed = false;
  for (const apiKey of keys) {
    try {
      const res = await fetch(`${BASE_URL}/api/download`, {
        method: "POST",
        headers: headers(apiKey),
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(90_000),
      });
      const data = await res.json().catch(() => ({})) as AutoDownDownloadResult & AutoDownErrorBody;
      if (res.status === 401 || res.status === 403) {
        authenticationFailed = true;
        continue;
      }
      if (!res.ok || !data?.success) {
        const error = new SourceFetchError({
          provider: "autodown",
          code: data.code || `AUTODOWN_HTTP_${res.status}`,
          message: data.error || `AutoDown trả HTTP ${res.status}.`,
          httpStatus: res.status,
          retryable: data.retryable ?? res.status >= 500,
          retryAfterSeconds: data.retryAfterSeconds ?? parseRetryAfter(res.headers.get("retry-after")),
        });
        await recordFetchProviderFailure(error);
        throw error;
      }
      await recordFetchProviderSuccess("autodown");
      return data;
    } catch (cause) {
      if (cause instanceof SourceFetchError) throw cause;
      const timeout = cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError");
      const error = new SourceFetchError({
        provider: "autodown",
        code: timeout ? "UPSTREAM_TIMEOUT" : "AUTODOWN_NETWORK_ERROR",
        message: timeout ? "AutoDown phản hồi quá thời gian cho phép." : "Không kết nối được AutoDown.",
        httpStatus: timeout ? 504 : 503,
        retryable: true,
        retryAfterSeconds: 30,
      });
      await recordFetchProviderFailure(error);
      throw error;
    }
  }
  if (authenticationFailed) {
    throw new SourceFetchError({
      provider: "autodown", code: "AUTH_FAILED",
      message: "AutoDown từ chối API key đã cấu hình.", httpStatus: 401, retryable: false,
    });
  }
  return null;
}

// Deletes AutoDown-side Cloudinary assets by public_id. Fire-and-forget is
// fine — a failed cleanup just leaves a temp/ asset for AutoDown's own
// housekeeping, it doesn't affect our app state.
export async function autodownCleanup(publicIds: string[]): Promise<void> {
  if (publicIds.length === 0) return;
  try {
    for (const apiKey of await getApiKeys()) {
      const res = await fetch(`${BASE_URL}/api/cleanup`, {
        method: "POST",
        headers: headers(apiKey),
        body: JSON.stringify({ public_ids: publicIds }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status !== 401 && res.status !== 403) break;
    }
  } catch { /* best-effort */ }
}

// AutoDown's own Cloudinary public_ids are always prefixed "temp/" — use that
// as the tag to route cleanup/refresh logic away from our own Cloudinary account.
export function isAutoDownAsset(publicId: string | null | undefined): publicId is string {
  return !!publicId && publicId.startsWith("temp/");
}
