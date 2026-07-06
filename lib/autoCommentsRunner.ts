import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/prisma";
import { postComment } from "@/lib/facebook";

// Each comment on a post posts 2 minutes after the previous one (or after
// publish, for the first) — comment 1 at +2m, comment 2 at +4m, etc. — see
// the per-index stagger in scheduleCommentJobs. Retries after a failed
// attempt reuse the same 2-minute spacing, capped at 3 total attempts so a
// broken comment can't retry forever.
const COMMENT_INTERVAL_MS = 120_000;
const RETRY_DELAYS_MS = [COMMENT_INTERVAL_MS, COMMENT_INTERVAL_MS];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1; // +1 for the first attempt

export interface CommentJob {
  text: string;
  imageUrl?: string;
}

// Replace any queued (not-yet-started) comment rows for this post with a
// fresh set — called at schedule/publish-request time, before the post's
// fbPostId is necessarily known yet. Idempotent: safe to call again if the
// user re-schedules/re-publishes before anything has actually run.
export async function persistCommentJobs(postId: string, jobs: CommentJob[]): Promise<void> {
  await prisma.postComment.deleteMany({ where: { postId, status: null } });
  if (jobs.length === 0) return;
  await prisma.postComment.createMany({
    data: jobs.map((j) => ({ postId, text: j.text, imageUrl: j.imageUrl ?? null })),
  });
}

// Call this once fbPostId is known (right after a post publishes). AWAIT it —
// it only persists each row's initial "pending" state (fast DB writes); the
// actual wait + attempt happens in the background via waitUntil per row.
export async function scheduleCommentJobs(postId: string, fbPostId: string, accessToken: string): Promise<void> {
  const queued = await prisma.postComment.findMany({ where: { postId, status: null }, orderBy: { createdAt: "asc" } });
  if (queued.length === 0) return;

  // Comment N fires N * 2 minutes after publish (1st at +2m, 2nd at +4m, ...)
  // — not all at once — hence the per-index delay instead of a shared one.
  await Promise.all(queued.map((row, index) => {
    const delay = (index + 1) * COMMENT_INTERVAL_MS;
    return prisma.postComment.update({
      where: { id: row.id },
      data: { status: "pending", nextAttemptAt: new Date(Date.now() + delay), attempt: 0 },
    });
  }));

  queued.forEach((row, index) => {
    const delay = (index + 1) * COMMENT_INTERVAL_MS;
    waitUntil(
      new Promise<void>((resolve) => setTimeout(resolve, delay)).then(() =>
        attemptComment(row.id, fbPostId, accessToken, 0)
      )
    );
  });
}

// Exported so the cron route can also call it directly (for retries beyond
// the first attempt) without going through scheduleCommentJobs' waitUntil.
export async function attemptComment(commentRowId: string, fbPostId: string, accessToken: string, attemptIndex: number): Promise<void> {
  const attemptNumber = attemptIndex + 1;
  // Record the attempt count BEFORE calling out to Facebook, not just on
  // completion — if the serverless invocation dies mid-call (timeout, cold
  // start crash), the row is left stuck on "creating" with the OLD attempt
  // count, and processDueCommentRetries would otherwise retry it forever
  // since it never sees the count go up. Bumping it up-front means a stuck
  // row hits MAX_ATTEMPTS and gets marked failed instead of looping.
  const row = await prisma.postComment.update({
    where: { id: commentRowId },
    data: { status: "creating", attempt: attemptNumber },
  }).catch(() => null);
  if (!row) return;

  try {
    const result = await postComment(fbPostId, accessToken, row.text, row.imageUrl ?? undefined);
    await prisma.postComment.update({
      where: { id: commentRowId },
      data: { status: "done", commentId: result.id, attempt: attemptNumber, nextAttemptAt: null, errorMsg: null },
    });
    console.log(`[auto-comment] post ${row.postId}: comment ${result.id} posted (attempt ${attemptNumber})`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "auto-comment failed";
    console.error(`[auto-comment] comment row ${commentRowId} attempt ${attemptNumber} failed:`, msg);

    if (attemptIndex + 1 < MAX_ATTEMPTS) {
      const delay = RETRY_DELAYS_MS[attemptIndex + 1];
      const nextAttemptAt = new Date(Date.now() + delay);
      await prisma.postComment.update({
        where: { id: commentRowId },
        data: { status: "pending", nextAttemptAt, attempt: attemptNumber, errorMsg: `[comment] ${msg}` },
      }).catch(() => {});
    } else {
      await prisma.postComment.update({
        where: { id: commentRowId },
        data: { status: "failed", attempt: attemptNumber, nextAttemptAt: null, errorMsg: `[comment] ${msg}` },
      }).catch(() => {});
    }
  }
}

// Called from the cron tick for comment rows whose nextAttemptAt has passed,
// or whose "creating" status has been stuck for a while (invocation died
// mid-attempt) — mirrors processDueAdRetries.
export async function processDueCommentRetries(): Promise<void> {
  const now = new Date();
  const stuckSince = new Date(now.getTime() - 3 * 60_000);
  const due = await prisma.postComment.findMany({
    where: {
      OR: [
        { status: "pending", nextAttemptAt: { lte: now } },
        { status: "creating", updatedAt: { lte: stuckSince } },
      ],
    },
    include: { post: true },
  });

  for (const row of due) {
    // These would otherwise sit "pending" forever with no visible error —
    // mark them failed instead so a missing page/connection is diagnosable.
    if (!row.post.pageId || !row.post.fbPostId) {
      await prisma.postComment.update({
        where: { id: row.id },
        data: { status: "failed", nextAttemptAt: null, errorMsg: "[comment] Bài chưa có pageId/fbPostId" },
      }).catch(() => {});
      continue;
    }
    const fbConn = await prisma.fbConnection.findUnique({ where: { pageId: row.post.pageId } });
    if (!fbConn) {
      await prisma.postComment.update({
        where: { id: row.id },
        data: { status: "failed", nextAttemptAt: null, errorMsg: `[comment] Không tìm thấy kết nối FB cho page ${row.post.pageId}` },
      }).catch(() => {});
      continue;
    }

    // A "creating" row stuck long enough to be picked up here already used
    // up its recorded attempt (see the up-front bump in attemptComment) — if
    // that already hit the cap, stop instead of retrying an unbounded
    // number of times.
    if ((row.attempt ?? 0) >= MAX_ATTEMPTS) {
      await prisma.postComment.update({
        where: { id: row.id },
        data: { status: "failed", nextAttemptAt: null, errorMsg: "[comment] Vượt quá số lần thử lại cho phép" },
      }).catch(() => {});
      continue;
    }

    await attemptComment(row.id, row.post.fbPostId, fbConn.accessToken, row.attempt ?? 0);
  }
}
