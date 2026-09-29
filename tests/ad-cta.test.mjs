import assert from "node:assert/strict";
import test from "node:test";
import { adCallToAction, parseAdCtaScope, parseAdCtaType, resolveAdCtaScope, validateAdCta, validateAdCtaScope } from "../lib/adCta.ts";

test("CTA parser accepts only the supported Shopee actions", () => {
  assert.equal(parseAdCtaType("LEARN_MORE"), "LEARN_MORE");
  assert.equal(parseAdCtaType("SHOP_NOW"), "SHOP_NOW");
  assert.equal(parseAdCtaType("NO_BUTTON"), "NO_BUTTON");
  assert.equal(parseAdCtaType("CALL_NOW"), null);
});

test("CTA enabled requires a valid affiliate URL", () => {
  assert.match(validateAdCta({ ctaType: "LEARN_MORE", destinationUrl: null, adsEnabled: true }).error, /link affiliate/);
  assert.match(validateAdCta({ ctaType: "SHOP_NOW", destinationUrl: "javascript:alert(1)", adsEnabled: true }).error, /không hợp lệ/);
  assert.equal(validateAdCta({ ctaType: "SHOP_NOW", destinationUrl: "https://s.shopee.vn/demo", adsEnabled: true }).error, undefined);
  assert.equal(validateAdCta({ ctaType: "NO_BUTTON", destinationUrl: null, adsEnabled: true }).error, undefined);
  assert.match(validateAdCta({ ctaType: "CALL_NOW", destinationUrl: "https://example.com", adsEnabled: true }).error, /không được hỗ trợ/);
});

test("CTA payload leaves headline absent", () => {
  const cta = adCallToAction("LEARN_MORE", "https://s.shopee.vn/demo");
  assert.deepEqual(cta, { type: "LEARN_MORE", value: { link: "https://s.shopee.vn/demo" } });
  assert.equal("title" in cta, false);
});

test("CTA scope defaults legacy rows to ad-only and validates public Facebook sources", () => {
  assert.equal(resolveAdCtaScope(null), "AD_ONLY");
  assert.equal(parseAdCtaScope("AD_AND_FACEBOOK_POST"), "AD_AND_FACEBOOK_POST");
  assert.equal(parseAdCtaScope("ORGANIC_ONLY"), null);
  assert.equal(validateAdCtaScope({
    scope: "AD_AND_FACEBOOK_POST", ctaType: "SHOP_NOW", publishToFacebook: true, publishedToPage: true,
  }).error, undefined);
  assert.match(validateAdCtaScope({
    scope: "AD_AND_FACEBOOK_POST", ctaType: "SHOP_NOW", publishToFacebook: false, publishedToPage: true,
  }).error, /Facebook/);
  assert.equal(validateAdCtaScope({
    scope: "AD_AND_FACEBOOK_POST", ctaType: "NO_BUTTON", publishToFacebook: false, publishedToPage: false,
  }).scope, "AD_ONLY");
});
