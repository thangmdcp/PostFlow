import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enqueuePublish } from "@/lib/cloudflareQueue";
import { recoverFetchJobs } from "@/lib/fetchRecovery";

// Covers: publishing whatever posts are due, the ~1 min first-attempt ads
// wait (via scheduleAutoAds' waitUntil) for however many just published, and
// processDueAdRetries for posts whose 2nd/3rd attempt has come due.
export const maxDuration = 90;

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const querySecret = new URL(req.url).searchParams.get("secret")?.trim();
  const envSecret = process.env.CRON_SECRET?.trim();
  const isAuthorized =
    !!envSecret && (authHeader === `Bearer ${envSecret}` || querySecret === envSecret);
  console.log("[cron] auth check", {
    hasEnvSecret: !!envSecret, envSecretLen: envSecret?.length ?? 0,
    hasQuerySecret: !!querySecret, querySecretLen: querySecret?.length ?? 0,
    hasAuthHeader: !!authHeader, isAuthorized,
  });
  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Queue recovery must not depend on a browser tab continuing to poll the
  // batch page. The Worker invokes this authenticated cron every minute.
  const recoveredFetches = await recoverFetchJobs().catch((error) => {
    console.error("[cron] fetch recovery failed", error);
    return 0;
  });

  const now = new Date();
  const posts = await prisma.post.findMany({
    where: { status: "pending", scheduledAt: { lte: now } },
  });

  const results = await Promise.all(posts.map(async (post) => {
    // Claim as queued before publishing to avoid a second cron tick enqueueing
    // the same Post. The Queue worker performs the final atomic publish claim.
    const claim = await prisma.post.updateMany({ where: { id: post.id, status: "pending" }, data: { status: "queued" } });
    if (claim.count === 0) return { id: post.id, status: "skipped" };

    if (await enqueuePublish(post.id)) return { id: post.id, status: "queued" };

    // Keep the job pending and let the next cron tick retry enqueueing. This
    // deliberately avoids bypassing Queue's concurrency with a direct FB call.
    await prisma.post.update({ where: { id: post.id }, data: { status: "pending" } });
    return { id: post.id, status: "queue_unavailable" };
  }));

  return NextResponse.json({ processed: results.length, recoveredFetches, results });
}
