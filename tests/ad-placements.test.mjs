import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAdPlacements,
  parseAdPlacementConfig,
  placementSoftOptOutFromConfig,
  validateAdPlacements,
  adPlacementAvailability,
  toggleAdPlacementPlatform,
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

test("unavailable selected Instagram and Threads can be removed without changing other placements", () => {
  const options = { instagramOnly: false, hasInstagram: false };
  for (const [platform, field] of [["instagram", "instagramPositions"], ["threads", "threadsPositions"]]) {
    const before = structuredClone(manual);
    assert.deepEqual(adPlacementAvailability(before, platform, options), {
      selected: true, missingInstagram: true, toggleDisabled: false, positionsDisabled: true,
    });
    const next = toggleAdPlacementPlatform(before, platform, options);
    assert.deepEqual(next, {
      ...before,
      publisherPlatforms: before.publisherPlatforms.filter((item) => item !== platform),
      [field]: [],
    });
    assert.deepEqual(before, manual);
    assert.equal(toggleAdPlacementPlatform(next, platform, options), next);
    assert.equal(adPlacementAvailability(next, platform, options).toggleDisabled, true);
    assert.deepEqual(parseAdPlacementConfig(JSON.parse(JSON.stringify(next))), next);
  }
});

test("linked Instagram permits ordinary toggles and position edits", () => {
  const options = { instagramOnly: false, hasInstagram: true };
  const off = toggleAdPlacementPlatform(manual, "instagram", options);
  const on = toggleAdPlacementPlatform(off, "instagram", options);
  assert.equal(on.publisherPlatforms.includes("instagram"), true);
  assert.equal(adPlacementAvailability(on, "instagram", options).positionsDisabled, false);
});

test("missing Instagram never prevents Facebook toggles or silently mutates a remembered selection", () => {
  const before = structuredClone(manual);
  const options = { instagramOnly: false, hasInstagram: false };
  adPlacementAvailability(before, "instagram", options);
  assert.deepEqual(before, manual);
  const next = toggleAdPlacementPlatform(before, "facebook", options);
  assert.equal(next.publisherPlatforms.includes("instagram"), true);
  assert.equal(next.publisherPlatforms.includes("threads"), true);
  assert.match(validateAdPlacements(next, options) ?? "", /Instagram Professional/);
  const withoutIg = toggleAdPlacementPlatform(toggleAdPlacementPlatform(before, "instagram", options), "threads", options);
  assert.equal(validateAdPlacements(withoutIg, options), null);
});

test("Instagram-source ads cannot toggle into Facebook even when Instagram is unavailable", () => {
  for (const hasInstagram of [true, false]) {
    const options = { instagramOnly: true, hasInstagram };
    assert.equal(toggleAdPlacementPlatform(manual, "instagram", options), manual);
    assert.equal(toggleAdPlacementPlatform(manual, "facebook", options), manual);
    assert.equal(adPlacementAvailability(manual, "facebook", options).positionsDisabled, true);
    assert.equal(adPlacementAvailability(manual, "instagram", options).positionsDisabled, !hasInstagram);
  }
});

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

test("deprecated Facebook video feeds placement is no longer accepted", () => {
  const parsed = parseAdPlacementConfig({ ...manual, facebookPositions: ["feed", "video_feeds"] });
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

test("limited spend contains only excluded manual positions", () => {
  const result = placementSoftOptOutFromConfig(manual, { hasInstagram: true });
  assert.equal(result?.facebook_positions?.includes("feed"), false);
  assert.equal(result?.facebook_positions?.includes("marketplace"), true);
  assert.equal(result?.instagram_positions?.includes("stream"), false);
  assert.equal(result?.instagram_positions?.includes("story"), true);
  assert.equal(result?.threads_positions, undefined);
});

test("limited spend keeps Instagram and Threads hard-excluded without an IG identity", () => {
  const result = placementSoftOptOutFromConfig({
    ...manual,
    publisherPlatforms: ["facebook"],
    facebookPositions: ["feed"],
    instagramPositions: [],
    threadsPositions: [],
  }, { hasInstagram: false });
  assert.equal(result?.instagram_positions, undefined);
  assert.equal(result?.threads_positions, undefined);
  assert.equal(result?.audience_network_positions?.length > 0, true);
});
