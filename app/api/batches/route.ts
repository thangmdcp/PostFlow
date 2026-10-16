import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/prisma";
import { topUpPageStories } from "@/lib/autoStoryRunner";
import { processFetchPost } from "@/lib/fetchPostJob";
import { enqueueFetch } from "@/lib/cloudflareQueue";
import { BatchInputError, createFetchBatch } from "@/lib/createFetchBatch";

export const maxDuration = 60;

async function enqueueFetchBatch(ids: string[]): Promise<boolean[]> {
  const results: boolean[] = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(10, ids.length) }, async () => {
    while (cursor < ids.length) {
      const index = cursor++;
      results[index] = await enqueueFetch(ids[index]);
    }
  }));
  return results;
}

async function processFetchBatch(ids: string[], concurrency = 4): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    while (cursor < ids.length) {
      const id = ids[cursor++];
      await processFetchPost(id);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
}

export async function POST(req: Request) {
  try {
    const { batch, reused, duplicates } = await createFetchBatch(await req.json());

    // Do not leave fetches attached only to this serverless invocation. A
    // request can be terminated after its response (especially outside
    // Vercel), which used to leave every row permanently at "fetching".
    // Queue is durable; the local waitUntil path is only a development /
    // Queue-unavailable fallback.
    const postIds = batch.posts.map((post) => post.id);
    const queued = await enqueueFetchBatch(postIds);
    const fallbackIds = postIds.filter((_, index) => !queued[index]);
    if (fallbackIds.length) waitUntil(processFetchBatch(fallbackIds));

    // Every time a new batch is fetched, top up each connected page's
    // rolling Story quota from its own already-published archive — pages
    // aren't assigned to specific posts yet at this point, so this runs
    // globally rather than scoped to just this batch's (still page-less)
    // posts. Pure DB reads/writes, safe to await inline.
    if (!reused) await topUpPageStoriesForAllPages().catch((err) => console.error("[batches] story top-up failed:", err));

    return NextResponse.json({ batchId: batch.id, posts: batch.posts, duplicates });
  } catch (err) {
    if (err instanceof BatchInputError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("POST /api/batches error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function topUpPageStoriesForAllPages() {
  const [storyEnabledCfg, storyCountCfg] = await Promise.all([
    prisma.appConfig.findUnique({ where: { key: "storyEnabled" } }),
    prisma.appConfig.findUnique({ where: { key: "storyCount" } }),
  ]);
  if (storyEnabledCfg?.value !== "true") return;
  const storyCount = Number(storyCountCfg?.value ?? 0);
  if (!storyCount) return;

  const pages = await prisma.fbConnection.findMany({ select: { pageId: true } });
  await Promise.all(pages.map((p) => topUpPageStories(p.pageId, storyCount)));
}
