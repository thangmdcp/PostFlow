import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { persistCommentJobs } from "@/lib/autoCommentsRunner";
import { publishDuePost } from "@/lib/publishDuePost";
import { parsePublishTargets, validatePublishTargets, type PublishTarget } from "@/lib/publishTargets";
import { validateAdSelection } from "@/lib/adSelection";
import { resolveAdBudgetSnapshot, type AdBudgetInput } from "@/lib/adBudgetRequest";
import { BudgetPolicyError } from "@/lib/adBudgetPolicy";
import { validateAdCta, validateAdCtaScope, type AdCtaScope, type AdCtaType } from "@/lib/adCta";
import { ensureSponsoredContentHashtag } from "@/lib/sponsoredContent";

export const maxDuration = 90;

interface PublishBody {
  pageId: string;
  publishTargets?: PublishTarget[];
  templateId?: string;
  publishToPage?: boolean;
  adAccountId?: string;
  ageMinFrom?: string;
  ageMaxFrom?: string;
  gender?: string;
  budget?: AdBudgetInput;
  ctaHeadline?: string;
  adCtaType?: AdCtaType;
  adCtaScope?: AdCtaScope;
  adStatus?: "ACTIVE" | "PAUSED";
  comments?: { text: string; imageUrl?: string }[];
  storyEnabled?: boolean;
  storyCount?: number;
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json() as PublishBody;
    const post = await prisma.post.findUnique({ where: { id: params.id }, include: { extractedLinks: true } });
    if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });
    if (!post.finalCaption) return NextResponse.json({ error: "Chưa có caption. Hãy lưu link aff trước." }, { status: 400 });
    if (post.extractedLinks.some((link) => !link.myUrl || post.finalCaption!.includes(link.competitorUrl))) {
      return NextResponse.json({ error: "Còn link affiliate chưa hoàn tất." }, { status: 400 });
    }
    const connection = await prisma.fbConnection.findUnique({ where: { pageId: body.pageId } });
    if (!connection) return NextResponse.json({ error: "Không tìm thấy kết nối Facebook Page" }, { status: 400 });
    const targets = parsePublishTargets(body.publishTargets, post);
    const targetError = validatePublishTargets(
      post,
      connection,
      targets,
      Boolean(body.templateId),
      post.extractedLinks.some((link) => Boolean(link.myUrl))
    );
    if (targetError) return NextResponse.json({ error: targetError }, { status: 400 });
    const adSelectionError = await validateAdSelection(body.templateId, body.adAccountId);
    if (adSelectionError) return NextResponse.json({ error: adSelectionError }, { status: 400 });
    const budgetSnapshot = await resolveAdBudgetSnapshot({
      templateId: body.templateId,
      accountId: body.adAccountId,
      budget: body.budget,
    });
    const destinationUrl = body.templateId ? post.extractedLinks.find((link) => link.myUrl)?.myUrl ?? null : null;
    const cta = validateAdCta({ ctaType: body.adCtaType, destinationUrl, adsEnabled: Boolean(body.templateId) });
    if (cta.error) return NextResponse.json({ error: cta.error }, { status: 400 });
    const selectedTemplate = body.templateId ? await prisma.campaignTemplate.findFirst({ where: { campaignId: body.templateId }, select: { settings: true } }) : null;
    const templatePostType = (selectedTemplate?.settings as Record<string, unknown> | null)?.postType;
    const ctaScope = validateAdCtaScope({
      scope: body.adCtaScope,
      ctaType: cta.ctaType,
      publishToFacebook: targets.includes("facebook"),
      publishedToPage: body.publishToPage === true || templatePostType !== "dark",
    });
    if (body.templateId && ctaScope.error) return NextResponse.json({ error: ctaScope.error }, { status: 400 });

    const queued = await prisma.post.update({ where: { id: post.id }, data: {
      pageId: body.pageId,
      finalCaption: ensureSponsoredContentHashtag(post.finalCaption),
      sponsoredContentTagEnabled: true,
      status: "queued",
      publishToFacebook: targets.includes("facebook"),
      publishToInstagram: targets.includes("instagram"),
      adPlatform: targets.length === 1 && targets[0] === "instagram" ? "instagram" : "facebook",
      adDestinationUrl: destinationUrl,
      adCtaType: body.templateId ? cta.ctaType : null,
      adCtaScope: body.templateId ? ctaScope.scope : null,
      fbCtaStatus: body.templateId && ctaScope.scope === "AD_AND_FACEBOOK_POST" ? "pending" : null,
      fbCtaErrorMsg: null,
      fbCtaNextAttemptAt: null,
      fbCtaAttempt: 0,
      adCampaignId: null,
      adSetId: null,
      adCreativeId: null,
      adId: null,
      adStatus: null,
      adNextAttemptAt: null,
      adAttempt: 0,
      fbPublishStatus: targets.includes("facebook") ? "pending" : null,
      igPublishStatus: targets.includes("instagram") ? "pending" : null,
      adTemplateId: body.templateId ?? null,
      adAccountUsed: body.adAccountId ?? null,
      adAgeMin: body.ageMinFrom ? Number(body.ageMinFrom) : null,
      adAgeMax: body.ageMaxFrom ? Number(body.ageMaxFrom) : null,
      adGender: body.gender ?? null,
      adBudget: budgetSnapshot?.amountMajor ?? null,
      adBudgetMinor: budgetSnapshot?.amountMinor ?? null,
      adBudgetCurrency: budgetSnapshot?.currency ?? null,
      adPublishStatus: body.adStatus ?? null,
      ctaHeadline: body.ctaHeadline ?? null,
      storyEnabled: body.storyEnabled ?? false,
      storyCount: body.storyCount ?? null,
      errorMsg: null,
    } });
    if (body.comments) await persistCommentJobs(post.id, body.comments);
    const result = await publishDuePost(queued, { publishToPage: body.publishToPage });
    return NextResponse.json(result, { status: result.status === "failed" ? 502 : 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Không thể đăng bài", ...(error instanceof BudgetPolicyError ? { code: error.code } : {}) },
      { status: error instanceof BudgetPolicyError ? error.status : 500 },
    );
  }
}
