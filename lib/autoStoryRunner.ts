import { prisma } from "@/lib/prisma";
import { publishStoryToPage } from "@/lib/facebook";
import { enqueueStory } from "@/lib/cloudflareQueue";

// Story delivery is delayed and retried by Cloudflare Queue. Supabase keeps
// status/history only; no Vercel timer or cron sweep owns this work.
const RETRY_DELAY_MS = 5 * 60_000;
const MAX_ATTEMPTS = 3;
const ONE_HOUR_MS = 60 * 60_000;
const ACTIVE_WINDOW_MS = 24 * 60 * 60_000; // FB stories expire 24h after posting

// Maintains a rolling target of `storyCount` always-live stories per page.
// Called both right after a post finishes publishing (organic — pass its
// own id as preferPostId so fresh content is used first if a slot is open)
// and at batch-fetch time for every connected page (pure backfill, no
// preferPostId). "Active" counts stories posted within the last 24h plus
// any still in-flight, so this never over-schedules regardless of which
// trigger fires it or how many times.
export async function topUpPageStories(pageId: string, storyCount: number, preferPostId?: string): Promise<void> {
  if (!storyCount || storyCount <= 0) return;
  const now = new Date();
  const windowStart = new Date(now.getTime() - ACTIVE_WINDOW_MS);

  const activeCount = await prisma.post.count({
    where: {
      pageId,
      OR: [
        { storyStatus: "done", storyPostedAt: { gte: windowStart } },
        { storyStatus: { in: ["pending", "creating"] } },
      ],
    },
  });
  const needed = storyCount - activeCount;
  if (needed <= 0) return;

  // Candidates: already-published posts on this page that have never
  // carried a story job (storyStatus null). A post used once keeps a
  // non-null storyStatus forever, so it's naturally excluded from re-pick,
  // even after its story has expired.
  let candidates = await prisma.post.findMany({
    where: { pageId, status: "done", fbMediaId: { not: null }, storyStatus: null },
    select: { id: true },
  });

  const chosen: string[] = [];
  if (preferPostId && candidates.some((c) => c.id === preferPostId)) {
    chosen.push(preferPostId);
    candidates = candidates.filter((c) => c.id !== preferPostId);
  }
  while (chosen.length < needed && candidates.length > 0) {
    const idx = Math.floor(Math.random() * candidates.length);
    chosen.push(candidates.splice(idx, 1)[0].id);
  }
  if (chosen.length === 0) return; // nothing left in the archive to backfill from

  // Every slot in this pass — including the first — is spaced 1h apart.
  await Promise.all(chosen.map(async (postId, i) => {
    const delaySeconds = (i + 1) * 60 * 60;
    await prisma.post.update({
      where: { id: postId },
      data: { storyStatus: "pending", storyNextAttemptAt: new Date(now.getTime() + (i + 1) * ONE_HOUR_MS), storyAttempt: 0 },
    });
    if (!await enqueueStory(postId, delaySeconds)) throw new Error("Không thể đưa Story vào Cloudflare Queue");
  }));
}

export async function attemptStory(postId: string): Promise<{ retry: boolean }> {
  const existing = await prisma.post.findUnique({ where: { id: postId } });
  if (!existing || existing.storyStatus === "done" || existing.storyStatus === "failed") return { retry: false };
  const attemptNumber = (existing.storyAttempt ?? 0) + 1;
  // Bump the attempt counter BEFORE calling Facebook — same crash-loop
  // safety pattern as attemptAutoAds/attemptComment.
  const post = await prisma.post.update({
    where: { id: postId },
    data: { storyStatus: "creating", storyAttempt: attemptNumber },
  }).catch(() => null);
  if (!post) return { retry: true };

  try {
    if (!post.pageId) throw new Error("Bài chưa có pageId");
    if (!post.fbMediaId) throw new Error("Bài không có media để đăng story");
    const fbConn = await prisma.fbConnection.findUnique({ where: { pageId: post.pageId } });
    if (!fbConn) throw new Error(`Không tìm thấy kết nối FB cho page ${post.pageId}`);

    const result = await publishStoryToPage(post.pageId, fbConn.accessToken, post.fbMediaId, post.mediaType);
    await prisma.post.update({
      where: { id: postId },
      data: { storyStatus: "done", storyPostId: result.postId, storyNextAttemptAt: null, errorMsg: null, storyPostedAt: new Date() },
    });
    console.log(`[auto-story] post ${postId}: story ${result.postId} posted (attempt ${attemptNumber})`);
    return { retry: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "auto-story failed";
    console.error(`[auto-story] post ${postId} attempt ${attemptNumber} failed:`, msg);

    if (attemptNumber < MAX_ATTEMPTS) {
      await prisma.post.update({
        where: { id: postId },
        data: { storyStatus: "pending", storyNextAttemptAt: new Date(Date.now() + RETRY_DELAY_MS), errorMsg: `[story] ${msg}` },
      }).catch(() => {});
      return { retry: true };
    } else {
      await prisma.post.update({
        where: { id: postId },
        data: { storyStatus: "failed", storyNextAttemptAt: null, errorMsg: `[story] ${msg}` },
      }).catch(() => {});
      return { retry: false };
    }
  }
}
