import { NextRequest, NextResponse } from "next/server";
import { encryptFacebookOAuthSession, exchangeFacebookCode, FACEBOOK_OAUTH_MAX_AGE, FACEBOOK_OAUTH_SESSION_COOKIE, FACEBOOK_OAUTH_STATE_COOKIE, facebookRedirectUri, verifyFacebookOAuthState } from "@/lib/facebookOAuth";

function popupResponse(request: NextRequest, ok: boolean, error?: string) {
  const payload = JSON.stringify({ type: "postflow-facebook-oauth", ok, ...(error ? { error } : {}) }).replace(/</g, "\\u003c");
  const visibleMessage = (ok ? "Đã kết nối Facebook. Bạn có thể đóng cửa sổ này." : error ?? "Đăng nhập thất bại.").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]!);
  const response = new NextResponse(`<script>window.opener?.postMessage(${payload}, ${JSON.stringify(request.nextUrl.origin)});window.close()</script><p>${visibleMessage}</p>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  response.cookies.set(FACEBOOK_OAUTH_STATE_COOKIE, "", { path: "/api/facebook/oauth", maxAge: 0 });
  return response;
}

export async function GET(request: NextRequest) {
  const state = request.nextUrl.searchParams.get("state");
  if (!verifyFacebookOAuthState(state, request.cookies.get(FACEBOOK_OAUTH_STATE_COOKIE)?.value)) return popupResponse(request, false, "Phiên đăng nhập không hợp lệ hoặc đã hết hạn.");
  const metaError = request.nextUrl.searchParams.get("error");
  if (metaError) return popupResponse(request, false, metaError === "access_denied" ? "Bạn đã hủy hoặc chưa cấp đủ quyền Facebook." : "Facebook không thể hoàn tất đăng nhập.");
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return popupResponse(request, false, "Facebook không trả authorization code.");
  try {
    const accessToken = await exchangeFacebookCode(code, facebookRedirectUri(request.nextUrl.origin));
    const response = popupResponse(request, true);
    response.cookies.set(FACEBOOK_OAUTH_SESSION_COOKIE, encryptFacebookOAuthSession(accessToken), { httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax", path: "/api/facebook/oauth", maxAge: FACEBOOK_OAUTH_MAX_AGE });
    return response;
  } catch (error) {
    return popupResponse(request, false, error instanceof Error ? error.message : "Không thể đổi token Facebook.");
  }
}
