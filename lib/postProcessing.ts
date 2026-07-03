import { fetchPostData } from "@/lib/rapidapi";
import { extractLinks } from "@/lib/extractLinks";

export interface FetchedPostFields {
  title: string | null;
  rawCaption: string;
  stableMediaUrl: string | null;
  thumbnailUrl: string | null;
  mediaUrls: string | null;
  mediaType: string | null;
  cloudinaryId: string | null;
  links: string[];
}

// Shared by batch creation and retry — fetches the post's data and picks the
// best media (raw URLs only; the app's own Cloudinary upload happens at
// publish time). AutoDown-sourced videos already come with a `temp/`
// Cloudinary public_id, which routes cleanup/skip-reupload logic downstream.
export async function fetchPostFields(sourceUrl: string): Promise<FetchedPostFields> {
  const data = await fetchPostData(sourceUrl);
  const caption = data.caption ?? "";
  const links = extractLinks(caption);

  const videos = data.media.filter((m) => m.type === "video");
  const photos = data.media.filter((m) => m.type === "photo");
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

  if (bestVideo) {
    stableMediaUrl = bestVideo.url ?? null;
    mediaType = "video";
    thumbnailUrl = photos[0]?.url ?? bestVideo.thumbnail ?? null;
    cloudinaryId = bestVideo.publicId ?? null;
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
  };
}
