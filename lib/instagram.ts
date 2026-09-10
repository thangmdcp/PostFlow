import { META_GRAPH_API } from "@/lib/meta";

export type InstagramMediaType = "image" | "video" | "carousel";

export interface InstagramPublishInput {
  instagramUserId: string;
  accessToken: string;
  caption: string;
  mediaType: InstagramMediaType;
  mediaUrls: string[];
  existingContainerId?: string | null;
  onContainerCreated?: (containerId: string) => Promise<void>;
  onMediaPublished?: (mediaId: string) => Promise<void>;
}

export interface InstagramPublishResult {
  containerId: string;
  mediaId: string;
  permalink: string;
}

export class InstagramPublishError extends Error {
  retryable: boolean;

  constructor(message: string, retryable = false) {
    super(message);
    this.name = "InstagramPublishError";
    this.retryable = retryable;
  }
}

async function graphRequest<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new InstagramPublishError(error instanceof Error ? error.message : "Không kết nối được Instagram API", true);
  }
  const json = await response.json().catch(() => ({})) as T & { error?: { message?: string; code?: number; is_transient?: boolean } };
  if (!response.ok || json.error) {
    const retryable = response.status >= 500 || response.status === 429 || Boolean(json.error?.is_transient) || json.error?.code === 4 || json.error?.code === 17 || json.error?.code === 32;
    throw new InstagramPublishError(json.error?.message ?? `Instagram API ${response.status}`, retryable);
  }
  return json;
}

async function createContainer(userId: string, token: string, body: Record<string, unknown>): Promise<string> {
  const json = await graphRequest<{ id: string }>(`${META_GRAPH_API}/${userId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, access_token: token }),
  });
  if (!json.id) throw new InstagramPublishError("Instagram không trả về media container");
  return json.id;
}

async function waitForContainer(containerId: string, token: string): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const json = await graphRequest<{ status_code?: string; status?: string }>(
      `${META_GRAPH_API}/${containerId}?fields=status_code,status&access_token=${encodeURIComponent(token)}`
    );
    if (json.status_code === "FINISHED") return;
    if (json.status_code === "PUBLISHED") {
      throw new InstagramPublishError("Container Instagram đã được publish; PostFlow dừng để tránh đăng trùng.");
    }
    if (json.status_code === "ERROR" || json.status_code === "EXPIRED") {
      throw new InstagramPublishError(json.status ?? `Instagram container ${json.status_code}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new InstagramPublishError("Instagram vẫn đang xử lý media", true);
}

async function createPublishContainer(input: InstagramPublishInput): Promise<string> {
  if (input.mediaType === "image") {
    return createContainer(input.instagramUserId, input.accessToken, {
      image_url: input.mediaUrls[0], caption: input.caption,
    });
  }
  if (input.mediaType === "video") {
    return createContainer(input.instagramUserId, input.accessToken, {
      media_type: "REELS", video_url: input.mediaUrls[0], caption: input.caption, share_to_feed: true,
    });
  }
  if (input.mediaUrls.length > 10) throw new InstagramPublishError("Instagram chỉ hỗ trợ tối đa 10 ảnh trong carousel");
  const children = await Promise.all(input.mediaUrls.map((imageUrl) =>
    createContainer(input.instagramUserId, input.accessToken, {
      image_url: imageUrl, is_carousel_item: true,
    })
  ));
  await Promise.all(children.map((child) => waitForContainer(child, input.accessToken)));
  return createContainer(input.instagramUserId, input.accessToken, {
    media_type: "CAROUSEL", children, caption: input.caption,
  });
}

export async function publishToInstagram(input: InstagramPublishInput): Promise<InstagramPublishResult> {
  if (!input.mediaUrls.length) throw new InstagramPublishError("Instagram yêu cầu bài có ảnh hoặc video");
  const containerId = input.existingContainerId ?? await createPublishContainer(input);
  if (!input.existingContainerId) await input.onContainerCreated?.(containerId);
  await waitForContainer(containerId, input.accessToken);
  const published = await graphRequest<{ id: string }>(`${META_GRAPH_API}/${input.instagramUserId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: containerId, access_token: input.accessToken }),
  });
  await input.onMediaPublished?.(published.id);
  let permalink = "";
  try {
    const media = await graphRequest<{ permalink?: string }>(
      `${META_GRAPH_API}/${published.id}?fields=permalink&access_token=${encodeURIComponent(input.accessToken)}`
    );
    permalink = media.permalink ?? "";
  } catch {
    // Publishing already succeeded. A permalink lookup failure must not cause
    // the queue to publish the same container again.
  }
  return { containerId, mediaId: published.id, permalink };
}
