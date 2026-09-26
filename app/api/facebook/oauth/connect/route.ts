import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decryptFacebookOAuthSession, discoverFacebookAssets, FACEBOOK_OAUTH_SESSION_COOKIE } from "@/lib/facebookOAuth";

export async function POST(request: NextRequest) {
  const token = decryptFacebookOAuthSession(request.cookies.get(FACEBOOK_OAUTH_SESSION_COOKIE)?.value);
  if (!token) return NextResponse.json({ error: "Phiên Facebook đã hết hạn. Hãy đăng nhập lại." }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { pageIds?: string[]; adAccountIds?: string[] };
  const pageIds = [...new Set((body.pageIds ?? []).filter((id): id is string => typeof id === "string"))];
  const adAccountIds = [...new Set((body.adAccountIds ?? []).filter((id): id is string => typeof id === "string"))];
  if (!pageIds.length && !adAccountIds.length) return NextResponse.json({ error: "Chọn ít nhất một Page hoặc TKQC." }, { status: 400 });

  try {
    const assets = await discoverFacebookAssets(token);
    const pages = pageIds.map((id) => assets.pages.find((page) => page.id === id));
    const ads = adAccountIds.map((id) => assets.adAccounts.find((account) => (account.id.startsWith("act_") ? account.id : `act_${account.account_id}`) === id));
    if (pages.some((page) => !page) || ads.some((account) => !account)) return NextResponse.json({ error: "Có tài sản không còn thuộc tài khoản Facebook này. Hãy quét lại." }, { status: 409 });

    await prisma.$transaction([
      ...pages.map((page) => prisma.fbConnection.upsert({
        where: { pageId: page!.id },
        update: { pageName: page!.name, accessToken: page!.access_token, instagramUserId: page!.instagram_business_account?.id ?? null, instagramUsername: page!.instagram_business_account?.username ?? null, instagramProfilePicture: page!.instagram_business_account?.profile_picture_url ?? null },
        create: { pageId: page!.id, pageName: page!.name, accessToken: page!.access_token, instagramUserId: page!.instagram_business_account?.id ?? null, instagramUsername: page!.instagram_business_account?.username ?? null, instagramProfilePicture: page!.instagram_business_account?.profile_picture_url ?? null },
      })),
      ...ads.map((account) => {
        const accountId = account!.id.startsWith("act_") ? account!.id : `act_${account!.account_id}`;
        return prisma.fbAdAccount.upsert({ where: { accountId }, update: { name: account!.name, accessToken: token }, create: { accountId, name: account!.name, accessToken: token } });
      }),
      prisma.metaPermissionCache.deleteMany({
        where: {
          OR: [
            ...(pageIds.length ? [{ pageId: { in: pageIds } }] : []),
            ...(adAccountIds.length ? [{ adAccountId: { in: adAccountIds.map((id) => id.replace(/^act_/, "")) } }] : []),
          ],
        },
      }),
    ]);
    const response = NextResponse.json({ ok: true, pages: pages.length, adAccounts: ads.length });
    response.cookies.set(FACEBOOK_OAUTH_SESSION_COOKIE, "", { path: "/api/facebook/oauth", maxAge: 0 });
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Không thể lưu kết nối Facebook" }, { status: 400 });
  }
}
