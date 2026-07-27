import { prisma } from "@/lib/prisma";
import { enqueueFetch } from "@/lib/cloudflareQueue";

const UNCLAIMED_ERROR = "Worker chưa nhận job trong 90 giây. Hãy bấm Thử lại.";
const RECOVERING_MESSAGE = "Đang khôi phục job…";

/**
 * Make a single, durable recovery attempt for fetch jobs which never reached
 * a consumer. This is safe to call from both batch polling and the minute
 * cron: status transitions act as the claim and prevent duplicate enqueueing.
 */
export async function recoverFetchJobs(batchId?: string): Promise<number> {
  const scope = batchId ? { batchId } : {};
  const staleBefore = new Date(Date.now() - 90_000);

  await prisma.post.updateMany({
    where: { ...scope, status: "queued", errorMsg: null, updatedAt: { lt: staleBefore } },
    data: { status: "failed", errorMsg: UNCLAIMED_ERROR },
  });
  await prisma.post.updateMany({
    where: { ...scope, status: "queued", errorMsg: RECOVERING_MESSAGE, updatedAt: { lt: staleBefore } },
    data: { status: "failed", errorMsg: "Worker vẫn chưa nhận job sau khi tự khôi phục. Hãy thử lại." },
  });

  const recoverable = await prisma.post.findMany({
    where: { ...scope, status: "failed", errorMsg: UNCLAIMED_ERROR },
    select: { id: true },
    take: 50,
  });
  if (!recoverable.length) return 0;

  const ids = recoverable.map((post) => post.id);
  const claim = await prisma.post.updateMany({
    where: { id: { in: ids }, status: "failed", errorMsg: UNCLAIMED_ERROR },
    data: { status: "queued", errorMsg: RECOVERING_MESSAGE },
  });
  if (claim.count === 0) return 0;

  const queued = await Promise.all(ids.map((id) => enqueueFetch(id)));
  const failedIds = ids.filter((_, index) => !queued[index]);
  if (failedIds.length) {
    await prisma.post.updateMany({
      where: { id: { in: failedIds }, status: "queued", errorMsg: RECOVERING_MESSAGE },
      data: { status: "failed", errorMsg: "Không thể đưa job vào Queue. Hãy thử lại." },
    });
  }
  return ids.length - failedIds.length;
}
