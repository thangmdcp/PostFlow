import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    // A deployment/runtime shutdown can interrupt an old in-process fetch
    // after it has claimed the row. Surface it as retryable instead of
    // rendering an infinite spinner. Normal source calls are capped below
    // two minutes, so ten minutes leaves ample room for Queue delivery.
    await prisma.post.updateMany({
      where: {
        batchId: params.id,
        status: "fetching",
        updatedAt: { lt: new Date(Date.now() - 10 * 60_000) },
      },
      data: {
        status: "failed",
        errorMsg: "Quá thời gian lấy nội dung. Hãy bấm Thử lại.",
      },
    });

    const batch = await prisma.batch.findUnique({
      where: { id: params.id },
      include: {
        posts: {
          include: { extractedLinks: { orderBy: { order: "asc" } }, comments: true },
          orderBy: { order: "asc" },
        },
      },
    });

    if (!batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    return NextResponse.json(batch);
  } catch (err) {
    console.error("GET /api/batches/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
