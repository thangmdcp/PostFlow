import { v2 as cloudinary } from "cloudinary";
import { instagramUpscaleWidth } from "@/lib/mediaDimensions";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export async function uploadFromUrl(
  mediaUrl: string,
  options: { forceJpeg?: boolean; ensureInstagramAdWidth?: boolean; folder?: string } = {}
): Promise<{ publicId: string; secureUrl: string; resourceType: string; width?: number; height?: number }> {
  type UploadResult = {
    public_id: string;
    secure_url: string;
    resource_type: string;
    width?: number;
    height?: number;
  };

  let result: UploadResult | null = null;
  // Try direct URL upload first (works for most CDNs)
  try {
    result = await cloudinary.uploader.upload(mediaUrl, {
      resource_type: options.forceJpeg ? "image" : "auto",
      folder: options.folder ?? "postflow",
      ...(options.forceJpeg ? { format: "jpg" } : {}),
    });
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
        { resource_type: resourceType as "video" | "image" | "auto", folder: options.folder ?? "postflow", ...(options.forceJpeg ? { format: "jpg" } : {}) },
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
  await cloudinary.uploader.destroy(publicId, {
    resource_type: resourceType as "image" | "video" | "raw",
    invalidate,
  });
}
