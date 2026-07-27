import { prisma } from "@/lib/prisma";
import { getFacebookComments, postComment } from "@/lib/facebook";
import { enqueueComment } from "@/lib/cloudflareQueue";

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

function normalizeComment(value: string) {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase("vi");
}

// Replace any queued (not-yet-started) comment rows for this post with a
// fresh set — called at schedule/publish-request time, before the post's
// fbPostId is necessarily known yet. Idempotent: safe to call again if the
// user re-schedules/re-publishes before anything has actually run.
export async function persistCommentJobs(postId: string, jobs: CommentJob[]): Promise<void> {
  await prisma.postComment.deleteMany({ where: { postId, status: null } });
  if (jobs.length === 0) return;
  // jobs.length is the TOTAL target count, not "how many more to add" — if
  // settings get re-applied (e.g. Dashboard's "Cài đặt" -> Áp dụng) on a post
  // whose comments already fired/are in flight, only top up the remainder
  // instead of piling more on top of what's already committed.
  const alreadyCommitted = await prisma.postComment.count({
    where: { postId, status: { in: ["pending", "creating", "done"] } },
  });
  const toCreate = Math.max(0, jobs.length - alreadyCommitted);
  if (toCreate === 0) return;
  await prisma.postComment.createMany({
    data: jobs.slice(0, toCreate).map((j) => ({ postId, text: j.text, imageUrl: j.imageUrl ?? null })),
  });
}

// Call this once fbPostId is known. Cloudflare Queue owns both the delayed
// delivery and retry; Supabase only records durable state for the UI/audit.
export async function scheduleCommentJobs(postId: string): Promise<void> {
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

  await Promise.all(queued.map(async (row, index) => {
    const delay = (index + 1) * COMMENT_INTERVAL_MS;
    if (!await enqueueComment(row.id, Math.ceil(delay / 1000))) {
      throw new Error("Không thể đưa comment vào Cloudflare Queue");
    }
  }));
}

// Called only by the Queue consumer endpoint. A non-OK response makes the
// Worker retry this same message after its configured delay.
export async function attemptComment(commentRowId: string): Promise<{ retry: boolean }> {
  // Record the attempt count BEFORE calling out to Facebook, not just on
  // completion — if the serverless invocation dies mid-call (timeout, cold
  // start crash), the row is left stuck on "creating" with the OLD attempt
  // count, and processDueCommentRetries would otherwise retry it forever
  // since it never sees the count go up. Bumping it up-front means a stuck
  // row hits MAX_ATTEMPTS and gets marked failed instead of looping.
  const existing = await prisma.postComment.findUnique({ where: { id: commentRowId }, include: { post: true } });
  if (!existing || existing.status === "done" || existing.status === "failed") return { retry: false };
  const attemptNumber = (existing.attempt ?? 0) + 1;
  const row = await prisma.postComment.update({ where: { id: commentRowId }, data: { status: "creating", attempt: attemptNumber } }).catch(() => null);
  if (!row) return { retry: true };

  try {
    if (!existing.post.fbPostId || !existing.post.pageId) throw new Error("Bài chưa có fbPostId/pageId");
    const fbConn = await prisma.fbConnection.findUnique({ where: { pageId: existing.post.pageId } });
    if (!fbConn) throw new Error("Không tìm thấy kết nối Facebook Page");

    // Facebook may have accepted the previous request while the worker timed
    // out, so never blindly resend. Count Page-owned comments against the
    // target, and also match this row's text to avoid a duplicate retry.
    const [facebookComments, targetCount] = await Promise.all([
      getFacebookComments(existing.post.fbPostId, fbConn.accessToken),
      prisma.postComment.count({ where: { postId: existing.postId } }),
    ]);
    const pageComments = facebookComments.filter((comment) => comment.from?.id === existing.post.pageId);
    const identicalCommentExists = pageComments.some((comment) => normalizeComment(comment.message ?? "") === normalizeComment(row.text));
    if (identicalCommentExists || pageComments.length >= targetCount) {
      const reason = identicalCommentExists
        ? "[comment] Đã có bình luận cùng nội dung từ Page trên Facebook."
        : `[comment] Page đã có ${pageComments.length}/${targetCount} bình luận, không đăng trùng.`;
      await prisma.postComment.update({
        where: { id: commentRowId },
        data: { status: "skipped", attempt: attemptNumber, nextAttemptAt: null, errorMsg: reason },
      });
      console.log(`[auto-comment] post ${row.postId}: skipped duplicate/existing Page comment`);
      return { retry: false };
    }

    const result = await postComment(existing.post.fbPostId, fbConn.accessToken, row.text, row.imageUrl ?? undefined);
    await prisma.postComment.update({
      where: { id: commentRowId },
      data: { status: "done", commentId: result.id, attempt: attemptNumber, nextAttemptAt: null, errorMsg: null },
    });
    console.log(`[auto-comment] post ${row.postId}: comment ${result.id} posted (attempt ${attemptNumber})`);
    return { retry: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "auto-comment failed";
    console.error(`[auto-comment] comment row ${commentRowId} attempt ${attemptNumber} failed:`, msg);

    if (attemptNumber < MAX_ATTEMPTS) {
      const nextAttemptAt = new Date(Date.now() + COMMENT_INTERVAL_MS);
      await prisma.postComment.update({
        where: { id: commentRowId },
        data: { status: "pending", nextAttemptAt, attempt: attemptNumber, errorMsg: `[comment] ${msg}` },
      }).catch(() => {});
      return { retry: true };
    } else {
      await prisma.postComment.update({
        where: { id: commentRowId },
        data: { status: "failed", attempt: attemptNumber, nextAttemptAt: null, errorMsg: `[comment] ${msg}` },
      }).catch(() => {});
      return { retry: false };
    }
  }
}
