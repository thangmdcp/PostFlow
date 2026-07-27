import { prisma } from "@/lib/prisma";
import { fetchPostFieldsWithRetry } from "@/lib/postProcessing";

/** Process one source link. Called only by the dedicated Cloudflare Fetch Queue. */
export async function processFetchPost(postId: string): Promise<void> {
  // Claim the job before making any external request. Both the Queue and the
  // local fallback may deliver a job when a network response is lost; only one
  // must be allowed to fetch and write this post.
  const claim = await prisma.post.updateMany({
    where: {
      id: postId,
      OR: [
        { status: "queued" },
        { status: "fetching", errorMsg: null },
        { status: "fetching", errorMsg: "Đang khôi phục job…" },
      ],
    },
    data: { status: "fetching", errorMsg: "Đang lấy nội dung và video…" },
  });
  if (claim.count === 0) return;

  const post = await prisma.post.findUnique({ where: { id: postId }, select: { id: true, sourceUrl: true } });
  if (!post) return;
  try {
    const fields = await fetchPostFieldsWithRetry(post.sourceUrl);
    await prisma.post.update({
      where: { id: post.id },
      data: {
        title: fields.title, rawCaption: fields.rawCaption, finalCaption: null, stableMediaUrl: fields.stableMediaUrl,
        thumbnailUrl: fields.thumbnailUrl, mediaUrls: fields.mediaUrls, mediaType: fields.mediaType,
        cloudinaryId: fields.cloudinaryId, status: "ready", errorMsg: null,
        // A retry replaces both source fields and the old link mapping. This
        // prevents duplicate/stale affiliate inputs from an earlier attempt.
        extractedLinks: {
          deleteMany: {},
          create: fields.links.map((url, index) => ({ order: index + 1, competitorUrl: url })),
        },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await prisma.post.update({ where: { id: post.id }, data: { status: "failed", errorMsg: message } });
  }
}
