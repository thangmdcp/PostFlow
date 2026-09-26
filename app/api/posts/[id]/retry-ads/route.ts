import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enqueueAds } from "@/lib/cloudflareQueue";
import { validateAdSelection } from "@/lib/adSelection";
import { preflightPostAdPermission } from "@/lib/adPermissionPreflight";
import { MetaApiError } from "@/lib/metaApiClient";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({})) as { adAccountId?: string; templateId?: string; delaySeconds?: number };
  const post = await prisma.post.findUnique({ where: { id: params.id } });
  if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });
  if (!post.fbPostId && !post.igPostId) return NextResponse.json({ error: "Bài nguồn chưa đăng thành công" }, { status: 409 });
  if (post.adId || post.adStatus === "done") return NextResponse.json({ error: "Ads đã tồn tại; không tạo trùng" }, { status: 409 });
  if (!body.adAccountId || post.adAccountUsed !== body.adAccountId || !body.templateId || post.adTemplateId !== body.templateId) {
    return NextResponse.json({ error: "Snapshot TKQC/template không khớp yêu cầu retry" }, { status: 409 });
  }
  const selectionError = await validateAdSelection(post.adTemplateId ?? undefined, post.adAccountUsed ?? undefined);
  if (selectionError) return NextResponse.json({ error: selectionError }, { status: 400 });
  try {
    await preflightPostAdPermission(post, true);
  } catch (error) {
    const status = error instanceof MetaApiError && ["rate_limit", "transient"].includes(error.category) ? 503 : 409;
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Không kiểm tra được quyền quảng cáo",
      ...(error instanceof MetaApiError ? { code: error.code, subcode: error.subcode, fbtrace_id: error.fbtraceId, retryAfterSeconds: error.retryAfterSeconds } : {}),
    }, { status });
  }

  const claim = await prisma.post.updateMany({
    where: { id: post.id, adId: null, adStatus: { in: ["pending", "failed"] } },
    data: { adStatus: "queued", adNextAttemptAt: null, errorMsg: null },
  });
  if (!claim.count) return NextResponse.json({ error: "Ads đang được xử lý ở nơi khác" }, { status: 409 });
  const delaySeconds = Math.max(0, Math.min(3600, Math.floor(body.delaySeconds ?? 0)));
  if (!await enqueueAds(post.id, delaySeconds)) {
    await prisma.post.updateMany({ where: { id: post.id, adStatus: "queued" }, data: { adStatus: "pending" } });
    return NextResponse.json({ error: "Không thể đưa Ads vào Queue" }, { status: 503 });
  }
  return NextResponse.json({ ok: true, queued: true, delaySeconds }, { status: 202 });
}
