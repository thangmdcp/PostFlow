import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeCampaignTemplateSettings,
  normalizeTargetingAutomation,
  portableTemplateBlueprint,
  templateBlueprintFromSettings,
  templatePortability,
} from "../lib/adTemplateBlueprint.ts";

const legacySettings = {
  id: "campaign-source",
  name: "Chạy Ẩn",
  objective: "OUTCOME_TRAFFIC",
  daily_budget: "100000",
  special_ad_categories: [],
  postType: "dark",
  adsets: [{
    billing_event: "IMPRESSIONS",
    optimization_goal: "LINK_CLICKS",
    promoted_object: { pixel_id: "pixel-outside-targeting" },
    targeting: {
      age_min: 18,
      geo_locations: { countries: ["VN"] },
      custom_audiences: [{ id: "audience-1" }],
      flexible_spec: [{ interests: [{ id: "interest-1" }], excluded_custom_audiences: [{ id: "audience-2" }] }],
    },
  }],
};

test("legacy campaign scan becomes a frozen portable blueprint", () => {
  const normalized = normalizeCampaignTemplateSettings(legacySettings);
  assert.ok(normalized);
  const blueprint = templateBlueprintFromSettings(normalized);
  assert.equal(blueprint?.version, 1);
  assert.equal(blueprint?.name, "Chạy Ẩn");
  assert.equal(blueprint?.objective, "OUTCOME_TRAFFIC");
  assert.equal(blueprint?.useCampaignBudget, true);
  assert.deepEqual(blueprint?.targetingAutomation, { advantage_audience: 0 });
  assert.equal(normalized?.postType, "dark");
});

test("Advantage Audience preserves an explicit source value and defaults legacy templates off", () => {
  assert.deepEqual(normalizeTargetingAutomation(undefined), { advantage_audience: 0 });
  assert.deepEqual(normalizeTargetingAutomation({ advantage_audience: 0 }), { advantage_audience: 0 });
  assert.deepEqual(normalizeTargetingAutomation({ advantage_audience: 1 }), { advantage_audience: 1 });
  assert.deepEqual(normalizeTargetingAutomation({ advantage_audience: 2 }), { advantage_audience: 0 });

  const enabled = templateBlueprintFromSettings({
    ...legacySettings,
    adsets: [{ ...legacySettings.adsets[0], targeting_automation: { advantage_audience: 1 } }],
  });
  assert.deepEqual(enabled?.targetingAutomation, { advantage_audience: 1 });
});

test("cross-account template strips nested account-bound assets without mutating snapshot", () => {
  const blueprint = templateBlueprintFromSettings(legacySettings);
  assert.ok(blueprint);
  const portable = portableTemplateBlueprint(blueprint, true);
  assert.deepEqual(portable.blueprint.targeting.geo_locations, { countries: ["VN"] });
  assert.deepEqual(portable.blueprint.targeting.flexible_spec, [{ interests: [{ id: "interest-1" }] }]);
  assert.equal("custom_audiences" in portable.blueprint.targeting, false);
  assert.deepEqual(blueprint.targeting.custom_audiences, [{ id: "audience-1" }]);
  assert.deepEqual(portable.removedFields, [
    "adset.promoted_object.pixel_id",
    "targeting.custom_audiences",
    "targeting.flexible_spec[0].excluded_custom_audiences",
  ]);
});

test("same-account template keeps account-bound targeting", () => {
  const blueprint = templateBlueprintFromSettings(legacySettings);
  assert.ok(blueprint);
  const sameAccount = portableTemplateBlueprint(blueprint, false);
  assert.deepEqual(sameAccount.blueprint.targeting.custom_audiences, [{ id: "audience-1" }]);
  assert.deepEqual(sameAccount.removedFields, []);
});

test("cross-account sanitizer removes empty targeting branches left by private assets", () => {
  const blueprint = templateBlueprintFromSettings({
    ...legacySettings,
    adsets: [{
      ...legacySettings.adsets[0],
      targeting: { geo_locations: { countries: ["VN"] }, flexible_spec: [{ custom_audiences: [{ id: "private" }] }] },
    }],
  });
  assert.ok(blueprint);
  assert.deepEqual(portableTemplateBlueprint(blueprint, true).blueprint.targeting, {
    geo_locations: { countries: ["VN"] },
  });
});

test("legacy template missing Ad Set is blocked only when used cross-account", () => {
  const incomplete = { name: "Old", objective: "OUTCOME_TRAFFIC" };
  assert.equal(templatePortability(incomplete, "act_source", "act_source").valid, true);
  assert.equal(templatePortability(incomplete, "act_source", "act_target").valid, false);
});
