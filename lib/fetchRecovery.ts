import { prisma } from "@/lib/prisma";
import { enqueueRecoveredFetches } from "@/lib/cloudflareQueue";

const RECOVERING_MESSAGE = "Đang khôi phục Fetch Worker…";
const DELIVERY_GRACE_MS = 5 * 60_000;

/**
 * Re-enqueue only jobs whose processing lease expired or whose due queue job
 * has not been claimed for five minutes. Duplicate delivery is harmless: the
 * conditional lease claim in processFetchPost allows only one provider call.
 */
export async function recoverFetchJobs(batchId?: string): Promise<number> {
  const scope = { sourceKind: "source_link", ...(batchId ? { batchId } : {}) };
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
    where: { id: { in: expiredIds }, status: "fetching", OR: [
      { fetchLeaseUntil: { lte: now } }, { fetchLeaseUntil: null, updatedAt: { lt: staleBefore } },
    ] },
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
      AND: [{ OR: [{ finalCaption: null }, { AND: [
        { fetchDownloadSnapshot: { path: ["purpose"], equals: "publish" } },
        { fetchDownloadSnapshot: { path: ["prepared"], equals: false } },
      ] }] }],
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
  const current = await prisma.post.findMany({ where: { id: { in: ids }, status: "queued" },
    select: { id: true, sourceUrl: true, fetchDownloadSnapshot: true } });
  return enqueueRecoveredFetches(current);
}
