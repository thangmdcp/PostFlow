import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_BATCH_ADVANTAGE,
  ADVANTAGE_CREATIVE_FEATURES,
  advantageCreativeSpec,
  applyAdvantageAudience,
  applyAdvantagePlacements,
  parseAdAdvantageConfig,
  parseBatchAdvantageConfig,
  resolveAdAdvantageConfig,
} from "../lib/adAdvantage.ts";

test("Advantage+ defaults match the Shopee affiliate policy", () => {
  assert.deepEqual(parseBatchAdvantageConfig(undefined), DEFAULT_BATCH_ADVANTAGE);
  assert.deepEqual(DEFAULT_BATCH_ADVANTAGE, {
    audienceEnabled: false,
    placementsEnabled: true,
    limitedSpendEnabled: false,
    creativeEnabled: false,
    campaignBudgetMode: "template",
  });
});

test("campaign budget template mode resolves once into an immutable Post snapshot", () => {
  assert.equal(resolveAdAdvantageConfig(DEFAULT_BATCH_ADVANTAGE, true).campaignBudgetEnabled, true);
  assert.equal(resolveAdAdvantageConfig(DEFAULT_BATCH_ADVANTAGE, false).campaignBudgetEnabled, false);
  assert.equal(resolveAdAdvantageConfig({ ...DEFAULT_BATCH_ADVANTAGE, campaignBudgetMode: "enabled" }, false).campaignBudgetEnabled, true);
  assert.equal(resolveAdAdvantageConfig({ ...DEFAULT_BATCH_ADVANTAGE, campaignBudgetMode: "disabled" }, true).campaignBudgetEnabled, false);
});

test("Advantage+ placements remove every manual placement family", () => {
  const targeting = applyAdvantagePlacements({
    geo_locations: { countries: ["VN"] },
    publisher_platforms: ["instagram"],
    device_platforms: ["mobile"],
    facebook_positions: ["feed"],
    instagram_positions: ["reels"],
    messenger_positions: ["messenger_home"],
    audience_network_positions: ["classic"],
    threads_positions: ["threads_stream"],
  });
  assert.deepEqual(targeting, { geo_locations: { countries: ["VN"] } });
});

test("Audience and Creative explicitly opt in or out", () => {
  const targeting = {
    age_min: 20,
    age_max: 43,
    genders: [2],
    geo_locations: { countries: ["VN"] },
    locales: [6],
  };
  assert.deepEqual(applyAdvantageAudience(targeting, false), {
    ...targeting,
    targeting_automation: { advantage_audience: 0 },
  });
  assert.deepEqual(applyAdvantageAudience(targeting, true), {
    age_min: 20,
    geo_locations: { countries: ["VN"] },
    locales: [6],
    targeting_automation: { advantage_audience: 1 },
  });
  assert.equal(targeting.age_max, 43, "sanitizing must not mutate the saved template targeting");
  assert.deepEqual(targeting.genders, [2]);
  const optedOut = advantageCreativeSpec(false).creative_features_spec;
  const optedIn = advantageCreativeSpec(true).creative_features_spec;
  assert.equal("standard_enhancements" in optedOut, false);
  assert.deepEqual(Object.keys(optedOut), [...ADVANTAGE_CREATIVE_FEATURES]);
  for (const feature of ADVANTAGE_CREATIVE_FEATURES) {
    assert.deepEqual(optedOut[feature], { enroll_status: "OPT_OUT" });
    assert.deepEqual(optedIn[feature], { enroll_status: "OPT_IN" });
  }
});

test("invalid and legacy snapshot shapes do not silently become new snapshots", () => {
  assert.equal(parseAdAdvantageConfig(null), null);
  assert.equal(parseAdAdvantageConfig({ version: 1, placementsEnabled: true }), null);
  assert.equal(parseAdAdvantageConfig({ version: 0, audienceEnabled: false, placementsEnabled: true, creativeEnabled: false, campaignBudgetEnabled: false }), null);
});

test("limited excluded-placement spend defaults off and cannot coexist with automatic placements", () => {
  assert.equal(resolveAdAdvantageConfig({
    ...DEFAULT_BATCH_ADVANTAGE,
    placementsEnabled: false,
    limitedSpendEnabled: true,
  }, false).limitedSpendEnabled, true);
  assert.equal(resolveAdAdvantageConfig({
    ...DEFAULT_BATCH_ADVANTAGE,
    placementsEnabled: true,
    limitedSpendEnabled: true,
  }, false).limitedSpendEnabled, false);
});

test("v1 snapshots remain retry-compatible with limited spend disabled", () => {
  assert.deepEqual(parseAdAdvantageConfig({
    version: 1,
    audienceEnabled: false,
    placementsEnabled: false,
    creativeEnabled: false,
    campaignBudgetEnabled: false,
  }), {
    version: 2,
    audienceEnabled: false,
    placementsEnabled: false,
    limitedSpendEnabled: false,
    creativeEnabled: false,
    campaignBudgetEnabled: false,
  });
});
