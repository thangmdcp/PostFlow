import { autodownExtract, autodownDownload } from "@/lib/autodown";

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

// AutoDown is the preferred path for public FB/TikTok videos (no watermark,
// already hosted on Cloudinary). It only supports that one case, so any
// failure or non-video result falls straight through to RapidAPI unchanged.
async function fetchViaAutoDown(url: string): Promise<RapidApiPostData | null> {
  const meta = await autodownExtract(url);
  if (!meta || meta.type !== "video") return null;

  const downloaded = await autodownDownload(url);
  if (!downloaded || !downloaded.media?.length) return null;

  const media: RapidApiMedia[] = downloaded.media.map((m) => ({
    url: m.url,
    type: m.type,
    publicId: m.public_id,
  }));
  return { caption: downloaded.caption ?? meta.caption ?? "", media };
}

async function fetchFacebookPost(url: string): Promise<RapidApiPostData> {
  const res = await fetch(
    `https://facebook-scraper3.p.rapidapi.com/post?post_url=${encodeURIComponent(url)}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-rapidapi-key": process.env.RAPIDAPI_KEY!,
        "x-rapidapi-host": "facebook-scraper3.p.rapidapi.com",
      },
    }
  );

  if (!res.ok) throw new Error(`FB API error: ${res.status} ${res.statusText}`);

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
  const res = await fetch(
    "https://social-download-all-in-one.p.rapidapi.com/v1/social/autolink",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-rapidapi-key": process.env.RAPIDAPI_KEY!,
        "x-rapidapi-host": process.env.RAPIDAPI_HOST!,
      },
      body: JSON.stringify({ url }),
    }
  );

  if (!res.ok) throw new Error(`RapidAPI error: ${res.status} ${res.statusText}`);

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

export async function fetchPostData(url: string): Promise<RapidApiPostData> {
  const isFb = isFacebookUrl(url);
  if (isFb || isTikTokUrl(url)) {
    const viaAutoDown = await fetchViaAutoDown(url);
    if (viaAutoDown) return viaAutoDown;
  }
  if (isFb) {
    return fetchFacebookPost(url);
  }
  return fetchGenericPost(url);
}
