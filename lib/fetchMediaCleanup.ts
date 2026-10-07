import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { autodownCleanup } from "@/lib/autodown";
import { deleteFile } from "@/lib/cloudinary";
import { fetchMediaCanBeCleaned, readFetchMediaManifest } from "@/lib/fetchMediaManifest";

export async function cleanupFetchedPhotos(postId: string): Promise<void> {
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post || !fetchMediaCanBeCleaned(post)) return;
  const assets = readFetchMediaManifest(post.fetchMediaManifest);
  if (!assets.length) return;
  const auto = assets.filter((asset) => asset.provider === "autodown");
  // AutoDown assets may be shared by cached fetches. Preserve while any other
  // post references them; once all consumers finish, the last one cleans up.
  for (const asset of assets) {
    const references = await prisma.post.count({ where: {
      id: { not: postId }, fetchMediaManifest: { array_contains: [{ publicId: asset.publicId }] },
    } });
    if (references) continue;
    if (auto.includes(asset)) await autodownCleanup([asset.publicId]);
    else await deleteFile(asset.publicId, "image");
  }
  await prisma.post.update({ where: { id: postId }, data: { fetchMediaManifest: Prisma.DbNull } });
}
