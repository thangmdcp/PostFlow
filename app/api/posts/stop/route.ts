import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Cancels any not-yet-started ad/comment retry for the given posts. Only
// touches "pending" rows (already-queued nextAttemptAt, not yet fired) —
// a "creating" row is mid-flight to Facebook's API right now and writing
// over its status here would just get clobbered when that call resolves, so
// there's nothing this can do for it. attemptAutoAds/attemptComment both
// re-check for "cancelled" before doing any work, which is what actually
// stops the waitUntil-scheduled first attempt from firing once this lands
// before its delay elapses.
export async function POST(req: Request) {
  const { ids } = (await req.json()) as { ids?: string[] };
  if (!ids?.length) return NextResponse.json({ ok: true });

  await prisma.post.updateMany({
    where: { id: { in: ids }, adStatus: "pending" },
    data: { adStatus: "cancelled", adNextAttemptAt: null, errorMsg: "[ads] Đã dừng theo yêu cầu" },
  });
  await prisma.postComment.updateMany({
    where: { postId: { in: ids }, status: "pending" },
    data: { status: "cancelled", nextAttemptAt: null, errorMsg: "[comment] Đã dừng theo yêu cầu" },
  });

  return NextResponse.json({ ok: true });
}
