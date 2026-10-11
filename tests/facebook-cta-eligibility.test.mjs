import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { facebookPostCtaEligibility } from "../lib/adCta.ts";

const templates = [
  { campaignId: "public", templateName: "Công khai", settings: { postType: "published" } },
  { campaignId: "dark", templateName: "Ẩn A", settings: { postType: "dark" } },
  { campaignId: "dark2", templateName: "Ẩn B", settings: { postType: "dark" } },
];
const config = { hasFacebook: true, overridePublish: false, templates, templateIds: ["public"] };

test("live public templates ignore stale dark postType, including restored presets", () => {
  const restored = JSON.parse(JSON.stringify({ ...config, postType: "dark" }));
  assert.equal(facebookPostCtaEligibility(restored).allowed, true);
});

test("Facebook and cross-post allow public CTA; Instagram-only does not", () => {
  assert.equal(facebookPostCtaEligibility(config).allowed, true);
  assert.match(facebookPostCtaEligibility({ ...config, hasFacebook: false }).reason, /Facebook/);
});

test("mixed accounts report every dark template and honor explicit public override", () => {
  const mixed = { ...config, templateIds: ["public", "dark", "dark2"] };
  const result = facebookPostCtaEligibility(mixed);
  assert.equal(result.allowed, false);
  assert.match(result.reason, /Ẩn A, Ẩn B/);
  assert.equal(facebookPostCtaEligibility({ ...mixed, overridePublish: true }).allowed, true);
});

test("template changes and row additions/removals recalculate without mutating CTA scope", () => {
  const selected = { ...config, ctaScope: "AD_AND_FACEBOOK_POST" };
  assert.equal(facebookPostCtaEligibility({ ...selected, templateIds: ["dark"] }).allowed, false);
  assert.equal(facebookPostCtaEligibility({ ...selected, templateIds: ["public", "dark"] }).allowed, false);
  assert.equal(facebookPostCtaEligibility(selected).allowed, true);
  assert.equal(selected.ctaScope, "AD_AND_FACEBOOK_POST");
});

test("missing templates fail closed even with public override", () => {
  for (const templateIds of [[], ["missing"], ["public", "missing"]]) {
    assert.equal(facebookPostCtaEligibility({ ...config, templateIds, overridePublish: true }).allowed, false);
  }
});

test("button and batch confirmation share live eligibility helper", () => {
  const panel = readFileSync(new URL("../components/AdsConfigPanel.tsx", import.meta.url), "utf8");
  const dialog = readFileSync(new URL("../components/BatchActionDialog.tsx", import.meta.url), "utf8");
  assert.match(panel, /facebookPostCtaEligibility\(/);
  assert.match(dialog, /facebookPostCtaEligibility\(/);
  assert.match(panel, /hideTemplateSelect \? accountRows\.map/);
  assert.doesNotMatch(panel, /hasFacebook && \(adConfig\.postType/);
});
