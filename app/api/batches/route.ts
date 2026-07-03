import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchPostData } from "@/lib/rapidapi";
import { extractLinks } from "@/lib/extractLinks";

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

    // Create batch + posts
    const batch = await prisma.batch.create({
      data: {
        posts: {
          create: validUrls.map((url) => ({ sourceUrl: url, status: "fetching" })),
        },
      },
      include: {
        posts: { include: { extractedLinks: true } },
      },
    });

    // Fire-and-forget: process all posts in parallel
    setImmediate(() => processBatch(batch.posts.map((p) => ({ id: p.id, sourceUrl: p.sourceUrl }))));


    return NextResponse.json({ batchId: batch.id, posts: batch.posts });
  } catch (err) {
    console.error("POST /api/batches error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function processOne(post: { id: string; sourceUrl: string }) {
  try {
    const data = await fetchPostData(post.sourceUrl);
    const caption = data.caption ?? "";
    const links = extractLinks(caption);

    // Pick best video URL — store raw URL only, Cloudinary upload happens at publish time
    const videos = data.media.filter((m) => m.type === "video");
    const photos = data.media.filter((m) => m.type === "photo");
    const bestVideo =
      videos.find((m) => m.quality === "hd_no_watermark") ??
      videos.find((m) => m.quality === "no_watermark") ??
      videos.find((m) => (m.quality ?? "").toLowerCase().includes("hd")) ??
      videos[0];

    let stableMediaUrl: string | null = null;
    let mediaType: string | null = null;
    let thumbnailUrl: string | null = null;
    let mediaUrls: string | null = null;
    // Set only for AutoDown-sourced videos — they're already on Cloudinary
    // (temp/ prefix), so publish-time skips re-uploading and cleanup routes
    // to AutoDown's own /api/cleanup instead of our Cloudinary account.
    let cloudinaryId: string | null = null;

    if (bestVideo) {
      stableMediaUrl = bestVideo.url ?? null;
      mediaType = "video";
      thumbnailUrl = photos[0]?.url ?? bestVideo.thumbnail ?? null;
      cloudinaryId = bestVideo.publicId ?? null;
    } else if (photos.length === 1) {
      stableMediaUrl = photos[0].url;
      mediaType = "image";
      thumbnailUrl = photos[0].url;
    } else if (photos.length > 1) {
      stableMediaUrl = photos[0].url;
      mediaType = "carousel";
      thumbnailUrl = photos[0].url;
      mediaUrls = JSON.stringify(photos.map((p) => p.url));
    }

    await prisma.post.update({
      where: { id: post.id },
      data: {
        title: data.title ?? null,
        rawCaption: caption,
        stableMediaUrl,
        thumbnailUrl,
        mediaUrls,
        mediaType,
        cloudinaryId,
        status: "ready",
        extractedLinks: {
          create: links.map((url, i) => ({ order: i + 1, competitorUrl: url })),
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
