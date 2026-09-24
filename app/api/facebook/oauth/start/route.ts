import { NextRequest, NextResponse } from "next/server";
import { createFacebookOAuthState, FACEBOOK_OAUTH_MAX_AGE, FACEBOOK_OAUTH_STATE_COOKIE, facebookOAuthUrl, facebookRedirectUri, hasFacebookOAuthConfig } from "@/lib/facebookOAuth";

export const dynamic = "force-dynamic";

function popupError(message: string) {
  const payload = JSON.stringify({ type: "postflow-facebook-oauth", ok: false, error: message }).replace(/</g, "\\u003c");
  return new NextResponse(`<script>window.opener?.postMessage(${payload}, window.location.origin);window.close()</script><p>${message}</p>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}

export async function GET(request: NextRequest) {
  if (!hasFacebookOAuthConfig()) return popupError("PostFlow chưa cấu hình Facebook App ID/Secret.");
  const { state, cookieValue } = createFacebookOAuthState();
  const response = NextResponse.redirect(facebookOAuthUrl(facebookRedirectUri(request.nextUrl.origin), state, request.nextUrl.searchParams.get("rerequest") === "1"));
  response.headers.set("cache-control", "no-store");
  response.headers.set("referrer-policy", "no-referrer");
  response.cookies.set(FACEBOOK_OAUTH_STATE_COOKIE, cookieValue, { httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax", path: "/api/facebook/oauth", maxAge: FACEBOOK_OAUTH_MAX_AGE });
  return response;
}
