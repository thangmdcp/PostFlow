import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fetchPostFieldsWithRetry } from "@/lib/postProcessing";
import { FETCH_RETRY_DELAYS_SECONDS, fetchRetryDelaySeconds, SourceFetchError, sourceDiagnostic, type SourceFetchDiagnostic } from "@/lib/sourceFetchError";
import { FetchDownloadReady, readDownloadSnapshot } from "@/lib/fetchDownloadSnapshot";
import { enqueuePublish } from "@/lib/cloudflareQueue";

const FETCH_LEASE_MS = 7 * 60_000;

export type FetchPostJobResult = {
  status: "done" | "deferred" | "failed" | "skipped";
  retryAfterSeconds?: number;
};

function isStoredDiagnostic(value: Prisma.JsonValue): value is Prisma.JsonObject & SourceFetchDiagnostic {
  return !!value
    && typeof value === "object"
    && !Array.isArray(value)
    && ["autodown", "flully", "cloudinary", "rapidapi", "queue"].includes(String(value.provider))
    && typeof value.code === "string"
    && typeof value.message === "string";
}

function waitingMessage(error: SourceFetchError): string {
  const autoDownCouldNotParse = error.diagnostics.some((item) => item.code === "FACEBOOK_PARSE_FAILED");
  if (error.code === "PROVIDER_CIRCUIT_OPEN") return `${error.message} Đang chờ tự tiếp tục…`;
  if (autoDownCouldNotParse) return "Flully không đọc được Reel · nguồn Facebook dự phòng tạm bận · đang tự thử lại…";
  return `${error.message} Đang tự thử lại…`;
}

/** Process one source link. Called only by the dedicated Cloudflare Fetch Queue. */
export async function processFetchPost(postId: string): Promise<FetchPostJobResult> {
  const now = new Date();
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post || post.status === "ready" || post.status === "done" || post.status === "pending") {
    return { status: "skipped" };
  }
  const snapshot = readDownloadSnapshot(post.fetchDownloadSnapshot, post.sourceUrl);
  const refreshing = snapshot?.purpose === "publish";
  if (snapshot?.prepared) return { status: "skipped" };
  // A stale Fetch message must never re-fetch/rebuild a scheduled caption.
  if (post.finalCaption && post.pageId && !refreshing) return { status: "skipped" };
  if (post.fetchNextAttemptAt && post.fetchNextAttemptAt.getTime() > now.getTime()) {
    return {
      status: "deferred",
      retryAfterSeconds: Math.max(1, Math.ceil((post.fetchNextAttemptAt.getTime() - now.getTime()) / 1000)),
    };
  }

  const leaseUntil = new Date(now.getTime() + FETCH_LEASE_MS);
  const owned = { id: postId, status: "fetching", fetchLeaseUntil: leaseUntil };
  const claim = await prisma.post.updateMany({
    where: {
      id: postId,
      status: { in: ["queued", "fetching"] },
      OR: [{ fetchLeaseUntil: null }, { fetchLeaseUntil: { lte: now } }],
    },
    data: {
      status: "fetching",
      errorMsg: "Đang lấy nội dung và media…",
      fetchLeaseUntil: leaseUntil,
      fetchNextAttemptAt: null,
    },
  });
  if (claim.count === 0) return { status: "skipped" };

  try {
    const fields = await fetchPostFieldsWithRetry(post.sourceUrl, {
      skipAutoDown: post.fetchProvider === "rapidapi", manifest: post.fetchMediaManifest, postId: post.id,
      separateDownload: true, downloadSnapshot: post.fetchDownloadSnapshot,
      checkpoint: async (assets) => {
        const saved = await prisma.post.updateMany({ where: owned, data: { fetchMediaManifest: assets as unknown as Prisma.InputJsonValue } });
        if (!saved.count) throw new Error("Fetch lease lost");
      },
    });
    if (refreshing) {
      if (fields.mediaType !== "video") throw new SourceFetchError({ provider: "flully", code: "REFRESH_NOT_VIDEO",
        message: "Nguồn không còn trả video; không tự đổi bài đã lên lịch thành bài ảnh.", retryable: false });
      const saved = await prisma.post.updateMany({ where: owned, data: {
        stableMediaUrl: fields.stableMediaUrl, thumbnailUrl: fields.thumbnailUrl, mediaUrls: fields.mediaUrls,
        mediaType: fields.mediaType, cloudinaryId: fields.cloudinaryId, status: "pending", errorMsg: null,
        fetchDownloadSnapshot: { version: 1, purpose: "publish", prepared: true, sourceUrl: post.sourceUrl,
          ...(snapshot.publishToPage === undefined ? {} : { publishToPage: snapshot.publishToPage }) },
        fetchProvider: fields.fetchProvider, fetchErrorCode: null, fetchHttpStatus: null, fetchLeaseUntil: null, fetchNextAttemptAt: null,
      } });
      if (!saved.count) return { status: "skipped" };
      // Cron can enqueue pending publish if the producer is temporarily down.
      await enqueuePublish(post.id, { publishToPage: snapshot.publishToPage });
      return { status: "done" };
    }
    await prisma.post.update({
      where: owned,
      data: {
        title: fields.title, rawCaption: fields.rawCaption, finalCaption: null, stableMediaUrl: fields.stableMediaUrl,
        thumbnailUrl: fields.thumbnailUrl, mediaUrls: fields.mediaUrls, mediaType: fields.mediaType,
        cloudinaryId: fields.cloudinaryId, status: "ready", errorMsg: null,
        fetchProvider: fields.fetchProvider,
        fetchDownloadSnapshot: Prisma.DbNull,
        fetchMediaManifest: fields.fetchMediaManifest.length ? fields.fetchMediaManifest as unknown as Prisma.InputJsonValue : Prisma.DbNull,
        fetchErrorCode: null, fetchHttpStatus: null, fetchNextAttemptAt: null, fetchLeaseUntil: null,
        fetchDiagnostics: fields.diagnostics.length ? fields.diagnostics as unknown as Prisma.InputJsonValue : Prisma.JsonNull,
        extractedLinks: {
          deleteMany: {},
          create: fields.links.map((url, index) => ({ order: index + 1, competitorUrl: url })),
        },
      },
    });
    return { status: "done" };
  } catch (cause) {
    if (cause instanceof FetchDownloadReady) {
      const saved = await prisma.post.updateMany({ where: owned, data: {
        status: "queued", errorMsg: "Đã tải nguồn · đang lưu media vào Cloudinary…",
        fetchDownloadSnapshot: cause.snapshot as unknown as Prisma.InputJsonValue,
        fetchProvider: cause.snapshot.data?.provider ?? "flully", fetchLeaseUntil: null,
        fetchErrorCode: null, fetchHttpStatus: null, fetchNextAttemptAt: new Date(Date.now() + 1000),
      } });
      return saved.count ? { status: "deferred", retryAfterSeconds: 1 } : { status: "skipped" };
    }
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2025") return { status: "skipped" };
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
      await prisma.post.updateMany({
        where: owned,
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

    await prisma.post.updateMany({
      where: owned,
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
