import assert from "node:assert/strict";
import test from "node:test";
import { createSignedOAuthState, decryptExpiringSecret, encryptExpiringSecret, verifySignedOAuthState } from "../lib/facebookOAuthSecurity.ts";
import { publicFbAdAccountSelect, publicFbConnectionSelect } from "../lib/publicFacebook.ts";

test("OAuth state accepts only the matching signed nonce", () => {
  const signed = createSignedOAuthState("test-secret");
  assert.equal(verifySignedOAuthState("test-secret", signed.state, signed.cookieValue), true);
  assert.equal(verifySignedOAuthState("wrong-secret", signed.state, signed.cookieValue), false);
  assert.equal(verifySignedOAuthState("test-secret", "another-state", signed.cookieValue), false);
  assert.equal(verifySignedOAuthState("test-secret", signed.state, `${signed.cookieValue}x`), false);
});

test("temporary OAuth token is encrypted, authenticated and expires", () => {
  const now = 1_700_000_000_000;
  const value = encryptExpiringSecret("test-secret", "EA-secret-token", now + 60_000);
  assert.equal(value.includes("EA-secret-token"), false);
  assert.equal(decryptExpiringSecret("test-secret", value, now), "EA-secret-token");
  assert.equal(decryptExpiringSecret("wrong-secret", value, now), null);
  assert.equal(decryptExpiringSecret("test-secret", `${value}x`, now), null);
  assert.equal(decryptExpiringSecret("test-secret", value, now + 60_001), null);
});

test("public Facebook asset projections never serialize saved access tokens", () => {
  assert.equal("accessToken" in publicFbConnectionSelect, false);
  assert.equal("accessToken" in publicFbAdAccountSelect, false);
});
