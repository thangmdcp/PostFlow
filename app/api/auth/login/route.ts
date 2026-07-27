import { NextResponse } from "next/server";
import { COOKIE_NAME, createAdminSession, hasAdminAuthConfig, verifyAdminEmail, verifyAdminPassword } from "@/lib/adminAuth";

export async function POST(request: Request) {
  if (!hasAdminAuthConfig()) {
    return NextResponse.json({ error: "Thiếu cấu hình đăng nhập trên server." }, { status: 503 });
  }
  const { email, password } = await request.json() as { email?: string; password?: string };
  if (!email || !password || !verifyAdminEmail(email) || !verifyAdminPassword(password)) {
    return NextResponse.json({ error: "Email hoặc mật khẩu không đúng" }, { status: 401 });
  }
  const session = createAdminSession();
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, session.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: session.maxAge,
  });
  return response;
}
