// Backend-only adaptation of Flully's supplied Node client. DNS override only:
// hostname, TLS SNI and certificate verification always remain flully.com.
import https from "node:https";
import { isIP } from "node:net";
import { prisma } from "@/lib/prisma";
import { assertFetchProviderAvailable, recordFetchProviderFailure, recordFetchProviderSuccess } from "@/lib/fetchProviderCircuit";
import { SourceFetchError } from "@/lib/sourceFetchError";
import { withFlullyDownloadLease } from "@/lib/flullyDownloadLease";

export interface AutoDownDownloadResult {
  success: true;
  caption: string;
  type: "video";
  media: { type: "video"; url: string; thumbnail?: string | null }[];
  expiresAt: string;
}

export function flullyError(code: string, status: number, retryAfterSeconds?: number): SourceFetchError {
  const messages: Record<string, string> = {
    UNAUTHORIZED: "Flully từ chối API key. Kiểm tra khóa Flully trong Cài đặt.",
    FLULLY_NOT_CONFIGURED: "Chưa cấu hình API key Flully.",
    INVALID_ORIGIN: "Origin Flully phải là địa chỉ IP hợp lệ.",
    MEDIA_BUSY: "Flully đang xử lý video khác.",
    MEDIA_CAPACITY_EXCEEDED: "Kho tạm Flully đã hết dung lượng.",
    MEDIA_TOO_LARGE: "Video vượt giới hạn 100 MiB của Flully.",
    LOGIN_REQUIRED: "Nguồn yêu cầu đăng nhập.",
    PRIVATE_OR_REMOVED: "Bài nguồn riêng tư hoặc đã bị xóa.",
    PRIVATE_SOURCE_DENIED: "Flully không hỗ trợ nguồn riêng tư.",
    NO_VIDEO_SOURCE: "Nguồn không phải video; chuyển nguồn ảnh dự phòng.",
    INVALID_MEDIA: "Flully không tìm thấy video hợp lệ.",
    FACEBOOK_PARSE_FAILED: "Flully chưa đọc được bài Facebook.",
    UPSTREAM_TIMEOUT: "Flully phản hồi quá thời gian cho phép.",
  };
  return new SourceFetchError({ provider: "flully", code, httpStatus: status,
    message: messages[code] ?? `Flully không xử lý được yêu cầu (${code}).`,
    retryable: !["UNAUTHORIZED", "INVALID_ORIGIN", "INVALID_JSON", "INVALID_REQUEST", "INVALID_SOURCE", "PRIVATE_SOURCE_DENIED", "MEDIA_TOO_LARGE"].includes(code)
      && (status === 429 || status >= 500), retryAfterSeconds,
  });
}

export async function flullyRequest(operation: "extract" | "download", url: string): Promise<unknown> {
  const rows = await prisma.appConfig.findMany({ where: { key: { in: ["flullyAutoDownApiKey", "flullyAutoDownOriginIp"] } } });
  const config = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  const key = config.flullyAutoDownApiKey || process.env.AUTODOWN_PUBLIC_API_KEY;
  const originIp = config.flullyAutoDownOriginIp || process.env.AUTODOWN_ORIGIN_IP;
  if (!key) throw flullyError("FLULLY_NOT_CONFIGURED", 400);
  if (originIp && !isIP(originIp)) throw flullyError("INVALID_ORIGIN", 400);
  const target = new URL(`https://flully.com/api/autodown/v1/${operation}`);
  const body = JSON.stringify({ url });
  const result = await new Promise<{ status: number; text: string; retryAfter?: number }>((resolve, reject) => {
    const req = https.request(target, {
      method: "POST", headers: { "X-API-Key": key, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(280_000),
      ...(originIp ? { lookup: ((hostname, options, callback) => {
        if (hostname !== "flully.com") return callback(new Error("Unexpected API hostname"), "", 4);
        const address = { address: originIp, family: isIP(originIp) };
        if (typeof options === "object" && options.all) callback(null, [address] as never, 4);
        else callback(null, address.address, address.family);
      }) as import("node:net").LookupFunction } : {}),
    }, (response) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 16 * 1024 * 1024) { response.destroy(new Error("API response too large")); return; }
        chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => resolve({ status: response.statusCode || 502, text: Buffer.concat(chunks).toString("utf8"),
        retryAfter: Number(response.headers["retry-after"]) || undefined }));
    });
    req.on("error", reject);
    req.end(body);
  }).catch((cause: unknown) => {
    // Never persist native HTTP errors: they can contain capability URLs.
    throw flullyError(cause instanceof Error && cause.name === "AbortError" ? "UPSTREAM_TIMEOUT" : "API_UNAVAILABLE", 503, 30);
  });
  let data: Record<string, unknown>;
  try { data = JSON.parse(result.text); } catch {
    throw flullyError(result.status === 401 || result.status === 403 ? "UNAUTHORIZED" : "API_UNAVAILABLE",
      result.status === 401 || result.status === 403 ? result.status : 502, 30);
  }
  if (!data || result.status < 200 || result.status >= 300 || data.success !== true) {
    throw flullyError(result.status === 401 || result.status === 403 ? "UNAUTHORIZED"
      : typeof data?.code === "string" && /^[A-Z_0-9]+$/.test(data.code) ? data.code : "API_UNAVAILABLE",
      result.status >= 400 ? result.status : 502, result.retryAfter);
  }
  return data;
}

export function normalizeFlullyDownload(value: unknown): AutoDownDownloadResult {
  const data = value as AutoDownDownloadResult;
  const validUrl = (url: unknown) => typeof url === "string" && /^https:\/\/flully\.com\/_media-tmp\//.test(url);
  if (data?.success !== true || data.type !== "video" || !Array.isArray(data.media) || data.media.length !== 1
    || !data.media.every((item) => item.type === "video" && validUrl(item.url) && (!item.thumbnail || validUrl(item.thumbnail)))
    || !Number.isFinite(Date.parse(data.expiresAt)) || Date.parse(data.expiresAt) <= Date.now()) {
    throw flullyError("INVALID_RESPONSE", 502, 30);
  }
  return { success: true, caption: typeof data.caption === "string" ? data.caption : "", type: "video",
    media: data.media.map((item) => ({ type: "video", url: item.url, thumbnail: item.thumbnail ?? null })), expiresAt: data.expiresAt };
}

export async function autodownDownload(url: string): Promise<AutoDownDownloadResult> {
  await assertFetchProviderAvailable("flully");
  try {
    const data = await withFlullyDownloadLease(async () => normalizeFlullyDownload(await flullyRequest("download", url)));
    await recordFetchProviderSuccess("flully");
    return data;
  } catch (cause) {
    const error = cause instanceof SourceFetchError ? cause : flullyError("API_UNAVAILABLE", 503, 30);
    await recordFetchProviderFailure(error);
    throw error;
  }
}

export async function autodownExtract(url: string): Promise<unknown> {
  return flullyRequest("extract", url);
}
