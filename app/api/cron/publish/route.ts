import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { processDueAdRetries } from "@/lib/autoAdsRunner";
import { processDueCommentRetries } from "@/lib/autoCommentsRunner";
import { processDueStoryRetries } from "@/lib/autoStoryRunner";
import { publishDuePost } from "@/lib/publishDuePost";

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

  const now = new Date();
  const posts = await prisma.post.findMany({
    where: { status: "pending", scheduledAt: { lte: now } },
  });

  const results: { id: string; status: string; error?: string }[] = [];

  for (const post of posts) {
    results.push(await publishDuePost(post));
  }

  // Ads retries (2nd/3rd attempt) that came due since the last tick.
  await processDueAdRetries().catch((err) => console.error("[cron] processDueAdRetries failed:", err));
  await processDueCommentRetries().catch((err) => console.error("[cron] processDueCommentRetries failed:", err));
  await processDueStoryRetries().catch((err) => console.error("[cron] processDueStoryRetries failed:", err));

  return NextResponse.json({ processed: results.length, results });
}
