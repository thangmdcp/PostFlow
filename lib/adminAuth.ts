import { createHmac, timingSafeEqual } from "crypto";

const COOKIE_NAME = "postflow_admin";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

function signingSecret() {
  return process.env.POSTFLOW_AUTH_SECRET || process.env.NEXTAUTH_SECRET || "";
}

export function hasAdminAuthConfig() {
  return Boolean(process.env.POSTFLOW_ADMIN_PASSWORD && process.env.POSTFLOW_ADMIN_EMAILS && signingSecret());
}

export function verifyAdminEmail(email: string) {
  const allowedEmails = (process.env.POSTFLOW_ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return allowedEmails.includes(email.trim().toLowerCase());
}

export function verifyAdminPassword(password: string) {
  const expected = process.env.POSTFLOW_ADMIN_PASSWORD ?? "";
  if (!expected || password.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(password), Buffer.from(expected));
}

export function createAdminSession() {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS })).toString("base64url");
  const signature = createHmac("sha256", signingSecret()).update(payload).digest("base64url");
  return { value: `${payload}.${signature}`, maxAge: MAX_AGE_SECONDS };
}

export { COOKIE_NAME };
