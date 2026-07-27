import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    // A Queue message should claim the row within seconds. If it has not
    // claimed the row after 90 seconds, it was rejected/lost before work
    // began (for example a bad Worker credential). Only rows with no progress
    // message are touched, so an active source download remains undisturbed.
    await prisma.post.updateMany({
      where: {
        batchId: params.id,
        status: "fetching",
        errorMsg: null,
        updatedAt: { lt: new Date(Date.now() - 90_000) },
      },
      data: {
        status: "failed",
        errorMsg: "Worker chưa nhận job trong 90 giây. Hãy bấm Thử lại.",
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
