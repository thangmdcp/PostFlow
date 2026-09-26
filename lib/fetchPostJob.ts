import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fetchPostFieldsWithRetry } from "@/lib/postProcessing";
import { FETCH_RETRY_DELAYS_SECONDS, fetchRetryDelaySeconds, SourceFetchError, sourceDiagnostic, type SourceFetchDiagnostic } from "@/lib/sourceFetchError";

const FETCH_LEASE_MS = 5 * 60_000;

export type FetchPostJobResult = {
  status: "done" | "deferred" | "failed" | "skipped";
  retryAfterSeconds?: number;
};

function isStoredDiagnostic(value: Prisma.JsonValue): value is Prisma.JsonObject & SourceFetchDiagnostic {
  return !!value
    && typeof value === "object"
    && !Array.isArray(value)
    && (value.provider === "autodown" || value.provider === "rapidapi" || value.provider === "queue")
    && typeof value.code === "string"
    && typeof value.message === "string";
}

function waitingMessage(error: SourceFetchError): string {
  const autoDownCouldNotParse = error.diagnostics.some((item) => item.code === "FACEBOOK_PARSE_FAILED");
  if (error.code === "PROVIDER_CIRCUIT_OPEN") return `${error.message} Đang chờ tự tiếp tục…`;
  if (autoDownCouldNotParse) return "AutoDown không đọc được Reel · nguồn Facebook dự phòng tạm bận · đang tự thử lại…";
  return `${error.message} Đang tự thử lại…`;
}

/** Process one source link. Called only by the dedicated Cloudflare Fetch Queue. */
export async function processFetchPost(postId: string): Promise<FetchPostJobResult> {
  const now = new Date();
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post || post.status === "ready" || post.status === "done" || post.status === "pending") {
    return { status: "skipped" };
  }
  if (post.fetchNextAttemptAt && post.fetchNextAttemptAt.getTime() > now.getTime()) {
    return {
      status: "deferred",
      retryAfterSeconds: Math.max(1, Math.ceil((post.fetchNextAttemptAt.getTime() - now.getTime()) / 1000)),
    };
  }

  const claim = await prisma.post.updateMany({
    where: {
      id: postId,
      status: { in: ["queued", "fetching"] },
      OR: [{ fetchLeaseUntil: null }, { fetchLeaseUntil: { lte: now } }],
    },
    data: {
      status: "fetching",
      errorMsg: "Đang lấy nội dung và video…",
      fetchLeaseUntil: new Date(now.getTime() + FETCH_LEASE_MS),
      fetchNextAttemptAt: null,
    },
  });
  if (claim.count === 0) return { status: "skipped" };

  try {
    const fields = await fetchPostFieldsWithRetry(post.sourceUrl, { skipAutoDown: post.fetchProvider === "rapidapi" });
    await prisma.post.update({
      where: { id: post.id },
      data: {
        title: fields.title, rawCaption: fields.rawCaption, finalCaption: null, stableMediaUrl: fields.stableMediaUrl,
        thumbnailUrl: fields.thumbnailUrl, mediaUrls: fields.mediaUrls, mediaType: fields.mediaType,
        cloudinaryId: fields.cloudinaryId, status: "ready", errorMsg: null,
        fetchProvider: fields.cloudinaryId?.startsWith("temp/") ? "autodown" : "rapidapi",
        fetchErrorCode: null, fetchHttpStatus: null, fetchNextAttemptAt: null, fetchLeaseUntil: null,
        fetchDiagnostics: Prisma.JsonNull,
        extractedLinks: {
          deleteMany: {},
          create: fields.links.map((url, index) => ({ order: index + 1, competitorUrl: url })),
        },
      },
    });
    return { status: "done" };
  } catch (cause) {
    const rawError = cause instanceof SourceFetchError ? cause : new SourceFetchError({
      provider: "queue",
      code: "UNKNOWN_FETCH_ERROR",
      message: cause instanceof Error ? cause.message : "Không thể lấy nội dung bài.",
      retryable: false,
      diagnostics: [sourceDiagnostic(cause)],
    });
    const storedDiagnostics: SourceFetchDiagnostic[] = Array.isArray(post.fetchDiagnostics)
      ? post.fetchDiagnostics.filter(isStoredDiagnostic).map((item) => ({
          provider: item.provider,
          code: item.code,
          message: item.message,
          httpStatus: typeof item.httpStatus === "number" ? item.httpStatus : undefined,
          retryable: typeof item.retryable === "boolean" ? item.retryable : false,
        }))
      : [];
    const diagnostics = [...storedDiagnostics, ...rawError.diagnostics].filter((item, index, rows) =>
      rows.findIndex((candidate) => candidate.provider === item.provider && candidate.code === item.code) === index
    );
    const error = new SourceFetchError({
      provider: rawError.provider,
      code: rawError.code,
      message: rawError.message,
      httpStatus: rawError.httpStatus,
      retryable: rawError.retryable,
      retryAfterSeconds: rawError.retryAfterSeconds,
      diagnostics,
    });
    const consumesAttempt = error.code !== "PROVIDER_CIRCUIT_OPEN";
    const attempt = (post.fetchAttempt ?? 0) + (consumesAttempt ? 1 : 0);
    const canRetry = error.retryable && (!consumesAttempt || attempt <= FETCH_RETRY_DELAYS_SECONDS.length);

    if (canRetry) {
      const retryAfterSeconds = fetchRetryDelaySeconds(attempt, error.retryAfterSeconds, Math.floor(Math.random() * 8));
      await prisma.post.update({
        where: { id: post.id },
        data: {
          status: "queued",
          errorMsg: waitingMessage(error),
          fetchAttempt: attempt,
          fetchNextAttemptAt: new Date(Date.now() + retryAfterSeconds * 1000),
          fetchProvider: error.provider,
          fetchErrorCode: error.code,
          fetchHttpStatus: error.httpStatus ?? null,
          fetchLeaseUntil: null,
          fetchDiagnostics: error.diagnostics as unknown as Prisma.InputJsonValue,
        },
      });
      return { status: "deferred", retryAfterSeconds };
    }

    await prisma.post.update({
      where: { id: post.id },
      data: {
        status: "failed",
        errorMsg: error.retryable
          ? `Đã thử ${attempt} lần nhưng nguồn Facebook vẫn chưa phản hồi: ${error.message}`
          : error.message,
        fetchAttempt: attempt,
        fetchNextAttemptAt: null,
        fetchProvider: error.provider,
        fetchErrorCode: error.code,
        fetchHttpStatus: error.httpStatus ?? null,
        fetchLeaseUntil: null,
        fetchDiagnostics: error.diagnostics as unknown as Prisma.InputJsonValue,
      },
    });
    return { status: "failed" };
  }
}
