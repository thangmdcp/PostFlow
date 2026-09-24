import { NextRequest, NextResponse } from "next/server";
import { discoverFacebookAssets, encryptFacebookOAuthSession, FACEBOOK_OAUTH_MAX_AGE, FACEBOOK_OAUTH_SESSION_COOKIE } from "@/lib/facebookOAuth";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { accessToken?: string };
  const token = body.accessToken?.trim();
  if (!token) return NextResponse.json({ error: "Nhập Access Token trước." }, { status: 400 });
  try {
    await discoverFacebookAssets(token);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(FACEBOOK_OAUTH_SESSION_COOKIE, encryptFacebookOAuthSession(token), { httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax", path: "/api/facebook/oauth", maxAge: FACEBOOK_OAUTH_MAX_AGE });
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Token Facebook không hợp lệ" }, { status: 400 });
  }
}
