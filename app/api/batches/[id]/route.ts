import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enqueueFetch } from "@/lib/cloudflareQueue";

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
    await prisma.post.updateMany({
      where: {
        batchId: params.id,
        status: "fetching",
        errorMsg: "Đang khôi phục job…",
        updatedAt: { lt: new Date(Date.now() - 90_000) },
      },
      data: {
        status: "failed",
        errorMsg: "Worker vẫn chưa nhận job sau khi tự khôi phục. Hãy thử lại.",
      },
    });

    // Repair jobs that were rejected by a previously misconfigured Queue
    // consumer. This exact message is only written by the stale-job guard
    // above, avoiding an automatic retry loop for genuine source failures.
    const recoverable = await prisma.post.findMany({
      where: {
        batchId: params.id,
        status: "failed",
        errorMsg: "Worker chưa nhận job trong 90 giây. Hãy bấm Thử lại.",
      },
      select: { id: true },
    });
    if (recoverable.length) {
      const ids = recoverable.map((post) => post.id);
      await prisma.post.updateMany({
        where: { id: { in: ids }, status: "failed" },
        data: { status: "fetching", errorMsg: "Đang khôi phục job…" },
      });
      const queued = await Promise.all(ids.map((id) => enqueueFetch(id)));
      const failedIds = ids.filter((_, index) => !queued[index]);
      if (failedIds.length) {
        await prisma.post.updateMany({
          where: { id: { in: failedIds }, status: "fetching" },
          data: { status: "failed", errorMsg: "Không thể đưa job vào Queue. Hãy thử lại." },
        });
      }
    }

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
