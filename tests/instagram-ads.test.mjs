import assert from "node:assert/strict";
import test from "node:test";
import {
  APP_DEEP_LINK_TREATMENT,
  buildFacebookExistingPostCreative,
  buildInstagramExistingPostCreative,
  restrictTargetingToInstagram,
} from "../lib/instagramAds.ts";

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

test("existing Facebook post creative enables app deep linking with web fallback", () => {
  const creative = buildFacebookExistingPostCreative({
    name: "Campaign B",
    objectStoryId: "page-1_post-1",
    accessToken: "secret-token",
  });

  assert.equal(APP_DEEP_LINK_TREATMENT, "deeplink_with_web_fallback");
  assert.equal(creative.object_story_id, "page-1_post-1");
  assert.equal(creative.applink_treatment, APP_DEEP_LINK_TREATMENT);
  assert.equal(creative.access_token, "secret-token");
});
