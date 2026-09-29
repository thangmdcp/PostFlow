export const AD_ADVANTAGE_VERSION = 2 as const;

export type CampaignBudgetMode = "template" | "enabled" | "disabled";

/** Reusable UI/preset configuration before a template is assigned per row. */
export interface BatchAdvantageConfig {
  audienceEnabled: boolean;
  placementsEnabled: boolean;
  limitedSpendEnabled: boolean;
  creativeEnabled: boolean;
  campaignBudgetMode: CampaignBudgetMode;
}

/** Immutable per-Post snapshot consumed by retries. */
export interface AdAdvantageConfig {
  version: typeof AD_ADVANTAGE_VERSION;
  audienceEnabled: boolean;
  placementsEnabled: boolean;
  limitedSpendEnabled: boolean;
  creativeEnabled: boolean;
  campaignBudgetEnabled: boolean;
}

export const DEFAULT_BATCH_ADVANTAGE: BatchAdvantageConfig = {
  audienceEnabled: false,
  placementsEnabled: true,
  limitedSpendEnabled: false,
  creativeEnabled: false,
  campaignBudgetMode: "template",
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function parseBatchAdvantageConfig(value: unknown): BatchAdvantageConfig {
  const source = record(value);
  const mode = source?.campaignBudgetMode;
  return {
    audienceEnabled: source?.audienceEnabled === true,
    placementsEnabled: source?.placementsEnabled !== false,
    limitedSpendEnabled: source?.limitedSpendEnabled === true,
    creativeEnabled: source?.creativeEnabled === true,
    campaignBudgetMode: mode === "enabled" || mode === "disabled" ? mode : "template",
  };
}

export function parseStoredBatchAdvantage(value: unknown, fallback?: unknown): BatchAdvantageConfig {
  if (typeof value !== "string") return parseBatchAdvantageConfig(value ?? fallback);
  try { return parseBatchAdvantageConfig(JSON.parse(value)); }
  catch { return parseBatchAdvantageConfig(fallback); }
}

export function parseAdAdvantageConfig(value: unknown): AdAdvantageConfig | null {
  const source = record(value);
  if (source?.version !== 1 && source?.version !== AD_ADVANTAGE_VERSION) return null;
  if (
    typeof source.audienceEnabled !== "boolean"
    || typeof source.placementsEnabled !== "boolean"
    || typeof source.creativeEnabled !== "boolean"
    || typeof source.campaignBudgetEnabled !== "boolean"
  ) return null;
  return {
    version: AD_ADVANTAGE_VERSION,
    audienceEnabled: source.audienceEnabled,
    placementsEnabled: source.placementsEnabled,
    limitedSpendEnabled: source.version === 1 ? false : source.limitedSpendEnabled === true,
    creativeEnabled: source.creativeEnabled,
    campaignBudgetEnabled: source.campaignBudgetEnabled,
  };
}

export function resolveAdAdvantageConfig(
  value: unknown,
  templateUsesCampaignBudget: boolean,
): AdAdvantageConfig {
  const config = parseBatchAdvantageConfig(value);
  return {
    version: AD_ADVANTAGE_VERSION,
    audienceEnabled: config.audienceEnabled,
    placementsEnabled: config.placementsEnabled,
    limitedSpendEnabled: !config.placementsEnabled && config.limitedSpendEnabled,
    creativeEnabled: config.creativeEnabled,
    campaignBudgetEnabled: config.campaignBudgetMode === "template"
      ? templateUsesCampaignBudget
      : config.campaignBudgetMode === "enabled",
  };
}

export function applyAdvantageAudience(
  targeting: Record<string, unknown>,
  enabled: boolean,
): Record<string, unknown> {
  const next = { ...targeting };
  // With Advantage+ Audience, Meta only accepts age_min as a hard age
  // control. A lower age_max and gender are audience suggestions in Ads
  // Manager, not strict targeting fields in the Marketing API. Sending them
  // here makes Ad Set creation fail with subcode 1870189.
  if (enabled) {
    delete next.age_max;
    delete next.genders;
  }
  return {
    ...next,
    targeting_automation: { advantage_audience: enabled ? 1 : 0 },
  };
}

const PLACEMENT_KEYS = [
  "publisher_platforms",
  "device_platforms",
  "facebook_positions",
  "instagram_positions",
  "messenger_positions",
  "audience_network_positions",
  "threads_positions",
  "whatsapp_positions",
  "oculus_positions",
] as const;

export function applyAdvantagePlacements(targeting: Record<string, unknown>): Record<string, unknown> {
  const next = { ...targeting };
  for (const key of PLACEMENT_KEYS) delete next[key];
  return next;
}

export function advantageCreativeSpec(enabled: boolean): Record<string, unknown> {
  return {
    creative_features_spec: {
      standard_enhancements: { enroll_status: enabled ? "OPT_IN" : "OPT_OUT" },
    },
  };
}
