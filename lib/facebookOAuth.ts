import { META_GRAPH_API, META_GRAPH_API_VERSION } from "@/lib/meta";
import { createSignedOAuthState, decryptExpiringSecret, encryptExpiringSecret, verifySignedOAuthState } from "@/lib/facebookOAuthSecurity";

export const FACEBOOK_OAUTH_STATE_COOKIE = "postflow_fb_oauth_state";
export const FACEBOOK_OAUTH_SESSION_COOKIE = "postflow_fb_oauth_session";
export const FACEBOOK_OAUTH_MAX_AGE = 10 * 60;

export const FACEBOOK_OAUTH_PERMISSIONS = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "pages_manage_engagement",
  "instagram_basic",
  "instagram_content_publish",
  "ads_management",
  "business_management",
] as const;

export interface FacebookOAuthPage {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string; username?: string; profile_picture_url?: string };
}

export interface FacebookOAuthAdAccount {
  id: string;
  account_id: string;
  name: string;
  account_status?: number;
}

function oauthSecret() {
  const secret = process.env.POSTFLOW_AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("Thiếu POSTFLOW_AUTH_SECRET hoặc NEXTAUTH_SECRET");
  return secret;
}

export function hasFacebookOAuthConfig() {
  return Boolean(process.env.FACEBOOK_CLIENT_ID && process.env.FACEBOOK_CLIENT_SECRET && (process.env.POSTFLOW_AUTH_SECRET || process.env.NEXTAUTH_SECRET));
}

export function facebookRedirectUri(origin: string) {
  return process.env.FACEBOOK_OAUTH_REDIRECT_URI || `${origin}/api/facebook/oauth/callback`;
}

export function createFacebookOAuthState() {
  return createSignedOAuthState(oauthSecret());
}

export function verifyFacebookOAuthState(state: string | null, cookieValue: string | undefined) {
  return verifySignedOAuthState(oauthSecret(), state, cookieValue);
}

export function encryptFacebookOAuthSession(accessToken: string) {
  return encryptExpiringSecret(oauthSecret(), accessToken, Date.now() + FACEBOOK_OAUTH_MAX_AGE * 1000);
}

export function decryptFacebookOAuthSession(value: string | undefined) {
  return decryptExpiringSecret(oauthSecret(), value);
}

async function graphJson<T>(url: URL): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error?.message || `Meta API lỗi ${response.status}`);
  return data as T;
}

export async function exchangeFacebookCode(code: string, redirectUri: string) {
  const clientId = process.env.FACEBOOK_CLIENT_ID!;
  const clientSecret = process.env.FACEBOOK_CLIENT_SECRET!;
  const shortUrl = new URL(`${META_GRAPH_API}/oauth/access_token`);
  shortUrl.searchParams.set("client_id", clientId);
  shortUrl.searchParams.set("client_secret", clientSecret);
  shortUrl.searchParams.set("redirect_uri", redirectUri);
  shortUrl.searchParams.set("code", code);
  const short = await graphJson<{ access_token: string }>(shortUrl);

  const longUrl = new URL(`${META_GRAPH_API}/oauth/access_token`);
  longUrl.searchParams.set("grant_type", "fb_exchange_token");
  longUrl.searchParams.set("client_id", clientId);
  longUrl.searchParams.set("client_secret", clientSecret);
  longUrl.searchParams.set("fb_exchange_token", short.access_token);
  const long = await graphJson<{ access_token: string }>(longUrl);
  return long.access_token;
}

export async function discoverFacebookAssets(accessToken: string) {
  const permissionUrl = new URL(`${META_GRAPH_API}/me/permissions`);
  permissionUrl.searchParams.set("access_token", accessToken);
  const permissionData = await graphJson<{ data?: Array<{ permission: string; status: string }> }>(permissionUrl);
  const grantedPermissions = (permissionData.data ?? []).filter((item) => item.status === "granted").map((item) => item.permission);
  const missingPermissions = FACEBOOK_OAUTH_PERMISSIONS.filter((permission) => !grantedPermissions.includes(permission));

  const pagesUrl = new URL(`${META_GRAPH_API}/me/accounts`);
  pagesUrl.searchParams.set("fields", "id,name,access_token,instagram_business_account{id,username,profile_picture_url}");
  pagesUrl.searchParams.set("limit", "200");
  pagesUrl.searchParams.set("access_token", accessToken);
  const adsUrl = new URL(`${META_GRAPH_API}/me/adaccounts`);
  adsUrl.searchParams.set("fields", "id,name,account_id,account_status");
  adsUrl.searchParams.set("limit", "200");
  adsUrl.searchParams.set("access_token", accessToken);

  const [pageResult, adResult] = await Promise.allSettled([
    graphJson<{ data?: FacebookOAuthPage[] }>(pagesUrl),
    graphJson<{ data?: FacebookOAuthAdAccount[] }>(adsUrl),
  ]);
  return {
    pages: pageResult.status === "fulfilled" ? pageResult.value.data ?? [] : [],
    adAccounts: adResult.status === "fulfilled" ? adResult.value.data ?? [] : [],
    grantedPermissions,
    missingPermissions,
    warnings: [
      ...(pageResult.status === "rejected" ? [`Không thể đọc Page: ${pageResult.reason instanceof Error ? pageResult.reason.message : "Lỗi Meta"}`] : []),
      ...(adResult.status === "rejected" ? [`Không thể đọc TKQC: ${adResult.reason instanceof Error ? adResult.reason.message : "Lỗi Meta"}`] : []),
    ],
  };
}

export function facebookOAuthUrl(redirectUri: string, state: string, rerequest = false) {
  const url = new URL(`https://www.facebook.com/${META_GRAPH_API_VERSION}/dialog/oauth`);
  url.searchParams.set("client_id", process.env.FACEBOOK_CLIENT_ID!);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", FACEBOOK_OAUTH_PERMISSIONS.join(","));
  url.searchParams.set("response_type", "code");
  if (rerequest) url.searchParams.set("auth_type", "rerequest");
  return url;
}
