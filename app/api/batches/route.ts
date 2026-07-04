import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/prisma";
import { fetchPostFields } from "@/lib/postProcessing";

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
          create: validUrls.map((url, i) => ({ sourceUrl: url, status: "fetching", order: i })),
        },
      },
      include: {
        posts: { include: { extractedLinks: true }, orderBy: { order: "asc" } },
      },
    });

    // Background work — waitUntil keeps the serverless function alive until
    // this finishes. A plain setImmediate/fire-and-forget gets killed the
    // moment the response is sent on Vercel, leaving posts stuck "fetching".
    waitUntil(processBatch(batch.posts.map((p) => ({ id: p.id, sourceUrl: p.sourceUrl }))));


    return NextResponse.json({ batchId: batch.id, posts: batch.posts });
  } catch (err) {
    console.error("POST /api/batches error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function processOne(post: { id: string; sourceUrl: string }) {
  try {
    const fields = await fetchPostFields(post.sourceUrl);

    await prisma.post.update({
      where: { id: post.id },
      data: {
        title: fields.title,
        rawCaption: fields.rawCaption,
        stableMediaUrl: fields.stableMediaUrl,
        thumbnailUrl: fields.thumbnailUrl,
        mediaUrls: fields.mediaUrls,
        mediaType: fields.mediaType,
        cloudinaryId: fields.cloudinaryId,
        status: "ready",
        extractedLinks: {
          create: fields.links.map((url, i) => ({ order: i + 1, competitorUrl: url })),
        },
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await prisma.post.update({
      where: { id: post.id },
      data: { status: "failed", errorMsg: msg },
    });
  }
}

async function processBatch(posts: { id: string; sourceUrl: string }[]) {
  // Run all posts in parallel — no sequential wait, no Cloudinary upload
  await Promise.all(posts.map((p) => processOne(p)));
}
