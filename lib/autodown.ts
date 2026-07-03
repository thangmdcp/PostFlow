const BASE_URL = "https://autodown.vibevic.com";

function headers() {
  return {
    "Content-Type": "application/json",
    "X-API-Key": process.env.AUTODOWN_API_KEY ?? "",
  };
}

export interface AutoDownExtractResult {
  success: boolean;
  platform: string;
  type: string;
  caption: string;
  thumbnail: string;
  mediaCount: number;
}

export interface AutoDownMedia {
  type: string;
  url: string;
  public_id: string;
}

export interface AutoDownDownloadResult {
  success: boolean;
  caption: string;
  type: string;
  media: AutoDownMedia[];
}

// Metadata only — no download, no Cloudinary side effect. Used to cheaply
// detect whether a URL is an AutoDown-eligible public video before committing
// to a download.
export async function autodownExtract(url: string): Promise<AutoDownExtractResult | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/extract`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ url }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.success) return null;
    return data as AutoDownExtractResult;
  } catch {
    return null;
  }
}

// Downloads + uploads to AutoDown's Cloudinary in one call. Can take up to
// ~60s per the API guide.
export async function autodownDownload(url: string): Promise<AutoDownDownloadResult | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/download`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.success) return null;
    return data as AutoDownDownloadResult;
  } catch {
    return null;
  }
}

// Deletes AutoDown-side Cloudinary assets by public_id. Fire-and-forget is
// fine — a failed cleanup just leaves a temp/ asset for AutoDown's own
// housekeeping, it doesn't affect our app state.
export async function autodownCleanup(publicIds: string[]): Promise<void> {
  if (publicIds.length === 0) return;
  try {
    await fetch(`${BASE_URL}/api/cleanup`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ public_ids: publicIds }),
    });
  } catch { /* best-effort */ }
}

// AutoDown's own Cloudinary public_ids are always prefixed "temp/" — use that
// as the tag to route cleanup/refresh logic away from our own Cloudinary account.
export function isAutoDownAsset(publicId: string | null | undefined): publicId is string {
  return !!publicId && publicId.startsWith("temp/");
}
