import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enqueueAds } from "@/lib/cloudflareQueue";
import { validateAdSelection } from "@/lib/adSelection";
import { preflightPostAdPermission } from "@/lib/adPermissionPreflight";
import { MetaApiError } from "@/lib/metaApiClient";
import {
  BudgetPolicyError,
  getVerifiedAdAccountPolicy,
  validateMinorBudgetForAccount,
} from "@/lib/adBudgetPolicy";
import { resolveAdCtaScope } from "@/lib/adCta";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({})) as { adAccountId?: string; templateId?: string; delaySeconds?: number };
  const post = await prisma.post.findUnique({ where: { id: params.id } });
  if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });
  if (!post.fbPostId && !post.igPostId) return NextResponse.json({ error: "Bài nguồn chưa đăng thành công" }, { status: 409 });
  const retryAds = !post.adId && ["pending", "failed"].includes(post.adStatus ?? "");
  const retryFacebookCta = resolveAdCtaScope(post.adCtaScope) === "AD_AND_FACEBOOK_POST"
    && post.adCtaType !== "NO_BUTTON"
    && Boolean(post.fbPostId && post.fbMediaId && post.adDestinationUrl)
    && !post.fbCtaVerifiedAt;
  if (!retryAds && !retryFacebookCta) {
    return NextResponse.json({ error: post.adId ? "Ads đã tồn tại và CTA bài Page đã được xác minh" : "Không có Ads hoặc CTA bài Page cần thử lại" }, { status: 409 });
  }
  if (retryAds && (!body.adAccountId || post.adAccountUsed !== body.adAccountId || !body.templateId || post.adTemplateId !== body.templateId)) {
    return NextResponse.json({ error: "Snapshot TKQC/template không khớp yêu cầu retry" }, { status: 409 });
  }
  if (retryAds && (!post.adBudgetMinor || !post.adBudgetCurrency)) {
    return NextResponse.json({
      error: "Bài cũ chưa có snapshot ngân sách/currency an toàn; không thể retry tự động. Hãy tạo ads mới sau khi xác nhận trần TKQC.",
      code: "BUDGET_SNAPSHOT_MISSING",
    }, { status: 409 });
  }
  if (retryAds) {
    const selectionError = await validateAdSelection(post.adTemplateId ?? undefined, post.adAccountUsed ?? undefined);
    if (selectionError) return NextResponse.json({ error: selectionError }, { status: 400 });
    try {
      const account = await getVerifiedAdAccountPolicy(post.adAccountUsed!);
      validateMinorBudgetForAccount({
        account,
        amountMinor: post.adBudgetMinor!,
        currency: post.adBudgetCurrency!,
      });
      await preflightPostAdPermission(post, true);
    } catch (error) {
      const status = error instanceof BudgetPolicyError
        ? error.status
        : error instanceof MetaApiError && ["rate_limit", "transient"].includes(error.category) ? 503 : 409;
      return NextResponse.json({
        error: error instanceof Error ? error.message : "Không kiểm tra được quyền quảng cáo",
        ...(error instanceof BudgetPolicyError ? { code: error.code } : {}),
        ...(error instanceof MetaApiError ? { code: error.code, subcode: error.subcode, fbtrace_id: error.fbtraceId, retryAfterSeconds: error.retryAfterSeconds } : {}),
      }, { status });
    }
  }

  if (retryAds) {
    const claim = await prisma.post.updateMany({
      where: { id: post.id, adId: null, adStatus: { in: ["pending", "failed"] } },
      data: { adStatus: "queued", adNextAttemptAt: null, errorMsg: null },
    });
    if (!claim.count) return NextResponse.json({ error: "Ads đang được xử lý ở nơi khác" }, { status: 409 });
  }
  if (retryFacebookCta) {
    await prisma.post.update({
      where: { id: post.id },
      data: {
        fbCtaStatus: "pending", fbCtaAttempt: 0, fbCtaNextAttemptAt: null,
        fbCtaErrorMsg: null, fbCtaVerifiedAt: null,
      },
    });
  }
  const delaySeconds = Math.max(0, Math.min(3600, Math.floor(body.delaySeconds ?? 0)));
  if (!await enqueueAds(post.id, delaySeconds)) {
    if (retryAds) await prisma.post.updateMany({ where: { id: post.id, adStatus: "queued" }, data: { adStatus: "pending" } });
    if (retryFacebookCta) await prisma.post.update({ where: { id: post.id }, data: { fbCtaStatus: "failed", fbCtaErrorMsg: "Không thể đưa lượt xác minh CTA vào Queue." } });
    return NextResponse.json({ error: "Không thể đưa Ads vào Queue" }, { status: 503 });
  }
  return NextResponse.json({ ok: true, queued: true, retryAds, retryFacebookCta, delaySeconds }, { status: 202 });
}
