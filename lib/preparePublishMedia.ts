import type { Post } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { enqueueFetch } from "@/lib/cloudflareQueue";
import { mediaUrlAvailable } from "@/lib/cloudinary";
import { readDownloadSnapshot } from "@/lib/fetchDownloadSnapshot";

/** No source download inside a publish invocation, and no Meta quota yet. */
export async function preparePublishMedia(post: Post, publishToPage?: boolean): Promise<boolean> {
  const needsVideo = ["video", "reel"].includes(post.mediaType ?? "")
    && ((post.publishToFacebook && !post.fbPostId) || (post.publishToInstagram && !post.igPostId));
  if (!needsVideo) return true;
  if (post.fetchLeaseUntil && post.fetchLeaseUntil.getTime() > Date.now()) return false;
  if (post.stableMediaUrl && await mediaUrlAvailable(post.stableMediaUrl)) return true;
  const snapshot = readDownloadSnapshot(post.fetchDownloadSnapshot, post.sourceUrl);
  if (snapshot?.purpose === "publish" && !snapshot.prepared) {
    await enqueueFetch(post.id);
    return false;
  }
  const saved = await prisma.post.updateMany({ where: { id: post.id, status: { in: ["pending", "queued", "partial", "failed"] },
    fetchLeaseUntil: null }, data: {
      status: "queued", errorMsg: "Đang chuẩn bị lại video qua Fetch Queue trước khi đăng…",
      fetchDownloadSnapshot: { version: 1, purpose: "publish", prepared: false, sourceUrl: post.sourceUrl,
        ...(publishToPage === undefined ? {} : { publishToPage }) },
      fetchNextAttemptAt: null, fetchAttempt: 0, fetchProvider: null,
  } });
  if (saved.count) await enqueueFetch(post.id);
  return false;
}
