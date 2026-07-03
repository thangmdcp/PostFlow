import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export async function uploadFromUrl(
  mediaUrl: string
): Promise<{ publicId: string; secureUrl: string; resourceType: string }> {
  // Try direct URL upload first (works for most CDNs)
  try {
    const result = await cloudinary.uploader.upload(mediaUrl, {
      resource_type: "auto",
      folder: "postflow",
    });
    return { publicId: result.public_id, secureUrl: result.secure_url, resourceType: result.resource_type };
  } catch {
    // fbcdn blocks Cloudinary's fetcher — download via server then stream upload
  }

  const response = await fetch(mediaUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; PostFlow/1.0)" },
  });
  if (!response.ok) throw new Error(`Không tải được media: ${response.status}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") ?? "video/mp4";
  const resourceType = contentType.startsWith("video") ? "video" : "image";

  const result = await new Promise<{ public_id: string; secure_url: string; resource_type: string }>(
    (resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { resource_type: resourceType as "video" | "image" | "auto", folder: "postflow" },
        (err, res) => {
          if (err || !res) return reject(err ?? new Error("Upload thất bại"));
          resolve(res as { public_id: string; secure_url: string; resource_type: string });
        }
      );
      stream.end(buffer);
    }
  );

  return { publicId: result.public_id, secureUrl: result.secure_url, resourceType: result.resource_type };
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

export async function deleteFile(publicId: string, resourceType = "image") {
  await cloudinary.uploader.destroy(publicId, {
    resource_type: resourceType as "image" | "video" | "raw",
  });
}
