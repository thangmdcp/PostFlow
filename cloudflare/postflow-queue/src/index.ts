type QueueJob =
  | { type: "publish"; postId: string; publishToPage?: boolean }
  | { type: "ads"; postId: string }
  | { type: "comment"; commentId: string }
  | { type: "story"; postId: string }
  | { type: "fetch"; postId: string };
type EnqueueBody = QueueJob & { delaySeconds?: number };
interface QueueMessage { body: QueueJob; ack(): void; retry(options?: { delaySeconds?: number }): void; }
interface QueueBatch { messages: QueueMessage[]; }
interface Env {
  POSTFLOW_PUBLISH_QUEUE: { send(message: QueueJob, options?: { delaySeconds?: number }): Promise<void> };
  POSTFLOW_FETCH_QUEUE: { send(message: QueueJob, options?: { delaySeconds?: number }): Promise<void> };
  POSTFLOW_QUEUE_SECRET: string;
  POSTFLOW_API_URL: string;
  POSTFLOW_WORKER_SECRET: string;
  POSTFLOW_CRON_SECRET: string;
}

function validBearer(request: Request, expected: string) {
  return request.headers.get("authorization") === `Bearer ${expected}`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/enqueue") return new Response("Not found", { status: 404 });
    if (!validBearer(request, env.POSTFLOW_QUEUE_SECRET)) return new Response("Unauthorized", { status: 401 });
    const body = await request.json() as EnqueueBody;
    const valid =
      (body.type === "publish" && !!body.postId) ||
      (body.type === "ads" && !!body.postId) ||
      (body.type === "comment" && !!body.commentId) ||
      (body.type === "story" && !!body.postId) ||
      (body.type === "fetch" && !!body.postId);
    if (!valid) return Response.json({ error: "Invalid queue job" }, { status: 400 });
    const { delaySeconds, ...job } = body;
    const queue = job.type === "fetch" ? env.POSTFLOW_FETCH_QUEUE : env.POSTFLOW_PUBLISH_QUEUE;
    await queue.send(job, { delaySeconds: Math.max(0, Math.min(86_400, Math.floor(delaySeconds ?? 0))) });
    return Response.json({ queued: true }, { status: 202 });
  },

  async queue(batch: QueueBatch, env: Env): Promise<void> {
    for (const message of batch.messages) {
      const endpoint = message.body.type === "publish" ? "publish" : message.body.type;
      const response = await fetch(`${env.POSTFLOW_API_URL.replace(/\/$/, "")}/api/queue/${endpoint}`, {
        method: "POST",
        // POSTFLOW_QUEUE_SECRET is already proven to match Vercel's
        // CLOUDFLARE_QUEUE_SECRET by the producer /enqueue handshake. Use it
        // in both directions instead of an independently configured secret.
        headers: { "Content-Type": "application/json", "x-postflow-worker-secret": env.POSTFLOW_QUEUE_SECRET },
        body: JSON.stringify(message.body),
      });
      if (response.ok) message.ack();
      else {
        const payload = await response.json().catch(() => null) as { retryAfterSeconds?: number } | null;
        const fallbackDelay = message.body.type === "ads" ? 120 : message.body.type === "comment" ? 120 : message.body.type === "story" ? 300 : 30;
        message.retry({ delaySeconds: payload?.retryAfterSeconds ?? fallbackDelay });
      }
    }
  },

  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }): Promise<void> {
    // The scheduler lives next to the Queue so future posts do not depend on
    // a separate Hostinger/PM2 process being online.
    ctx.waitUntil(
      fetch(`${env.POSTFLOW_API_URL.replace(/\/$/, "")}/api/cron/publish`, {
        headers: { Authorization: `Bearer ${env.POSTFLOW_CRON_SECRET}` },
      }).then(async (response) => {
        if (!response.ok) throw new Error(`PostFlow cron returned ${response.status}`);
      })
    );
  },
};
