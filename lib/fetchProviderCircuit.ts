import { prisma } from "@/lib/prisma";
import { SourceFetchError, type SourceFetchProvider } from "@/lib/sourceFetchError";

const FAILURE_WINDOW_MS = 2 * 60_000;
const BLOCK_MS = 2 * 60_000;
const FAILURE_THRESHOLD = 3;

export async function assertFetchProviderAvailable(provider: Exclude<SourceFetchProvider, "queue">): Promise<void> {
  const state = await prisma.fetchProviderState.findUnique({ where: { provider } });
  if (!state?.blockedUntil || state.blockedUntil.getTime() <= Date.now()) return;
  throw new SourceFetchError({
    provider,
    code: "PROVIDER_CIRCUIT_OPEN",
    message: `${provider === "autodown" ? "AutoDown" : "Nguồn Facebook dự phòng"} đang tạm nghỉ sau nhiều lỗi liên tiếp.`,
    httpStatus: 503,
    retryable: true,
    retryAfterSeconds: Math.max(1, Math.ceil((state.blockedUntil.getTime() - Date.now()) / 1000)),
  });
}

export async function recordFetchProviderSuccess(provider: Exclude<SourceFetchProvider, "queue">): Promise<void> {
  const now = new Date();
  await prisma.fetchProviderState.upsert({
    where: { provider },
    create: { provider, lastSuccessAt: now },
    update: {
      consecutiveFailures: 0,
      failureWindowStartedAt: null,
      blockedUntil: null,
      lastErrorCode: null,
      lastHttpStatus: null,
      lastSuccessAt: now,
    },
  });
}

export async function recordFetchProviderFailure(error: SourceFetchError): Promise<void> {
  if (!error.retryable || error.provider === "queue" || error.code === "PROVIDER_CIRCUIT_OPEN") return;
  const now = new Date();
  const current = await prisma.fetchProviderState.findUnique({ where: { provider: error.provider } });
  const insideWindow = !!current?.failureWindowStartedAt
    && now.getTime() - current.failureWindowStartedAt.getTime() <= FAILURE_WINDOW_MS;
  const failures = insideWindow ? current!.consecutiveFailures + 1 : 1;
  const blockedUntil = failures >= FAILURE_THRESHOLD
    ? new Date(now.getTime() + Math.max(BLOCK_MS, (error.retryAfterSeconds ?? 0) * 1000))
    : null;
  await prisma.fetchProviderState.upsert({
    where: { provider: error.provider },
    create: {
      provider: error.provider,
      consecutiveFailures: failures,
      failureWindowStartedAt: now,
      blockedUntil,
      lastErrorCode: error.code,
      lastHttpStatus: error.httpStatus,
    },
    update: {
      consecutiveFailures: failures,
      failureWindowStartedAt: insideWindow ? current!.failureWindowStartedAt : now,
      blockedUntil,
      lastErrorCode: error.code,
      lastHttpStatus: error.httpStatus,
    },
  });
}
