import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fetchPostFieldsWithRetry } from "@/lib/postProcessing";
import { FETCH_RETRY_DELAYS_SECONDS, fetchRetryDelaySeconds, SourceFetchError, sourceDiagnostic, type SourceFetchDiagnostic } from "@/lib/sourceFetchError";
import { FetchDownloadReady, FetchStageChanged, fetchStageFor, readDownloadSnapshot, type FetchStage } from "@/lib/fetchDownloadSnapshot";
import { enqueuePublish, enqueueFetch } from "@/lib/cloudflareQueue";
import type { PoolClaim } from "@/lib/downloadPool";

const FETCH_LEASE_MS = 7 * 60_000;

export type FetchPostJobResult = {
  status: "done" | "deferred" | "waiting" | "handed_off" | "failed" | "skipped";
  retryAfterSeconds?: number;
};

function isStoredDiagnostic(value: Prisma.JsonValue): value is Prisma.JsonObject & SourceFetchDiagnostic {
  return !!value
    && typeof value === "object"
    && !Array.isArray(value)
    && ["autodown", "flully", "render", "cloudinary", "rapidapi", "queue"].includes(String(value.provider))
    && typeof value.code === "string"
    && typeof value.message === "string";
}

function waitingMessage(error: SourceFetchError): string {
  const autoDownCouldNotParse = error.diagnostics.some((item) => item.code === "FACEBOOK_PARSE_FAILED");
  if (error.code === "PROVIDER_CIRCUIT_OPEN") return `${error.message} Đang chờ tự tiếp tục…`;
  if (["flully", "render"].includes(error.provider) && error.code === "MEDIA_BUSY") return `${error.provider === "render" ? "Render" : "Flully"} đang tải video khác · chờ tới lượt, không tính lỗi…`;
  if (autoDownCouldNotParse) return "Flully không đọc được Reel · nguồn Facebook dự phòng tạm bận · đang tự thử lại…";
  return `${error.message} Đang tự thử lại…`;
}

async function handoffFetch(postId: string, stage: FetchStage): Promise<FetchPostJobResult> {
  return await enqueueFetch(postId, stage) ? { status: "handed_off" } : { status: "deferred", retryAfterSeconds: 5 };
}

/** Explicit stages never run each other's work. Legacy messages only hand off. */
export async function processFetchPost(postId: string, stage: FetchStage | "legacy" = "download", reservation?: PoolClaim): Promise<FetchPostJobResult> {
  const now = new Date();
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (post?.sourceKind === "existing_facebook_post") return { status: "skipped" };
  if (!post || !["queued", "fetching"].includes(post.status)) {
    return { status: "skipped" };
  }
  const snapshot = readDownloadSnapshot(post.fetchDownloadSnapshot, post.sourceUrl);
  const refreshing = snapshot?.purpose === "publish";
  if (snapshot?.prepared) return { status: "skipped" };
  // A stale Fetch message must never re-fetch/rebuild a scheduled caption.
  if (post.finalCaption && post.pageId && !refreshing) return { status: "skipped" };
  const reserved = !!reservation && post.status === "fetching" && post.fetchLeaseUntil?.getTime() === reservation.leaseUntil.getTime()
    && snapshot?.pool?.owner === JSON.parse(reservation.reservation.value).owner;
  if (post.fetchLeaseUntil && post.fetchLeaseUntil.getTime() > now.getTime() && !reserved) return { status: "skipped" };
  const requiredStage = fetchStageFor(post.sourceUrl, post.fetchDownloadSnapshot, now.getTime());
  if (stage !== requiredStage) return handoffFetch(post.id, requiredStage);
  if (post.fetchNextAttemptAt && post.fetchNextAttemptAt.getTime() > now.getTime()) {
    return {
      status: post.fetchErrorCode === "MEDIA_BUSY" ? "waiting" : "deferred",
      retryAfterSeconds: Math.max(1, Math.ceil((post.fetchNextAttemptAt.getTime() - now.getTime()) / 1000)),
    };
  }

  const leaseUntil = reserved ? reservation!.leaseUntil : new Date(now.getTime() + FETCH_LEASE_MS);
  const owned = { id: postId, status: "fetching", fetchLeaseUntil: leaseUntil };
  const claim = reserved ? {count:1} : await prisma.post.updateMany({
    where: {
      id: postId,
      updatedAt: post.updatedAt,
      status: { in: ["queued", "fetching"] },
      OR: [{ fetchLeaseUntil: null }, { fetchLeaseUntil: { lte: now } }],
    },
    data: {
      status: "fetching",
      errorMsg: stage === "upload" ? "Đang lưu media vào Cloudinary…" : "Đang tải nội dung nguồn…",
      fetchLeaseUntil: leaseUntil,
      fetchNextAttemptAt: null,
    },
  });
  if (claim.count === 0) return { status: "skipped" };

  try {
    const fields = await fetchPostFieldsWithRetry(post.sourceUrl, {
      skipAutoDown: post.fetchProvider === "rapidapi", manifest: post.fetchMediaManifest, postId: post.id,
      separateDownload: true, downloadSnapshot: post.fetchDownloadSnapshot, stage,
      ...(stage === "render" ? {renderPostId:post.id}:{}),
      ...(reserved ? {downloadReservation:reservation!.reservation}:{}),
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
        fetchErrorCode: null, fetchHttpStatus: null, fetchNextAttemptAt: null,
      } });
      return saved.count ? handoffFetch(post.id, "upload") : { status: "skipped" };
    }
    if (cause instanceof FetchStageChanged) {
      const saved = await prisma.post.updateMany({ where: owned, data: { status: "queued", fetchLeaseUntil: null, fetchNextAttemptAt: null } });
      return saved.count ? handoffFetch(post.id, cause.stage) : { status: "skipped" };
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
    const busy = ["flully", "render"].includes(error.provider) && error.code === "MEDIA_BUSY";
    // Only an explicit unavailable/not-started response permits a handoff.
    // A lost response stays pinned until Render can check its deterministic asset.
    if (error.provider === "render" && ["RENDER_UNAVAILABLE", "RENDER_NOT_CONFIGURED"].includes(error.code)
      && post.fetchErrorCode !== "RENDER_UNCERTAIN") {
      const saved = await prisma.post.updateMany({where:owned,data:{status:"queued",fetchLeaseUntil:null,fetchNextAttemptAt:null,
        fetchDownloadSnapshot:{...(snapshot ?? {version:1,sourceUrl:post.sourceUrl,purpose:"fetch"}),downloadProvider:"flully"} as unknown as Prisma.InputJsonValue,
        fetchDiagnostics:error.diagnostics as unknown as Prisma.InputJsonValue,errorMsg:"Render chưa sẵn sàng · chuyển sang Flully…"}});
      return saved.count ? handoffFetch(post.id,"download") : {status:"skipped"};
    }
    const consumesAttempt = !busy && error.code !== "PROVIDER_CIRCUIT_OPEN";
    const attempt = (post.fetchAttempt ?? 0) + (consumesAttempt ? 1 : 0);
    const canRetry = error.retryable && (!consumesAttempt || attempt <= FETCH_RETRY_DELAYS_SECONDS.length);

    if (canRetry) {
      const retryAfterSeconds = busy ? Math.max(5, Math.min(30, error.retryAfterSeconds ?? 10))
        : fetchRetryDelaySeconds(attempt, error.retryAfterSeconds, Math.floor(Math.random() * 8));
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
          ...(reserved && busy ? {fetchDownloadSnapshot:{...(snapshot ?? {version:1,purpose:"fetch",sourceUrl:post.sourceUrl}),started:false,pool:undefined} as unknown as Prisma.InputJsonValue}:{}),
        },
      });
      return { status: busy ? "waiting" : "deferred", retryAfterSeconds };
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
