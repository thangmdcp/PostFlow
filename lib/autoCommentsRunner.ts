import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/prisma";
import { postComment } from "@/lib/facebook";

// Same retry shape as lib/autoAdsRunner.ts, but comments don't need the long
// FB-indexing wait video ads do — 30s, then +2m if still failing.
const RETRY_DELAYS_MS = [30_000, 120_000];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length;

export interface AutoCommentParams {
  postId: string;
  fbPostId: string;
  accessToken: string;
  text: string;
  imageUrl?: string;
}

// Call this right after a post publishes successfully (or from the schedule
// PATCH's cron pickup). AWAIT it — it only persists the initial "pending"
// state (a single fast DB write); the actual wait + attempt happens in the
// background via waitUntil, which this does NOT block on.
export async function scheduleAutoComments(params: AutoCommentParams): Promise<void> {
  if (!params.text.trim() || !params.fbPostId) {
    await prisma.post.update({
      where: { id: params.postId },
      data: { commentStatus: "skipped" },
    }).catch(() => {});
    return;
  }

  // Idempotency guard — never comment twice on the same post.
  const existing = await prisma.post.findUnique({ where: { id: params.postId }, select: { commentStatus: true } });
  if (existing?.commentStatus === "done") return;

  const nextAttemptAt = new Date(Date.now() + RETRY_DELAYS_MS[0]);
  await prisma.post.update({
    where: { id: params.postId },
    data: { commentText: params.text, commentImageUrl: params.imageUrl ?? null, commentStatus: "pending", commentNextAttemptAt: nextAttemptAt, commentAttempt: 0 },
  }).catch(() => {});

  waitUntil(
    new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[0])).then(() =>
      attemptAutoComment(params, 0)
    )
  );
}

// Exported so the cron route can also call it directly (for retries beyond
// the first attempt) without going through scheduleAutoComments' waitUntil.
export async function attemptAutoComment(params: AutoCommentParams, attemptIndex: number): Promise<void> {
  const attemptNumber = attemptIndex + 1;
  await prisma.post.update({
    where: { id: params.postId },
    data: { commentStatus: "creating" },
  }).catch(() => {});

  try {
    const result = await postComment(params.fbPostId, params.accessToken, params.text, params.imageUrl);
    await prisma.post.update({
      where: { id: params.postId },
      data: { commentStatus: "done", commentId: result.id, commentAttempt: attemptNumber, commentNextAttemptAt: null, errorMsg: null },
    });
    console.log(`[auto-comment] post ${params.postId}: comment ${result.id} posted (attempt ${attemptNumber})`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "auto-comment failed";
    console.error(`[auto-comment] post ${params.postId} attempt ${attemptNumber} failed:`, msg);

    if (attemptIndex + 1 < MAX_ATTEMPTS) {
      const delay = RETRY_DELAYS_MS[attemptIndex + 1];
      const nextAttemptAt = new Date(Date.now() + delay);
      await prisma.post.update({
        where: { id: params.postId },
        data: { commentStatus: "pending", commentNextAttemptAt: nextAttemptAt, commentAttempt: attemptNumber, errorMsg: `[comment] ${msg}` },
      }).catch(() => {});
    } else {
      await prisma.post.update({
        where: { id: params.postId },
        data: { commentStatus: "failed", commentAttempt: attemptNumber, commentNextAttemptAt: null, errorMsg: `[comment] ${msg}` },
      }).catch(() => {});
    }
  }
}

// Called from the cron tick for posts whose commentNextAttemptAt has passed,
// or whose "creating" status has been stuck for a while (invocation died
// mid-attempt) — mirrors processDueAdRetries.
export async function processDueCommentRetries(): Promise<void> {
  const now = new Date();
  const stuckSince = new Date(now.getTime() - 3 * 60_000);
  const due = await prisma.post.findMany({
    where: {
      OR: [
        { commentStatus: "pending", commentNextAttemptAt: { lte: now } },
        { commentStatus: "creating", updatedAt: { lte: stuckSince } },
      ],
    },
  });

  for (const post of due) {
    if (!post.pageId || !post.fbPostId || !post.commentText) continue;
    const fbConn = await prisma.fbConnection.findUnique({ where: { pageId: post.pageId } });
    if (!fbConn) continue;

    await attemptAutoComment(
      { postId: post.id, fbPostId: post.fbPostId, accessToken: fbConn.accessToken, text: post.commentText, imageUrl: post.commentImageUrl ?? undefined },
      post.commentAttempt ?? 0
    );
  }
}
