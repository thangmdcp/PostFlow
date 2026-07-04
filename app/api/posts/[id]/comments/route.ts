import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { persistCommentJobs, scheduleCommentJobs } from "@/lib/autoCommentsRunner";

// Attaches comment jobs to a post that's already published (fbPostId known),
// outside the normal publish/schedule flow — used by the Dashboard's ads
// drawer when applying comments to posts with status "done".
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { comments } = (await req.json()) as { comments: { text: string; imageUrl?: string }[] };
    if (!comments?.length) return NextResponse.json({ ok: true });

    const post = await prisma.post.findUnique({ where: { id: params.id } });
    if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });
    if (!post.fbPostId || !post.pageId) {
      return NextResponse.json({ error: "Bài chưa đăng lên Facebook" }, { status: 400 });
    }

    const fbConn = await prisma.fbConnection.findUnique({ where: { pageId: post.pageId } });
    if (!fbConn) return NextResponse.json({ error: "Không tìm thấy kết nối FB Page" }, { status: 400 });

    await persistCommentJobs(params.id, comments);
    await scheduleCommentJobs(params.id, post.fbPostId, fbConn.accessToken);

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
