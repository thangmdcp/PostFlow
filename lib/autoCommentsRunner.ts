import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/prisma";
import { postComment } from "@/lib/facebook";

// Same retry shape as lib/autoAdsRunner.ts, but comments don't need the long
// FB-indexing wait video ads do — 30s, then +2m if still failing.
const RETRY_DELAYS_MS = [30_000, 120_000];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length;

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
  const queued = await prisma.postComment.findMany({ where: { postId, status: null } });
  if (queued.length === 0) return;

  const nextAttemptAt = new Date(Date.now() + RETRY_DELAYS_MS[0]);
  await prisma.postComment.updateMany({
    where: { id: { in: queued.map((c) => c.id) } },
    data: { status: "pending", nextAttemptAt, attempt: 0 },
  });

  for (const row of queued) {
    waitUntil(
      new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[0])).then(() =>
        attemptComment(row.id, fbPostId, accessToken, 0)
      )
    );
  }
}

// Exported so the cron route can also call it directly (for retries beyond
// the first attempt) without going through scheduleCommentJobs' waitUntil.
export async function attemptComment(commentRowId: string, fbPostId: string, accessToken: string, attemptIndex: number): Promise<void> {
  const attemptNumber = attemptIndex + 1;
  const row = await prisma.postComment.update({
    where: { id: commentRowId },
    data: { status: "creating" },
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

    await attemptComment(row.id, row.post.fbPostId, fbConn.accessToken, row.attempt ?? 0);
  }
}
