import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { uploadFromUrl } from "@/lib/cloudinary";

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const post = await prisma.post.findUnique({ where: { id: params.id } });

    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    // Already uploaded to Cloudinary
    if (post.cloudinaryId) {
      return NextResponse.json({ ok: true, stableMediaUrl: post.stableMediaUrl });
    }

    if (!post.stableMediaUrl) {
      return NextResponse.json({ error: "Không có media để upload" }, { status: 400 });
    }

    const { publicId, secureUrl, resourceType } = await uploadFromUrl(post.stableMediaUrl);

    await prisma.post.update({
      where: { id: params.id },
      data: {
        cloudinaryId: publicId,
        stableMediaUrl: secureUrl,
        mediaType: resourceType,
      },
    });

    return NextResponse.json({ ok: true, stableMediaUrl: secureUrl });
  } catch (err) {
    console.error("POST /api/posts/[id]/upload-media error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi upload" },
      { status: 500 }
    );
  }
}
