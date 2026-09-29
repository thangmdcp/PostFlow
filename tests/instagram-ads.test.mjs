import assert from "node:assert/strict";
import test from "node:test";
import {
  APP_DEEP_LINK_TREATMENT,
  buildFacebookExistingPostCreative,
  buildInstagramExistingPostCreative,
  restrictTargetingToInstagram,
  sanitizeMetaTargeting,
} from "../lib/instagramAds.ts";

test("all Meta targeting removes fields retired by Meta without mutating template", () => {
  const template = { geo_locations: { countries: ["VN"] }, targeting_optimization: "expansion_all" };
  const result = sanitizeMetaTargeting(template);
  assert.equal("targeting_optimization" in result, false);
  assert.equal(template.targeting_optimization, "expansion_all");
});

test("Instagram targeting keeps template IG placements and removes other surfaces", () => {
  const template = {
    geo_locations: { countries: ["VN"] },
    publisher_platforms: ["facebook", "instagram", "messenger"],
    facebook_positions: ["feed"],
    instagram_positions: ["stream", "reels", "explore_home"],
    messenger_positions: ["messenger_home"],
    audience_network_positions: ["classic"],
    targeting_optimization: "expansion_all",
  };

  const result = restrictTargetingToInstagram(template);

  assert.deepEqual(result.publisher_platforms, ["instagram"]);
  assert.deepEqual(result.instagram_positions, ["stream", "reels", "explore_home", "explore"]);
  assert.equal("facebook_positions" in result, false);
  assert.equal("messenger_positions" in result, false);
  assert.equal("audience_network_positions" in result, false);
  assert.equal("targeting_optimization" in result, false);
  assert.deepEqual(template.publisher_platforms, ["facebook", "instagram", "messenger"]);
});

test("existing Instagram post creative includes identity, media and affiliate CTA", () => {
  const creative = buildInstagramExistingPostCreative({
    name: "Campaign A",
    pageId: "page-1",
    instagramUserId: "ig-user-1",
    igPostId: "ig-media-1",
    destinationUrl: "https://example.com/affiliate",
    ctaType: "LEARN_MORE",
    accessToken: "secret-token",
  });

  assert.equal(creative.object_id, "page-1");
  assert.equal(creative.instagram_user_id, "ig-user-1");
  assert.equal(creative.source_instagram_media_id, "ig-media-1");
  assert.equal(creative.applink_treatment, "deeplink_with_web_fallback");
  assert.deepEqual(creative.call_to_action, {
    type: "LEARN_MORE",
    value: { link: "https://example.com/affiliate" },
  });
  assert.equal("object_story_id" in creative, false);
});

test("existing Facebook post creative adds affiliate CTA and deep linking", () => {
  const creative = buildFacebookExistingPostCreative({
    name: "Campaign B",
    objectStoryId: "page-1_post-1",
    destinationUrl: "https://example.com/affiliate",
    ctaType: "SHOP_NOW",
    accessToken: "secret-token",
  });

  assert.equal(APP_DEEP_LINK_TREATMENT, "deeplink_with_web_fallback");
  assert.equal(creative.object_story_id, "page-1_post-1");
  assert.equal(creative.applink_treatment, APP_DEEP_LINK_TREATMENT);
  assert.deepEqual(creative.call_to_action, {
    type: "SHOP_NOW",
    value: { link: "https://example.com/affiliate" },
  });
  assert.equal(creative.access_token, "secret-token");
});

test("NO_BUTTON omits CTA without disabling deep linking", () => {
  const facebook = buildFacebookExistingPostCreative({
    name: "No CTA",
    objectStoryId: "page-1_post-2",
    ctaType: "NO_BUTTON",
    accessToken: "secret-token",
  });
  const instagram = buildInstagramExistingPostCreative({
    name: "No CTA IG",
    pageId: "page-1",
    instagramUserId: "ig-user-1",
    igPostId: "ig-media-2",
    destinationUrl: "https://example.com/affiliate",
    ctaType: "NO_BUTTON",
    accessToken: "secret-token",
  });
  assert.equal("call_to_action" in facebook, false);
  assert.equal("call_to_action" in instagram, false);
  assert.equal(facebook.applink_treatment, APP_DEEP_LINK_TREATMENT);
  assert.equal(instagram.applink_treatment, APP_DEEP_LINK_TREATMENT);
});

test("Advantage+ Creative is explicitly opted out for Facebook without adding a headline", () => {
  const creative = buildFacebookExistingPostCreative({
    name: "Preserve existing post",
    objectStoryId: "page-1_post-3",
    destinationUrl: "https://example.com/affiliate",
    ctaType: "LEARN_MORE",
    accessToken: "secret-token",
    creativeEnhancements: false,
  });

  assert.deepEqual(creative.degrees_of_freedom_spec, {
    creative_features_spec: {
      standard_enhancements: { enroll_status: "OPT_OUT" },
    },
  });
  assert.equal("title" in creative, false);
  assert.equal("headline" in creative, false);
});

test("Advantage+ Creative can be opted in for an existing Instagram post", () => {
  const creative = buildInstagramExistingPostCreative({
    name: "Enhance existing Instagram post",
    pageId: "page-1",
    instagramUserId: "ig-user-1",
    igPostId: "ig-media-3",
    destinationUrl: "https://example.com/affiliate",
    ctaType: "SHOP_NOW",
    accessToken: "secret-token",
    creativeEnhancements: true,
  });

  assert.deepEqual(creative.degrees_of_freedom_spec, {
    creative_features_spec: {
      standard_enhancements: { enroll_status: "OPT_IN" },
    },
  });
  assert.equal("title" in creative, false);
  assert.equal("headline" in creative, false);
});
