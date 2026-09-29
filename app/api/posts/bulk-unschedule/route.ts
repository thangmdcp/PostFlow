import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CANCELLABLE_POST_STATUSES, unscheduleSkipReason } from "@/lib/unscheduleEligibility";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { postIds?: string[] };
  const postIds = [...new Set(body.postIds ?? [])].filter(Boolean).slice(0, 100);
  if (!postIds.length) return NextResponse.json({ error: "Chọn ít nhất một bài" }, { status: 400 });

  const posts = await prisma.post.findMany({
    where: { id: { in: postIds } },
    select: {
      id: true, status: true, fbPostId: true, igPostId: true, igContainerId: true, fbObjectStoryId: true,
      adCampaignId: true, adSetId: true, adCreativeId: true, adId: true,
    },
  });
  const byId = new Map(posts.map((post) => [post.id, post]));

  const result = await prisma.$transaction(async (tx) => {
    const cancelledIds: string[] = [];
    const skipped: Array<{ id: string; reason: string }> = [];

    for (const id of postIds) {
      const post = byId.get(id);
      if (!post) {
        skipped.push({ id, reason: "Không tìm thấy bài" });
        continue;
      }
      const reason = unscheduleSkipReason(post);
      if (reason) {
        skipped.push({ id, reason });
        continue;
      }

      const claim = await tx.post.updateMany({
        where: {
          id,
          status: { in: [...CANCELLABLE_POST_STATUSES] },
          fbPostId: null,
          igPostId: null,
          igContainerId: null,
          fbObjectStoryId: null,
          adCampaignId: null,
          adSetId: null,
          adCreativeId: null,
          adId: null,
        },
        data: {
          status: "ready",
          pageId: null,
          scheduledAt: null,
          publishToFacebook: true,
          publishToInstagram: false,
          fbPublishStatus: null,
          fbErrorMsg: null,
          igPublishStatus: null,
          igErrorMsg: null,
          igContainerId: null,
          adTemplateId: null,
          adPlatform: "facebook",
          adDestinationUrl: null,
          adCtaType: null,
          adCampaignId: null,
          adSetId: null,
          adCreativeId: null,
          adId: null,
          adAccountUsed: null,
          adBudget: null,
          adBudgetMinor: null,
          adBudgetCurrency: null,
          adAgeMin: null,
          adAgeMax: null,
          adGender: null,
          adPlacementConfig: Prisma.DbNull,
          ctaHeadline: null,
          adStatus: null,
          adPublishStatus: null,
          adStartAt: null,
          adNextAttemptAt: null,
          adAttempt: 0,
          commentText: null,
          commentImageUrl: null,
          commentStatus: null,
          commentNextAttemptAt: null,
          commentAttempt: 0,
          commentId: null,
          storyEnabled: false,
          storyCount: null,
          storyStatus: null,
          storyNextAttemptAt: null,
          storyAttempt: 0,
          storyPostId: null,
          storyPostedAt: null,
          errorMsg: null,
        },
      });
      if (!claim.count) {
        skipped.push({ id, reason: "Trạng thái bài vừa thay đổi; hãy tải lại rồi thử lại" });
        continue;
      }
      await tx.postComment.deleteMany({ where: { postId: id, status: null } });
      cancelledIds.push(id);
    }

    return { cancelledIds, skipped };
  });

  return NextResponse.json(result);
}
