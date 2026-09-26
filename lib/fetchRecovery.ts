import { prisma } from "@/lib/prisma";
import { enqueueFetch } from "@/lib/cloudflareQueue";

const RECOVERING_MESSAGE = "Đang khôi phục Fetch Worker…";
const DELIVERY_GRACE_MS = 5 * 60_000;

/**
 * Re-enqueue only jobs whose processing lease expired or whose due queue job
 * has not been claimed for five minutes. Duplicate delivery is harmless: the
 * conditional lease claim in processFetchPost allows only one provider call.
 */
export async function recoverFetchJobs(batchId?: string): Promise<number> {
  const scope = batchId ? { batchId } : {};
  const now = new Date();
  const staleBefore = new Date(now.getTime() - DELIVERY_GRACE_MS);

  const expiredLeases = await prisma.post.findMany({
    where: {
      ...scope,
      status: "fetching",
      OR: [
        { fetchLeaseUntil: { lte: now } },
        { fetchLeaseUntil: null, updatedAt: { lt: staleBefore } },
      ],
    },
    select: { id: true },
    take: 50,
  });
  const expiredIds = expiredLeases.map((post) => post.id);
  if (expiredIds.length) await prisma.post.updateMany({
    where: { id: { in: expiredIds }, status: "fetching" },
    data: {
      status: "queued",
      errorMsg: RECOVERING_MESSAGE,
      fetchLeaseUntil: null,
      fetchNextAttemptAt: now,
    },
  });

  const recoverable = await prisma.post.findMany({
    where: {
      ...scope,
      status: "queued",
      updatedAt: { lt: staleBefore },
      OR: [{ fetchNextAttemptAt: null }, { fetchNextAttemptAt: { lte: now } }],
    },
    select: { id: true },
    take: 50,
  });
  const ids = [...new Set([...expiredIds, ...recoverable.map((post) => post.id)])];
  if (!ids.length) return 0;
  await prisma.post.updateMany({
    where: { id: { in: ids }, status: "queued" },
    data: { errorMsg: RECOVERING_MESSAGE },
  });
  const results = await Promise.all(ids.map((id) => enqueueFetch(id)));
  return results.filter(Boolean).length;
}
