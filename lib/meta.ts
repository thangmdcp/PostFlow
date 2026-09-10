export const META_GRAPH_API_VERSION =
  process.env.META_GRAPH_API_VERSION ??
  "v25.0";

export const META_GRAPH_API = `https://graph.facebook.com/${META_GRAPH_API_VERSION}`;
export const META_GRAPH_VIDEO_API = `https://graph-video.facebook.com/${META_GRAPH_API_VERSION}`;

export function metaGraphUrl(path: string): string {
  return `${META_GRAPH_API}/${path.replace(/^\//, "")}`;
}
