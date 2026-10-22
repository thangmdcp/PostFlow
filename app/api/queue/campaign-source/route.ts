import { NextResponse } from "next/server";
import { processCampaignSource, enqueueCampaignSource } from "@/lib/campaignImport";
export const maxDuration = 90;
export async function POST(request: Request) {
  if (!process.env.CLOUDFLARE_QUEUE_SECRET || request.headers.get("x-postflow-worker-secret") !== process.env.CLOUDFLARE_QUEUE_SECRET) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { sourceId } = await request.json();
  if (typeof sourceId !== "string") return NextResponse.json({ error: "sourceId required" }, { status: 400 });
  const result = await processCampaignSource(sourceId);
  // Pagination and quota waits are continuations, not failures. Keep Cloudflare's
  // delivery retry budget for HTTP/worker outages; DB owns the bounded API retries.
  if (result.retry && await enqueueCampaignSource(sourceId, result.retryAfterSeconds)) return NextResponse.json({ continued: true });
  return NextResponse.json(result, { status: result.retry ? 503 : 200 });
}
