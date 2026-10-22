type QueueJob =
  | { type: "fetch-pump"; provider:"flully"|"render" }
  | { type: "campaign-source"; sourceId: string }
  | { type: "publish"; postId: string; publishToPage?: boolean }
  | { type: "ads"; postId: string }
  | { type: "comment"; commentId: string }
  | { type: "story"; postId: string }
  | { type: "fetch"; postId: string; stage?: "download" | "upload" | "render" | "legacy" };
type EnqueueBody = QueueJob & { delaySeconds?: number };
interface QueueMessage { body: QueueJob; ack(): void; retry(options?: { delaySeconds?: number }): void; }
interface QueueBatch { queue?: string; messages: QueueMessage[]; }
interface Env {
  POSTFLOW_PUBLISH_QUEUE: { send(message: QueueJob, options?: { delaySeconds?: number }): Promise<void> };
  POSTFLOW_ADS_QUEUE: { send(message: QueueJob, options?: { delaySeconds?: number }): Promise<void> };
  POSTFLOW_ENGAGEMENT_QUEUE: { send(message: QueueJob, options?: { delaySeconds?: number }): Promise<void> };
  POSTFLOW_FETCH_QUEUE: { send(message: QueueJob, options?: { delaySeconds?: number }): Promise<void> };
  POSTFLOW_DOWNLOAD_QUEUE: { send(message: QueueJob, options?: { delaySeconds?: number }): Promise<void> };
  POSTFLOW_UPLOAD_QUEUE: { send(message: QueueJob, options?: { delaySeconds?: number }): Promise<void> };
  POSTFLOW_RENDER_QUEUE: { send(message: QueueJob, options?: { delaySeconds?: number }): Promise<void> };
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
      (body.type === "fetch-pump" && (body.provider === "flully" || body.provider === "render")) ||
      (body.type === "campaign-source" && !!body.sourceId) ||
      (body.type === "publish" && !!body.postId) ||
      (body.type === "ads" && !!body.postId) ||
      (body.type === "comment" && !!body.commentId) ||
      (body.type === "story" && !!body.postId) ||
      (body.type === "fetch" && !!body.postId && (body.stage === undefined || body.stage === "download" || body.stage === "upload" || body.stage === "render"));
    if (!valid) return Response.json({ error: "Invalid queue job" }, { status: 400 });
    const { delaySeconds, ...job } = body;
    const queue = job.type === "fetch-pump" ? job.provider === "render" ? env.POSTFLOW_RENDER_QUEUE : env.POSTFLOW_DOWNLOAD_QUEUE : job.type === "campaign-source" ? env.POSTFLOW_FETCH_QUEUE : job.type === "fetch"
      ? job.stage === "render" ? env.POSTFLOW_RENDER_QUEUE : job.stage === "upload" ? env.POSTFLOW_UPLOAD_QUEUE : env.POSTFLOW_DOWNLOAD_QUEUE
      : job.type === "ads"
        ? env.POSTFLOW_ADS_QUEUE
        : job.type === "comment" || job.type === "story"
          ? env.POSTFLOW_ENGAGEMENT_QUEUE
          : env.POSTFLOW_PUBLISH_QUEUE;
    await queue.send(job.type === "fetch" ? { ...job, stage: job.stage ?? "download" } : job,
      { delaySeconds: Math.max(0, Math.min(86_400, Math.floor(delaySeconds ?? 0))) });
    return Response.json({ queued: true }, { status: 202 });
  },

  async queue(batch: QueueBatch, env: Env): Promise<void> {
    for (const message of batch.messages) {
      // Queue name is authoritative; stale/cross-queue deliveries cannot run
      // a source download inside the parallel upload pool.
      const job = message.body.type === "fetch-pump" ? {...message.body,provider:batch.queue === "postflow-render"?"render" as const:"flully" as const} : message.body.type === "fetch" ? { ...message.body,
        stage: batch.queue === "postflow-download" ? "download" as const
          : batch.queue === "postflow-render" ? "render" as const : batch.queue === "postflow-upload" ? "upload" as const : "legacy" as const } : message.body;
      const endpoint = message.body.type === "fetch-pump" ? "fetch" : message.body.type === "publish" ? "publish" : message.body.type;
      const response = await fetch(`${env.POSTFLOW_API_URL.replace(/\/$/, "")}/api/queue/${endpoint}`, {
        method: "POST",
        // POSTFLOW_QUEUE_SECRET is already proven to match Vercel's
        // CLOUDFLARE_QUEUE_SECRET by the producer /enqueue handshake. Use it
        // in both directions instead of an independently configured secret.
        headers: { "Content-Type": "application/json", "x-postflow-worker-secret": env.POSTFLOW_QUEUE_SECRET },
        body: JSON.stringify(job),
      });
      if (response.ok) {
        if(job.type === "fetch-pump"){
          const result=await response.json().catch(()=>null) as {fetchStatus?:string;retryAfterSeconds?:number}|null;
          if(!result?.fetchStatus)throw new Error("Invalid fetch pump response; keep delivery retryable");
          if(result && result.fetchStatus !== "skipped"){
            const queue=job.provider === "render"?env.POSTFLOW_RENDER_QUEUE:env.POSTFLOW_DOWNLOAD_QUEUE;
            await queue.send(job,{delaySeconds:result.fetchStatus === "waiting" ? Math.max(5,Math.min(300,result.retryAfterSeconds||10)):0});
          }
        }
        if (job.type === "fetch") {
          const payload = await response.json().catch(() => null) as { fetchStatus?: string; retryAfterSeconds?: number } | null;
          if (payload?.fetchStatus === "waiting") {
            // Resource contention is not a failure: delayed replacement, then
            // ack only after send succeeds. It consumes neither retry budget.
            const queue = job.stage === "render" ? env.POSTFLOW_RENDER_QUEUE : job.stage === "upload" ? env.POSTFLOW_UPLOAD_QUEUE : env.POSTFLOW_DOWNLOAD_QUEUE;
            await queue.send({ ...job, stage: job.stage === "render" ? "render" : job.stage === "upload" ? "upload" : "download" },
              { delaySeconds: Math.max(5, Math.min(300, Math.ceil(payload.retryAfterSeconds ?? 10))) });
          }
        }
        message.ack();
      }
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
