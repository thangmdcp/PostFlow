import { fetchPostData } from "@/lib/rapidapi";
import { extractLinks } from "@/lib/extractLinks";
import { uploadFromUrl, uploadFetchedVideo, cloudinaryFetchError } from "@/lib/cloudinary";
import { SourceFetchError, type SourceFetchDiagnostic } from "@/lib/sourceFetchError";
import { readFetchMediaManifest, type FetchMediaAsset } from "@/lib/fetchMediaManifest";
import { createHash } from "node:crypto";
import { readDownloadSnapshot, reusableDownload, FetchDownloadReady, FetchStageChanged, type FetchDownloadSnapshot, type FetchStage } from "@/lib/fetchDownloadSnapshot";

export interface FetchedPostFields {
  title: string | null;
  rawCaption: string;
  stableMediaUrl: string | null;
  thumbnailUrl: string | null;
  mediaUrls: string | null;
  mediaType: string | null;
  cloudinaryId: string | null;
  links: string[];
  fetchProvider: string;
  fetchMediaManifest: FetchMediaAsset[];
  diagnostics: SourceFetchDiagnostic[];
}

// Download and upload run on separate durable Queue deliveries.
export async function fetchPostFields(sourceUrl: string, options: {
  skipAutoDown?: boolean; manifest?: unknown; postId?: string;
  checkpoint?: (assets: FetchMediaAsset[]) => Promise<void>;
  downloadSnapshot?: unknown;
  separateDownload?: boolean;
  stage?: FetchStage;
} = {}): Promise<FetchedPostFields> {
  const snapshot = readDownloadSnapshot(options.downloadSnapshot, sourceUrl);
  const cached = reusableDownload(snapshot);
  if (options.stage === "upload" && !cached) throw new FetchStageChanged("download");
  if (options.stage === "download" && cached) throw new FetchStageChanged("upload");
  const data = cached ?? await fetchPostData(sourceUrl, options);
  if (!cached && options.separateDownload && data.media.length) {
    const next: FetchDownloadSnapshot = { version: 1, sourceUrl, purpose: snapshot?.purpose ?? "fetch",
      prepared: false,
      ...(snapshot?.publishToPage === undefined ? {} : { publishToPage: snapshot.publishToPage }),
      data, expiresAt: data.expiresAt ?? new Date(Date.now() + 15 * 60_000).toISOString() };
    throw new FetchDownloadReady(next);
  }
  const caption = data.caption ?? "";
  const links = extractLinks(caption);

  const videos = data.media.filter((m) => m.type === "video" && m.url);
  const photos = data.media.filter((m) => m.type === "photo" && m.url);
  const provider = data.provider ?? "rapidapi";
  const manifest: FetchMediaAsset[] = [];
  const bestVideo =
    videos.find((m) => m.quality === "hd_no_watermark") ??
    videos.find((m) => m.quality === "no_watermark") ??
    videos.find((m) => (m.quality ?? "").toLowerCase().includes("hd")) ??
    videos[0];

  let stableMediaUrl: string | null = null;
  let mediaType: string | null = null;
  let thumbnailUrl: string | null = null;
  let mediaUrls: string | null = null;
  let cloudinaryId: string | null = null;

  if (!bestVideo && !photos.length) throw new SourceFetchError({
    provider, code: "FETCH_EMPTY_MEDIA", message: "Nguồn không trả về ảnh hoặc video hợp lệ.", retryable: true, httpStatus: 502,
    diagnostics: [...(data.diagnostics ?? []), { provider, code: "FETCH_EMPTY_MEDIA", message: "Nguồn không trả media hợp lệ.", retryable: true, httpStatus: 502 }],
  });
  if (!bestVideo) {
    if (photos.length > 50) throw new SourceFetchError({ provider, code: "TOO_MANY_PHOTOS", message: "Bài vượt quá giới hạn 50 ảnh; không tự cắt album.", retryable: false });
    const previous = readFetchMediaManifest(options.manifest);
    for (let index = 0; index < photos.length; index++) {
      const photo = photos[index];
      const reusable = previous.find((asset) => asset.sourceUrl === photo.url
        || asset.sourceUrl.split("?")[0] === photo.url.split("?")[0]);
      try {
        let uploaded: { url: string; publicId: string };
        if (reusable) uploaded = reusable;
        else if (photo.publicId) uploaded = { url: photo.url, publicId: photo.publicId };
        else {
          const publicId = options.postId ? createHash("sha256").update(`${options.postId}|${photo.url.split("?")[0]}`).digest("hex") : undefined;
          const result = await uploadFromUrl(photo.url, { forceJpeg: true, folder: "postflow-fetch", publicId });
          uploaded = { url: result.secureUrl, publicId: result.publicId };
        }
        manifest.push({ sourceUrl: photo.url, url: uploaded.url, publicId: uploaded.publicId,
          resourceType: "image", order: index + 1, provider, extractor: data.extractor ?? "rapidapi" });
        photo.url = uploaded.url;
        await options.checkpoint?.(manifest);
      } catch (cause) {
        throw cloudinaryFetchError(cause);
      }
    }
  }

  if (bestVideo) {
    if (!options.postId) throw new Error("Video upload requires postId");
    const uploaded = await uploadFetchedVideo(bestVideo.url, options.postId);
    stableMediaUrl = uploaded.secureUrl;
    mediaType = "video";
    // Cloudinary-derived thumbnail outlives Flully's 24-hour capability URL.
    thumbnailUrl = uploaded.secureUrl.replace(/\.[a-z0-9]+(?:\?.*)?$/i, ".jpg");
    cloudinaryId = uploaded.publicId;
  } else if (photos.length === 1) {
    stableMediaUrl = photos[0].url;
    mediaType = "image";
    thumbnailUrl = photos[0].url;
  } else if (photos.length > 1) {
    stableMediaUrl = photos[0].url;
    mediaType = "carousel";
    thumbnailUrl = photos[0].url;
    mediaUrls = JSON.stringify(photos.map((p) => p.url));
  }

  return {
    title: data.title ?? null,
    rawCaption: caption,
    stableMediaUrl,
    thumbnailUrl,
    mediaUrls,
    mediaType,
    cloudinaryId,
    links,
    fetchProvider: data.extractor ?? provider,
    fetchMediaManifest: manifest,
    diagnostics: data.diagnostics ?? [],
  };
}

// RapidAPI may temporarily reject a burst of Facebook fallback requests with
// 429. Retry only that transient failure with a small backoff; other errors
// (private/deleted link, invalid media, etc.) should surface immediately.
export async function fetchPostFieldsWithRetry(sourceUrl: string, options: Parameters<typeof fetchPostFields>[1] = {}): Promise<FetchedPostFields> {
  // Durable retry/backoff is owned by Cloudflare Queue + Post.fetchNextAttemptAt.
  // Keeping sleeps inside a Vercel invocation wastes runtime and loses state if
  // that invocation is terminated.
  return fetchPostFields(sourceUrl, options);
}
