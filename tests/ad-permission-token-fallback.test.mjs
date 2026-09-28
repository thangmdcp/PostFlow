import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("permission preflight supplies the connected Page token as a scoped fallback", async () => {
  const preflight = await read("lib/adPermissionPreflight.ts");
  assert.match(preflight, /account\.accessToken,\s*page\.accessToken,/);
});

test("ad creation reuses the token that passed the Page-account permission check", async () => {
  const facebook = await read("lib/facebook.ts");
  assert.match(facebook, /const creationAccessToken = await ensureAdAssetAccess/);
  assert.match(facebook, /PAGE_TOKEN_CACHE_MARKER/);
  assert.match(facebook, /targetAccount\.id === `act_\$\{normalizedId\}`/);
  assert.match(facebook, /access_token: creationAccessToken/);
});
