import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decryptFacebookOAuthSession, discoverFacebookAssets, FACEBOOK_OAUTH_SESSION_COOKIE } from "@/lib/facebookOAuth";

export async function GET(request: NextRequest) {
  const token = decryptFacebookOAuthSession(request.cookies.get(FACEBOOK_OAUTH_SESSION_COOKIE)?.value);
  if (!token) return NextResponse.json({ error: "Phiên Facebook đã hết hạn. Hãy đăng nhập lại." }, { status: 401 });
  try {
    const [assets, savedPages, savedAds] = await Promise.all([
      discoverFacebookAssets(token),
      prisma.fbConnection.findMany({ select: { pageId: true } }),
      prisma.fbAdAccount.findMany({ select: { accountId: true } }),
    ]);
    const savedPageIds = new Set(savedPages.map((item) => item.pageId));
    const savedAdIds = new Set(savedAds.map((item) => item.accountId));
    return NextResponse.json({
      pages: assets.pages.map(({ access_token: _token, ...page }) => ({ ...page, saved: savedPageIds.has(page.id) })),
      adAccounts: assets.adAccounts.map((account) => ({ ...account, saved: savedAdIds.has(account.id.startsWith("act_") ? account.id : `act_${account.account_id}`) })),
      grantedPermissions: assets.grantedPermissions,
      missingPermissions: assets.missingPermissions,
      warnings: assets.warnings,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Không thể đọc tài sản Facebook" }, { status: 400 });
  }
}
