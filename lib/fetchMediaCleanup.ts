import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { deleteFile } from "@/lib/cloudinary";
import { fetchMediaCanBeCleaned, readFetchMediaManifest } from "@/lib/fetchMediaManifest";

export async function cleanupFetchedPhotos(postId: string): Promise<void> {
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post || !fetchMediaCanBeCleaned(post)) return;
  const assets = readFetchMediaManifest(post.fetchMediaManifest);
  const igAssets = Array.isArray(post.igMediaManifest) ? post.igMediaManifest.filter((value): value is Prisma.JsonObject =>
    !!value && typeof value === "object" && !Array.isArray(value) && typeof value.publicId === "string" && typeof value.url === "string") : [];
  const candidates = [...assets.map(asset => ({ ...asset, kind: "image" })),
    ...(post.cloudinaryId ? [{ publicId: post.cloudinaryId, url: post.stableMediaUrl ?? "", kind: ["video", "reel"].includes(post.mediaType ?? "") ? "video" : "image" }] : []),
    ...igAssets.map(asset => ({ publicId: asset.publicId as string, url: asset.url as string, kind: String(asset.resourceType) }))];
  const removed = new Set<string>();
  for (const asset of candidates) {
    if (removed.has(asset.publicId)) continue;
    // Legacy Render URLs may point at a different cloud. Never delete there
    // by guessing a public ID, and never call Render cleanup again.
    if (!asset.url.startsWith(`https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/`)) continue;
    const references = await prisma.post.findMany({ where: { id: { not: postId }, OR: [
      { cloudinaryId: asset.publicId },
      { fetchMediaManifest: { array_contains: [{ publicId: asset.publicId }] } },
      { igMediaManifest: { array_contains: [{ publicId: asset.publicId }] } },
    ] } });
    if (references.some(reference => !fetchMediaCanBeCleaned(reference))) continue;
    await deleteFile(asset.publicId, asset.kind);
    removed.add(asset.publicId);
  }
  const remaining = assets.filter(asset => !removed.has(asset.publicId));
  const remainingIg = igAssets.filter(asset => !removed.has(String(asset.publicId)));
  await prisma.post.update({ where: { id: postId }, data: {
    fetchMediaManifest: remaining.length ? remaining as unknown as Prisma.InputJsonValue : Prisma.DbNull,
    igMediaManifest: remainingIg.length ? remainingIg : Prisma.DbNull,
    fetchDownloadSnapshot: Prisma.DbNull,
    ...(post.cloudinaryId && removed.has(post.cloudinaryId) ? { cloudinaryId: null, stableMediaUrl: null } : {}),
  } });
}
