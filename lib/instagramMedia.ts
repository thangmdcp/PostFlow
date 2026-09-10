import { Prisma, type Post } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { deleteFile, uploadFromUrl } from "@/lib/cloudinary";

export interface PreparedInstagramMedia {
  url: string;
  publicId: string;
  resourceType: string;
}

function readManifest(value: unknown): PreparedInstagramMedia[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is PreparedInstagramMedia => {
    if (!item || typeof item !== "object") return false;
    const row = item as Record<string, unknown>;
    return typeof row.url === "string" && typeof row.publicId === "string" && typeof row.resourceType === "string";
  });
}

export function instagramSourceUrls(post: Post): string[] {
  if (post.mediaType === "carousel") {
    try {
      const urls = JSON.parse(post.mediaUrls ?? "[]");
      return Array.isArray(urls) ? urls.filter((url): url is string => typeof url === "string" && Boolean(url)) : [];
    } catch {
      return [];
    }
  }
  return post.stableMediaUrl ? [post.stableMediaUrl] : [];
}

export async function prepareInstagramMedia(post: Post): Promise<PreparedInstagramMedia[]> {
  const existing = readManifest(post.igMediaManifest);
  if (existing.length) return existing;

  const sources = instagramSourceUrls(post);
  if (!sources.length) throw new Error("Instagram yêu cầu bài có ảnh hoặc video");
  if (post.mediaType === "carousel" && sources.length > 10) throw new Error("Instagram chỉ hỗ trợ tối đa 10 ảnh trong carousel");

  const prepared: PreparedInstagramMedia[] = [];
  for (const source of sources) {
    const uploaded = await uploadFromUrl(source, { forceJpeg: post.mediaType !== "video" });
    prepared.push({ url: uploaded.secureUrl, publicId: uploaded.publicId, resourceType: uploaded.resourceType });
    await prisma.post.update({ where: { id: post.id }, data: { igMediaManifest: prepared as unknown as Prisma.InputJsonValue } });
  }
  return prepared;
}

export async function cleanupInstagramMedia(postId: string, manifest: unknown): Promise<void> {
  const assets = readManifest(manifest);
  for (const asset of assets) await deleteFile(asset.publicId, asset.resourceType);
  if (assets.length) await prisma.post.update({ where: { id: postId }, data: { igMediaManifest: Prisma.DbNull } });
}
