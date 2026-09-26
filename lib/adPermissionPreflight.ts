import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ensureAdAssetAccess } from "@/lib/facebook";

type PostPermissionSnapshot = {
  pageId: string | null;
  adAccountUsed: string | null;
  adPlatform: string | null;
  adPlacementConfig?: Prisma.JsonValue | null;
};

function placementsNeedInstagram(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const platforms = (value as Record<string, unknown>).publisherPlatforms;
  return Array.isArray(platforms) && platforms.some((platform) => platform === "instagram" || platform === "threads");
}

export async function preflightPostAdPermission(post: PostPermissionSnapshot, forceRefresh = false) {
  if (!post.pageId) throw new Error("Bài chưa có Page để kiểm tra quyền quảng cáo.");
  if (!post.adAccountUsed) throw new Error("Bài chưa có snapshot tài khoản quảng cáo.");
  const normalizedId = post.adAccountUsed.replace(/^act_/, "");
  const [account, page] = await Promise.all([
    prisma.fbAdAccount.findFirst({ where: { OR: [{ accountId: post.adAccountUsed }, { accountId: normalizedId }, { accountId: `act_${normalizedId}` }] } }),
    prisma.fbConnection.findUnique({ where: { pageId: post.pageId } }),
  ]);
  if (!account?.accessToken) throw new Error("TKQC chưa kết nối hoặc thiếu token. Hãy kết nối lại Facebook.");
  if (!page) throw new Error("Page chưa được kết nối trong PostFlow.");
  const needsInstagram = post.adPlatform === "instagram" || placementsNeedInstagram(post.adPlacementConfig);
  if (needsInstagram && !page.instagramUserId) throw new Error("Page chưa liên kết Instagram Professional.");
  await ensureAdAssetAccess(post.adAccountUsed, post.pageId, needsInstagram ? page.instagramUserId ?? undefined : undefined, account.accessToken, { forceRefresh });
}
