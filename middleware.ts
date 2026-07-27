import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "postflow_admin";

function base64url(bytes: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function validSession(value: string | undefined) {
  const secret = process.env.POSTFLOW_AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret || !value) return false;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = base64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  if (expected !== signature) return false;
  try { return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))).exp > Math.floor(Date.now() / 1000); } catch { return false; }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // These machine-to-machine routes validate their own bearer secrets inside
  // the route handler. They must bypass the browser-session gate here.
  if (pathname.startsWith("/api/auth/") || pathname === "/login" || pathname.startsWith("/login/") || pathname === "/api/cron/publish" || pathname === "/api/queue/publish") return NextResponse.next();
  if (!process.env.POSTFLOW_ADMIN_PASSWORD || !process.env.POSTFLOW_ADMIN_EMAILS || !process.env.POSTFLOW_AUTH_SECRET && !process.env.NEXTAUTH_SECRET) {
    return new NextResponse("PostFlow is missing login configuration.", { status: 503 });
  }
  if (await validSession(request.cookies.get(COOKIE_NAME)?.value)) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
