import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/prisma";
import { topUpPageStories } from "@/lib/autoStoryRunner";
import { processFetchPost } from "@/lib/fetchPostJob";
import { enqueueFetch } from "@/lib/cloudflareQueue";

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
    const { urls } = (await req.json()) as { urls: string[] };

    if (!Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json({ error: "urls is required" }, { status: 400 });
    }

    // Dedupe + validate
    const validUrls = Array.from(
      new Set(
        urls
          .map((u: string) => u.trim())
          .filter((u) => u.startsWith("http"))
      )
    ).slice(0, 50);

    if (validUrls.length === 0) {
      return NextResponse.json({ error: "No valid URLs" }, { status: 400 });
    }

    // Create batch + posts — explicit `order` because relying on createdAt
    // (all rows share the same insert instant) or implicit row order isn't
    // guaranteed to come back in paste order on every later fetch, which
    // silently broke position-based matching (Sub_id file export/import,
    // "postNumber" naming) whenever a query happened to return them
    // differently than the order the user actually pasted the links in.
    const batch = await prisma.batch.create({
      data: {
        posts: {
          // `queued` means the job is durably waiting in Cloudflare Queue;
          // switch to `fetching` only when a consumer actually claims it.
          create: validUrls.map((url, i) => ({ sourceUrl: url, status: "queued", order: i })),
        },
      },
      include: {
        posts: { include: { extractedLinks: true, comments: true }, orderBy: { order: "asc" } },
      },
    });

    // Do not leave fetches attached only to this serverless invocation. A
    // request can be terminated after its response (especially outside
    // Vercel), which used to leave every row permanently at "fetching".
    // Queue is durable; the local waitUntil path is only a development /
    // Queue-unavailable fallback.
    const postIds = batch.posts.map((post) => post.id);
    const queued = await Promise.all(postIds.map((id) => enqueueFetch(id)));
    const fallbackIds = postIds.filter((_, index) => !queued[index]);
    if (fallbackIds.length) waitUntil(processFetchBatch(fallbackIds));

    // Every time a new batch is fetched, top up each connected page's
    // rolling Story quota from its own already-published archive — pages
    // aren't assigned to specific posts yet at this point, so this runs
    // globally rather than scoped to just this batch's (still page-less)
    // posts. Pure DB reads/writes, safe to await inline.
    await topUpPageStoriesForAllPages().catch((err) => console.error("[batches] story top-up failed:", err));

    return NextResponse.json({ batchId: batch.id, posts: batch.posts });
  } catch (err) {
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
