import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAdPlacements,
  parseAdPlacementConfig,
  validateAdPlacements,
} from "../lib/adPlacements.ts";

const manual = {
  publisherPlatforms: ["facebook", "instagram", "messenger", "audience_network", "threads"],
  devicePlatforms: ["mobile", "desktop"],
  facebookPositions: ["feed", "right_hand_column"],
  instagramPositions: ["stream", "reels"],
  messengerPositions: ["messenger_home"],
  audienceNetworkPositions: ["classic"],
  threadsPositions: ["threads_stream"],
};

test("manual placements replace all template placement families and keep other targeting", () => {
  const source = {
    geo_locations: { countries: ["VN"] },
    interests: [{ id: "1" }],
    publisher_platforms: ["facebook"],
    facebook_positions: ["marketplace"],
    instagram_positions: ["story"],
    whatsapp_positions: ["status"],
  };
  const result = applyAdPlacements(source, manual);
  assert.deepEqual(result.publisher_platforms, manual.publisherPlatforms);
  assert.deepEqual(result.device_platforms, manual.devicePlatforms);
  assert.deepEqual(result.facebook_positions, manual.facebookPositions);
  assert.deepEqual(result.instagram_positions, manual.instagramPositions);
  assert.deepEqual(result.messenger_positions, manual.messengerPositions);
  assert.deepEqual(result.audience_network_positions, manual.audienceNetworkPositions);
  assert.deepEqual(result.threads_positions, ["threads_stream"]);
  assert.equal("whatsapp_positions" in result, false);
  assert.deepEqual(result.geo_locations, { countries: ["VN"] });
  assert.deepEqual(source.facebook_positions, ["marketplace"]);
});

test("invalid and unsupported placement values are filtered", () => {
  const parsed = parseAdPlacementConfig({
    ...manual,
    publisherPlatforms: ["facebook", "whatsapp"],
    devicePlatforms: ["mobile", "television"],
    facebookPositions: ["feed", "unknown"],
  });
  assert.deepEqual(parsed?.publisherPlatforms, ["facebook"]);
  assert.deepEqual(parsed?.devicePlatforms, ["mobile"]);
  assert.deepEqual(parsed?.facebookPositions, ["feed"]);
});

test("each selected platform needs a position", () => {
  assert.match(validateAdPlacements({ ...manual, threadsPositions: [] }, { hasInstagram: true }) ?? "", /threads/);
  assert.equal(validateAdPlacements(manual, { hasInstagram: true }), null);
});

test("Instagram-only ads reject every non-Instagram delivery platform", () => {
  assert.match(validateAdPlacements(manual, { instagramOnly: true, hasInstagram: true }) ?? "", /chỉ được phân phối trên Instagram/);
  assert.equal(validateAdPlacements({
    ...manual,
    publisherPlatforms: ["instagram"],
    facebookPositions: [], messengerPositions: [], audienceNetworkPositions: [], threadsPositions: [],
  }, { instagramOnly: true, hasInstagram: true }), null);
});

test("Instagram and Threads require a linked Instagram Professional identity", () => {
  assert.match(validateAdPlacements(manual, { hasInstagram: false }) ?? "", /Instagram Professional/);
});

test("Instagram Explore home requires the main Explore placement", () => {
  assert.match(validateAdPlacements({
    ...manual,
    publisherPlatforms: ["instagram"],
    instagramPositions: ["explore_home"],
  }, { hasInstagram: true }) ?? "", /Khám phá/);
});
