export interface FetchMediaAsset {
  sourceUrl: string;
  url: string;
  publicId: string;
  resourceType: "image";
  order: number;
  provider: "autodown" | "rapidapi";
  extractor: string;
}

export function readFetchMediaManifest(value: unknown): FetchMediaAsset[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is FetchMediaAsset => !!item && typeof item === "object"
    && typeof item.sourceUrl === "string" && typeof item.url === "string"
    && typeof item.publicId === "string" && item.resourceType === "image"
    && Number.isInteger(item.order) && (item.provider === "autodown" || item.provider === "rapidapi"));
}

export function fetchMediaCanBeCleaned(post: {
  status: string; adStatus: string | null; adId: string | null;
  storyEnabled: boolean | null; storyStatus: string | null;
}): boolean {
  return post.status === "done" && (!post.adStatus || (post.adStatus === "done" && !!post.adId))
    && (!post.storyEnabled || post.storyStatus === "done");
}
