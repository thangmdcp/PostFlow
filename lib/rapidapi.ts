import { autodownDownload } from "@/lib/autodown";
import { assertFetchProviderAvailable, recordFetchProviderFailure, recordFetchProviderSuccess } from "@/lib/fetchProviderCircuit";
import { prisma } from "@/lib/prisma";
import { classifyRapidApiStatus, parseRetryAfter, sourceDiagnostic, SourceFetchError, type SourceFetchDiagnostic } from "@/lib/sourceFetchError";

export interface RapidApiMedia {
  url: string;
  type: "photo" | "video" | string;
  quality?: string;
  thumbnail?: string;
  publicId?: string;
}

export interface RapidApiPostData {
  title?: string;
  caption: string;
  media: RapidApiMedia[];
}

function isFacebookUrl(url: string) {
  return /facebook\.com|fb\.watch/i.test(url);
}

function isTikTokUrl(url: string) {
  return /tiktok\.com/i.test(url);
}

// Keys can be set via the web UI (stored in AppConfig, works on Vercel
// without a redeploy) or fall back to the env var for local/manual setups.
async function getRapidApiKeys(): Promise<string[]> {
  let raw = "";
  try {
    const row = await prisma.appConfig.findUnique({ where: { key: "rapidApiKeys" } });
    raw = row?.value ?? "";
  } catch { /* DB not reachable — fall back to env */ }
  if (!raw) raw = process.env.RAPIDAPI_KEY ?? "";

  return raw
    .split(/[\n,]+/)
    .map((k) => k.trim())
    .filter(Boolean);
}

// Free-tier RapidAPI keys hit a monthly/rate quota fast. When the user supplies
// several keys, rotate to the next one on 429/403 instead of failing the whole
// fetch — only throw once every key has been exhausted.
async function withKeyRotation<T>(fn: (key: string) => Promise<T>): Promise<T> {
  const keys = await getRapidApiKeys();
  if (keys.length === 0) throw new SourceFetchError({
    provider: "rapidapi", code: "RAPIDAPI_NOT_CONFIGURED",
    message: "Chưa cấu hình RAPIDAPI_KEY.", retryable: false,
  });

  let lastErr: unknown;
  for (const key of keys) {
    try {
      return await fn(key);
    } catch (err) {
      lastErr = err;
      const status = err instanceof SourceFetchError ? err.httpStatus : undefined;
      if (status === 429 || status === 401 || status === 403) continue;
      throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Tất cả RAPIDAPI_KEY đều hết lượt");
}

// AutoDown is fast and can run concurrently. RapidAPI is the fallback only
// and a single free/low-tier key is easily burst-limited, so serialize those
// requests with a short gap instead of sacrificing the entire batch to 429s.
let rapidApiTail: Promise<void> = Promise.resolve();
async function throughRapidApiGate<T>(fn: () => Promise<T>): Promise<T> {
  const previous = rapidApiTail;
  let release!: () => void;
  rapidApiTail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await fn();
  } finally {
    setTimeout(release, 1_100);
  }
}

// AutoDown's /download already returns caption and stable Cloudinary media.
// Calling /extract first made yt-dlp parse every Facebook Reel twice.
async function fetchViaAutoDown(url: string): Promise<RapidApiPostData> {
  const downloaded = await autodownDownload(url);
  if (!downloaded?.media?.length) throw new SourceFetchError({
    provider: "autodown", code: "AUTODOWN_EMPTY_MEDIA",
    message: "AutoDown không trả về media.", retryable: true, httpStatus: 502, retryAfterSeconds: 30,
  });

  const media: RapidApiMedia[] = downloaded.media.map((m) => ({
    url: m.url,
    type: m.type,
    publicId: m.public_id,
    thumbnail: m.type === "video" ? downloaded.thumbnail : undefined,
  }));
  return { caption: downloaded.caption ?? "", media };
}

async function fetchFacebookPost(url: string): Promise<RapidApiPostData> {
  await assertFetchProviderAvailable("rapidapi");
  try {
    const result = await throughRapidApiGate(() => withKeyRotation(async (key) => fetchFacebookPostWithKey(url, key)));
    await recordFetchProviderSuccess("rapidapi");
    return result;
  } catch (cause) {
    const error = cause instanceof SourceFetchError ? cause : networkSourceError(cause, "FB API");
    await recordFetchProviderFailure(error);
    throw error;
  }
}

async function fetchFacebookPostWithKey(url: string, apiKey: string): Promise<RapidApiPostData> {
  let res: Response;
  try {
    res = await fetch(
      `https://facebook-scraper3.p.rapidapi.com/post?post_url=${encodeURIComponent(url)}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "x-rapidapi-key": apiKey,
          "x-rapidapi-host": "facebook-scraper3.p.rapidapi.com",
        },
        signal: AbortSignal.timeout(30_000),
      }
    );
  } catch (cause) {
    throw networkSourceError(cause, "FB API");
  }
  if (!res.ok) throw rapidApiResponseError(res, "FB API");

  const data = await res.json();
  const post = (data?.results ?? (Array.isArray(data) ? data[0] : data)) as Record<string, unknown>;

  const caption = (post?.message ?? post?.description ?? post?.text ?? "") as string;

  const media: RapidApiMedia[] = [];

  // Video post
  if (post?.video_files) {
    const files = post.video_files as Record<string, string>;
    if (files.hd_url) media.push({ url: files.hd_url, type: "video", quality: "hd" });
    if (files.sd_url) media.push({ url: files.sd_url, type: "video", quality: "sd" });
    const thumb = (post.video_thumbnail ?? (post.image as Record<string,string>)?.uri) as string | undefined;
    if (thumb) media.push({ url: thumb, type: "photo" });
    return { caption, media };
  }

  // Carousel: album_preview contains all photos
  const albumPreview = post?.album_preview as Array<Record<string, string>> | null;
  if (Array.isArray(albumPreview) && albumPreview.length > 0) {
    for (const item of albumPreview) {
      const uri = item.image_file_uri;
      if (uri) media.push({ url: uri, type: "photo" });
    }
    return { caption, media };
  }

  // Single photo
  const imgUri = (post?.image as Record<string, string>)?.uri;
  if (imgUri) media.push({ url: imgUri, type: "photo" });

  return { caption, media };
}

async function fetchGenericPost(url: string): Promise<RapidApiPostData> {
  await assertFetchProviderAvailable("rapidapi");
  try {
    const result = await throughRapidApiGate(() => withKeyRotation(async (key) => fetchGenericPostWithKey(url, key)));
    await recordFetchProviderSuccess("rapidapi");
    return result;
  } catch (cause) {
    const error = cause instanceof SourceFetchError ? cause : networkSourceError(cause, "RapidAPI");
    await recordFetchProviderFailure(error);
    throw error;
  }
}

async function fetchGenericPostWithKey(url: string, apiKey: string): Promise<RapidApiPostData> {
  let res: Response;
  try {
    res = await fetch("https://social-download-all-in-one.p.rapidapi.com/v1/social/autolink", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-rapidapi-key": apiKey,
        "x-rapidapi-host": process.env.RAPIDAPI_HOST!,
      },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (cause) {
    throw networkSourceError(cause, "RapidAPI");
  }
  if (!res.ok) throw rapidApiResponseError(res, "RapidAPI");

  const data = await res.json();

  const caption =
    data.text ??
    data.content ??
    data.description ??
    data.caption ??
    data.message ??
    data.title ??
    "";

  const media: RapidApiMedia[] = (data.medias ?? data.media ?? []).map(
    (m: Record<string, unknown>) => ({
      url: (m.url ?? m.src ?? m.link ?? "") as string,
      type: (m.type ?? m.mediaType ?? "photo") as string,
      quality: m.quality as string | undefined,
      thumbnail: m.thumbnail as string | undefined,
    })
  );

  return { title: data.title as string | undefined, caption, media };
}

export async function fetchPostData(url: string, options: { skipAutoDown?: boolean } = {}): Promise<RapidApiPostData> {
  const isFb = isFacebookUrl(url);
  let autodownDiagnostic: SourceFetchDiagnostic | null = null;
  if (!options.skipAutoDown && (isFb || isTikTokUrl(url))) {
    try {
      return await fetchViaAutoDown(url);
    } catch (error) {
      autodownDiagnostic = sourceDiagnostic(error);
    }
  }
  try {
    return isFb ? await fetchFacebookPost(url) : await fetchGenericPost(url);
  } catch (cause) {
    if (!(cause instanceof SourceFetchError) || !autodownDiagnostic) throw cause;
    throw new SourceFetchError({
      provider: cause.provider,
      code: cause.code,
      message: cause.message,
      httpStatus: cause.httpStatus,
      retryable: cause.retryable,
      retryAfterSeconds: cause.retryAfterSeconds,
      diagnostics: [autodownDiagnostic, ...cause.diagnostics],
    });
  }
}

function rapidApiResponseError(response: Response, label: string): SourceFetchError {
  const status = response.status;
  const { code, retryable } = classifyRapidApiStatus(status);
  return new SourceFetchError({
    provider: "rapidapi",
    code,
    message: `${label} trả HTTP ${status} ${response.statusText}`.trim(),
    httpStatus: status,
    retryable,
    retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after")),
  });
}

function networkSourceError(cause: unknown, label: string): SourceFetchError {
  const timeout = cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError");
  return new SourceFetchError({
    provider: "rapidapi",
    code: timeout ? "RAPIDAPI_TIMEOUT" : "RAPIDAPI_NETWORK_ERROR",
    message: timeout ? `${label} phản hồi quá thời gian cho phép.` : `Không kết nối được ${label}.`,
    httpStatus: timeout ? 504 : 503,
    retryable: true,
    retryAfterSeconds: 30,
  });
}
