import { prisma } from "@/lib/prisma";
import { publishStoryToPage } from "@/lib/facebook";
import { vnDayRange } from "@/lib/vnDate";

// Unlike ads (1st attempt via waitUntil ~1 min out) and comments (~2 min
// out), the Story delay is ~15 minutes — well past the publish route's 90s
// maxDuration, so there is NO in-process first attempt here at all. Every
// attempt, including the first, is picked up by the cron sweep
// (processDueStoryRetries) once storyNextAttemptAt has passed.
const INITIAL_DELAY_MS = 15 * 60_000;
const RETRY_DELAY_MS = 5 * 60_000;
const MAX_ATTEMPTS = 3;

// Call right after a post finishes publishing (status already "done").
// Decides whether this post is among the first `storyCount` posts to
// successfully publish TODAY on this page, and if so persists the pending
// story job — purely a DB write, no Facebook call happens here.
export async function maybeScheduleStory(postId: string, pageId: string, fbMediaId: string | null | undefined, storyEnabled?: boolean | null, storyCount?: number | null): Promise<void> {
  if (!storyEnabled || !storyCount || storyCount <= 0 || !fbMediaId) return;

  const { start, end } = vnDayRange();
  // The post being checked has already been marked "done" by the caller, so
  // this count already includes it — the count IS this post's 1-based rank
  // for (page, day).
  const doneTodayCount = await prisma.post.count({
    where: { pageId, status: "done", updatedAt: { gte: start, lt: end } },
  });
  if (doneTodayCount > storyCount) return;

  await prisma.post.update({
    where: { id: postId },
    data: { storyStatus: "pending", storyNextAttemptAt: new Date(Date.now() + INITIAL_DELAY_MS), storyAttempt: 0 },
  });
}

export async function attemptStory(postId: string, attemptIndex: number): Promise<void> {
  const attemptNumber = attemptIndex + 1;
  // Bump the attempt counter BEFORE calling Facebook — same crash-loop
  // safety pattern as attemptAutoAds/attemptComment.
  const post = await prisma.post.update({
    where: { id: postId },
    data: { storyStatus: "creating", storyAttempt: attemptNumber },
  }).catch(() => null);
  if (!post) return;

  try {
    if (!post.pageId) throw new Error("Bài chưa có pageId");
    if (!post.fbMediaId) throw new Error("Bài không có media để đăng story");
    const fbConn = await prisma.fbConnection.findUnique({ where: { pageId: post.pageId } });
    if (!fbConn) throw new Error(`Không tìm thấy kết nối FB cho page ${post.pageId}`);

    const result = await publishStoryToPage(post.pageId, fbConn.accessToken, post.fbMediaId, post.mediaType);
    await prisma.post.update({
      where: { id: postId },
      data: { storyStatus: "done", storyPostId: result.postId, storyNextAttemptAt: null, errorMsg: null },
    });
    console.log(`[auto-story] post ${postId}: story ${result.postId} posted (attempt ${attemptNumber})`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "auto-story failed";
    console.error(`[auto-story] post ${postId} attempt ${attemptNumber} failed:`, msg);

    if (attemptIndex + 1 < MAX_ATTEMPTS) {
      await prisma.post.update({
        where: { id: postId },
        data: { storyStatus: "pending", storyNextAttemptAt: new Date(Date.now() + RETRY_DELAY_MS), errorMsg: `[story] ${msg}` },
      }).catch(() => {});
    } else {
      await prisma.post.update({
        where: { id: postId },
        data: { storyStatus: "failed", storyNextAttemptAt: null, errorMsg: `[story] ${msg}` },
      }).catch(() => {});
    }
  }
}

// Called from the cron tick — same shape as processDueAdRetries/
// processDueCommentRetries: due "pending" rows, or "creating" rows stuck
// long enough that the invocation which set them must have died.
export async function processDueStoryRetries(): Promise<void> {
  const now = new Date();
  const stuckSince = new Date(now.getTime() - 3 * 60_000);
  const due = await prisma.post.findMany({
    where: {
      OR: [
        { storyStatus: "pending", storyNextAttemptAt: { lte: now } },
        { storyStatus: "creating", updatedAt: { lte: stuckSince } },
      ],
    },
  });

  for (const post of due) {
    if ((post.storyAttempt ?? 0) >= MAX_ATTEMPTS) {
      await prisma.post.update({
        where: { id: post.id },
        data: { storyStatus: "failed", storyNextAttemptAt: null, errorMsg: "[story] Vượt quá số lần thử lại cho phép" },
      }).catch(() => {});
      continue;
    }
    await attemptStory(post.id, post.storyAttempt ?? 0);
  }
}
