import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";

export function createSignedOAuthState(secret: string) {
  const nonce = randomBytes(24).toString("base64url");
  const signature = createHmac("sha256", secret).update(nonce).digest("base64url");
  return { state: nonce, cookieValue: `${nonce}.${signature}` };
}

export function verifySignedOAuthState(secret: string, state: string | null, cookieValue: string | undefined) {
  if (!state || !cookieValue) return false;
  const [nonce, signature] = cookieValue.split(".");
  if (!nonce || !signature || nonce !== state) return false;
  const expected = createHmac("sha256", secret).update(nonce).digest();
  let provided: Buffer;
  try { provided = Buffer.from(signature, "base64url"); } catch { return false; }
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

export function encryptExpiringSecret(secret: string, accessToken: string, expiresAt: number) {
  const key = createHash("sha256").update(secret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const payload = JSON.stringify({ accessToken, exp: expiresAt });
  const encrypted = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((value) => value.toString("base64url")).join(".");
}

export function decryptExpiringSecret(secret: string, value: string | undefined, now = Date.now()) {
  if (!value) return null;
  try {
    const [ivRaw, tagRaw, encryptedRaw] = value.split(".");
    if (!ivRaw || !tagRaw || !encryptedRaw) return null;
    const key = createHash("sha256").update(secret).digest();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivRaw, "base64url"));
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
    const decoded = Buffer.concat([decipher.update(Buffer.from(encryptedRaw, "base64url")), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(decoded) as { accessToken?: string; exp?: number };
    return parsed.accessToken && parsed.exp && parsed.exp > now ? parsed.accessToken : null;
  } catch { return null; }
}
