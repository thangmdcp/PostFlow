import assert from "node:assert/strict";
import test from "node:test";
import {
  facebookOriginalCtaState,
  isFacebookOriginalCtaVerified,
  normalizeFacebookCtaUrl,
} from "../lib/facebookOriginalCta.ts";

test("video_inline is not accepted even when Meta returns a CTA", () => {
  const state = facebookOriginalCtaState({
    call_to_action: { type: "SHOP_NOW", value: { link: "https://s.shopee.vn/item" } },
    attachments: { data: [{ type: "video_inline" }] },
  });
  assert.equal(isFacebookOriginalCtaVerified(state, "SHOP_NOW", "https://s.shopee.vn/item"), false);
});

test("video_direct_response verifies type and affiliate destination", () => {
  const state = facebookOriginalCtaState({
    call_to_action: { type: "SHOP_NOW", value: { link: "https://s.shopee.vn/item/" } },
    attachments: { data: [{ type: "video_direct_response" }] },
  });
  assert.equal(isFacebookOriginalCtaVerified(state, "SHOP_NOW", "https://s.shopee.vn/item"), true);
  assert.equal(isFacebookOriginalCtaVerified(state, "LEARN_MORE", "https://s.shopee.vn/item"), false);
  assert.equal(isFacebookOriginalCtaVerified(state, "SHOP_NOW", "https://s.shopee.vn/other"), false);
});

test("Facebook redirect URLs normalize to the saved destination", () => {
  const redirect = "https://l.facebook.com/l.php?u=https%3A%2F%2Fs.shopee.vn%2Fabc%2F&h=x";
  assert.equal(normalizeFacebookCtaUrl(redirect), "https://s.shopee.vn/abc");
});
