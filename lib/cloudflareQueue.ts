const QUEUE_PATH = "/enqueue";

export type PostflowQueueJob =
  | { type: "publish"; postId: string; publishToPage?: boolean }
  | { type: "ads"; postId: string }
  | { type: "comment"; commentId: string }
  | { type: "story"; postId: string }
  | { type: "fetch"; postId: string };

/** Sends a lightweight delayed job to the Cloudflare producer Worker.
 * Supabase remains the source of truth; Queue only delivers the work. */
export async function enqueueQueueJob(job: PostflowQueueJob, delaySeconds = 0): Promise<boolean> {
  const baseUrl = process.env.CLOUDFLARE_QUEUE_WORKER_URL?.replace(/\/$/, "");
  const secret = process.env.CLOUDFLARE_QUEUE_SECRET;
  if (!baseUrl || !secret) return false;

  try {
    const response = await fetch(`${baseUrl}${QUEUE_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ ...job, delaySeconds: Math.max(0, Math.min(86_400, Math.floor(delaySeconds))) }),
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function enqueuePublish(postId: string, options: { publishToPage?: boolean } = {}): Promise<boolean> {
  return enqueueQueueJob({ type: "publish", postId, ...options });
}

export function enqueueComment(commentId: string, delaySeconds: number): Promise<boolean> {
  return enqueueQueueJob({ type: "comment", commentId }, delaySeconds);
}

export function enqueueStory(postId: string, delaySeconds: number): Promise<boolean> {
  return enqueueQueueJob({ type: "story", postId }, delaySeconds);
}

export function enqueueAds(postId: string, delaySeconds: number): Promise<boolean> {
  return enqueueQueueJob({ type: "ads", postId }, delaySeconds);
}

export function enqueueFetch(postId: string): Promise<boolean> {
  return enqueueQueueJob({ type: "fetch", postId });
}
