import { v2 as cloudinary } from "cloudinary";
import { instagramUpscaleWidth } from "@/lib/mediaDimensions";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { SourceFetchError } from "@/lib/sourceFetchError";
import { assertFetchProviderAvailable, recordFetchProviderFailure, recordFetchProviderSuccess } from "@/lib/fetchProviderCircuit";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export async function uploadFromUrl(
  mediaUrl: string,
  options: { forceJpeg?: boolean; ensureInstagramAdWidth?: boolean; folder?: string; publicId?: string } = {}
): Promise<{ publicId: string; secureUrl: string; resourceType: string; width?: number; height?: number }> {
  type UploadResult = {
    public_id: string;
    secure_url: string;
    resource_type: string;
    width?: number;
    height?: number;
  };

  let result: UploadResult | null = null;
  if (options.publicId) {
    try {
      result = await cloudinary.api.resource(`${options.folder ?? "postflow"}/${options.publicId}`, { resource_type: "image" }) as UploadResult;
    } catch (error) {
      if ((error as { error?: { http_code?: number } }).error?.http_code !== 404 && (error as { http_code?: number }).http_code !== 404) throw error;
    }
  }
  // Try direct URL upload first (works for most CDNs)
  try {
    if (!result) {
      result = await cloudinary.uploader.upload(mediaUrl, {
        resource_type: options.forceJpeg ? "image" : "auto",
        folder: options.folder ?? "postflow",
        ...(options.forceJpeg ? { format: "jpg" } : {}),
        ...(options.publicId ? { public_id: options.publicId, overwrite: false } : {}),
      });
    }
  } catch {
    // fbcdn blocks Cloudinary's fetcher — download via server then stream upload
  }

  if (!result) {
    const response = await fetch(mediaUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PostFlow/1.0)" },
    });
    if (!response.ok) throw new Error(`Không tải được media: ${response.status}`);

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") ?? "video/mp4";
    const resourceType = contentType.startsWith("video") ? "video" : "image";

    result = await new Promise<UploadResult>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { resource_type: resourceType as "video" | "image" | "auto", folder: options.folder ?? "postflow", ...(options.forceJpeg ? { format: "jpg" } : {}), ...(options.publicId ? { public_id: options.publicId, overwrite: false } : {}) },
        (err, res) => {
          if (err || !res) return reject(err ?? new Error("Upload thất bại"));
          resolve(res as UploadResult);
        }
      );
      stream.end(buffer);
    });
  }

  let secureUrl = result.secure_url;
  let width = result.width;
  let height = result.height;

  if (options.ensureInstagramAdWidth) {
    if (!width) throw new Error("Cloudinary không trả về chiều rộng media để kiểm tra chuẩn Instagram Ads");
    const targetWidth = instagramUpscaleWidth(width);
    if (targetWidth) {
      // Generate the derived asset synchronously. Instagram must receive a
      // public URL whose transformed bytes are already ready to download;
      // handing it a lazy transformation URL can race Cloudinary processing.
      const transformed = await cloudinary.uploader.explicit(result.public_id, {
        resource_type: result.resource_type as "image" | "video",
        type: "upload",
        eager: [{ width: targetWidth, crop: "scale" }],
        eager_async: false,
      });
      const eager = Array.isArray(transformed.eager) ? transformed.eager[0] : undefined;
      if (!eager?.secure_url) throw new Error("Cloudinary không tạo được bản media 720px cho Instagram Ads");
      secureUrl = eager.secure_url;
      width = Number(eager.width) || targetWidth;
      height = Number(eager.height) || (height ? Math.round(height * targetWidth / result.width!) : undefined);
    }
  }

  return {
    publicId: result.public_id,
    secureUrl,
    resourceType: result.resource_type,
    width,
    height,
  };
}

export async function uploadBuffer(
  buffer: Buffer,
  folder = "postflow/branding"
): Promise<{ publicId: string; secureUrl: string }> {
  const result = await new Promise<{ public_id: string; secure_url: string }>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: "image", folder },
      (err, res) => {
        if (err || !res) return reject(err ?? new Error("Upload thất bại"));
        resolve(res as { public_id: string; secure_url: string });
      }
    );
    stream.end(buffer);
  });
  return { publicId: result.public_id, secureUrl: result.secure_url };
}

export async function deleteFile(publicId: string, resourceType = "image", invalidate = false) {
  const result = await cloudinary.uploader.destroy(publicId, {
    resource_type: resourceType as "image" | "video" | "raw",
    invalidate,
  });
  if (result.result !== "ok" && result.result !== "not found") throw new Error("Cloudinary chưa xác nhận xóa media.");
}

export function cloudinaryFetchError(cause: unknown): SourceFetchError {
  if (cause instanceof SourceFetchError) return cause;
  const error = cause as { http_code?: number; error?: { http_code?: number }; message?: string };
  const status = error?.http_code ?? error?.error?.http_code ?? 502;
  const denied = [401, 403].includes(status) || /disabled|locked|under review|not allowed|invalid api|unknown api/i.test(error?.message ?? "");
  return new SourceFetchError({ provider: "cloudinary", code: denied ? "CLOUDINARY_ACCESS_DENIED" : "CLOUDINARY_FAILED",
    message: denied ? "Cloudinary đang từ chối truy cập. Kiểm tra khóa hoặc trạng thái tài khoản; không tải lại nguồn."
      : "Không lưu/đọc được media Cloudinary; giữ bản tải tạm để thử upload lại.",
    httpStatus: status, retryable: !denied, retryAfterSeconds: 60 });
}

/** A 404 alone means missing media. Never treat an account lock as expiration. */
export async function mediaUrlAvailable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(15_000), cache: "no-store" });
    if (response.ok) return true;
    if (response.status === 404 || response.status === 410) return false;
    throw { http_code: response.status };
  } catch (cause) { throw cloudinaryFetchError(cause); }
}

/** Deterministic asset ID + streaming, bounded video upload (no 100MiB buffer). */
export async function uploadFetchedVideo(mediaUrl: string, postId: string): Promise<{ publicId: string; secureUrl: string }> {
  await assertFetchProviderAvailable("cloudinary");
  const publicId = `postflow-fetch/video-${postId}`;
  type Result = { public_id: string; secure_url: string; resource_type: string };
  try {
    let result: Result | undefined;
    try { result = await cloudinary.api.resource(publicId, { resource_type: "video" }) as Result; }
    catch (cause) {
      const err = cause as { http_code?: number; error?: { http_code?: number } };
      if ((err.http_code ?? err.error?.http_code) !== 404) throw cause;
    }
    if (!result) {
      const response = await fetch(mediaUrl, { signal: AbortSignal.timeout(180_000), redirect: "error" });
      if (!response.ok || !response.body) throw new SourceFetchError({ provider: "cloudinary", code: "DOWNLOAD_URL_UNAVAILABLE",
        message: "Không đọc được URL tải tạm để upload Cloudinary.", retryable: true, httpStatus: response.status });
      const maxBytes = 100 * 1024 * 1024;
      if (Number(response.headers.get("content-length")) > maxBytes) throw new SourceFetchError({ provider: "cloudinary", code: "MEDIA_TOO_LARGE",
        message: "Video vượt giới hạn upload 100 MiB.", retryable: false });
      let bytes = 0;
      const bound = new Transform({ transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        callback(bytes > maxBytes ? new SourceFetchError({ provider: "cloudinary", code: "MEDIA_TOO_LARGE", message: "Video vượt giới hạn upload 100 MiB.", retryable: false }) : null, chunk);
      } });
      result = await new Promise<Result>((resolve, reject) => {
        const upload = cloudinary.uploader.upload_stream({ resource_type: "video", public_id: publicId, overwrite: false, timeout: 180_000 },
          (error, value) => error || !value ? reject(error ?? new Error("Upload failed")) : resolve(value as Result));
        pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), bound, upload).catch(reject);
      });
    }
    if (result.resource_type !== "video" || !await mediaUrlAvailable(result.secure_url)) throw new Error("Uploaded video is not readable");
    await recordFetchProviderSuccess("cloudinary");
    return { publicId: result.public_id, secureUrl: result.secure_url };
  } catch (cause) {
    const error = cloudinaryFetchError(cause);
    await recordFetchProviderFailure(error);
    throw error;
  }
}
