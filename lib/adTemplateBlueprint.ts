export const AD_TEMPLATE_BLUEPRINT_VERSION = 1 as const;

export interface AdTemplateBlueprint {
  version: typeof AD_TEMPLATE_BLUEPRINT_VERSION;
  name: string;
  objective: string;
  specialAdCategories: string[];
  useCampaignBudget: boolean;
  targeting: Record<string, unknown>;
  targetingAutomation: { advantage_audience: 0 | 1 };
  billingEvent: string;
  optimizationGoal: string;
  accountBoundFields: string[];
}

export interface PortableBlueprintResult {
  blueprint: AdTemplateBlueprint;
  removedFields: string[];
}

const ACCOUNT_BOUND_KEYS = new Set([
  "custom_audiences",
  "excluded_custom_audiences",
  "pixel_id",
  "dataset_id",
  "catalog_id",
  "product_catalog_id",
  "product_set_id",
  "application_id",
  "app_id",
  "promoted_object",
  "product_audience_specs",
  "connections",
  "excluded_connections",
  "friends_of_connections",
  "engagement_spec",
  "prospecting_audience",
  "user_adclusters",
  "excluded_user_adclusters",
  "dynamic_audience_ids",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/**
 * Meta requires every new Ad Set to explicitly opt in or out of Advantage
 * Audience. Older template snapshots predate that requirement, so preserve
 * their manual targeting by opting out instead of letting Meta expand it.
 */
export function normalizeTargetingAutomation(value: unknown): { advantage_audience: 0 | 1 } {
  const source = record(value);
  return { advantage_audience: source?.advantage_audience === 1 ? 1 : 0 };
}

export function templateBlueprintFromSettings(settings: unknown): AdTemplateBlueprint | null {
  const root = record(settings);
  if (!root) return null;

  const saved = record(root.blueprint);
  if (saved?.version === AD_TEMPLATE_BLUEPRINT_VERSION) {
    const targeting = record(saved.targeting);
    if (typeof saved.objective !== "string" || !saved.objective || !targeting) return null;
    return {
      version: AD_TEMPLATE_BLUEPRINT_VERSION,
      name: typeof saved.name === "string" ? saved.name : "PostFlow template",
      objective: saved.objective,
      specialAdCategories: stringArray(saved.specialAdCategories),
      useCampaignBudget: Boolean(saved.useCampaignBudget),
      targeting,
      targetingAutomation: normalizeTargetingAutomation(saved.targetingAutomation),
      billingEvent: typeof saved.billingEvent === "string" && saved.billingEvent ? saved.billingEvent : "IMPRESSIONS",
      optimizationGoal: typeof saved.optimizationGoal === "string" && saved.optimizationGoal ? saved.optimizationGoal : "LINK_CLICKS",
      accountBoundFields: stringArray(saved.accountBoundFields),
    };
  }

  // Legacy templates stored the complete campaign scan directly in settings.
  const adsets = Array.isArray(root.adsets) ? root.adsets : [];
  const firstAdset = record(adsets[0]);
  const targeting = record(firstAdset?.targeting);
  if (typeof root.objective !== "string" || !root.objective || !firstAdset || !targeting) return null;
  return {
    version: AD_TEMPLATE_BLUEPRINT_VERSION,
    name: typeof root.name === "string" ? root.name : "PostFlow template",
    objective: root.objective,
    specialAdCategories: stringArray(root.special_ad_categories),
    useCampaignBudget: Boolean(root.daily_budget || root.lifetime_budget),
    targeting,
    targetingAutomation: normalizeTargetingAutomation(firstAdset.targeting_automation),
    billingEvent: typeof firstAdset.billing_event === "string" && firstAdset.billing_event ? firstAdset.billing_event : "IMPRESSIONS",
    optimizationGoal: typeof firstAdset.optimization_goal === "string" && firstAdset.optimization_goal ? firstAdset.optimization_goal : "LINK_CLICKS",
    accountBoundFields: record(firstAdset.promoted_object)
      ? Object.keys(firstAdset.promoted_object as Record<string, unknown>).map((key) => `adset.promoted_object.${key}`)
      : [],
  };
}

export function normalizeCampaignTemplateSettings(settings: unknown): Record<string, unknown> | null {
  const root = record(settings);
  const blueprint = templateBlueprintFromSettings(settings);
  if (!root || !blueprint) return null;
  return { ...root, blueprint };
}

function stripAccountBoundValue(value: unknown, path: string, removed: Set<string>): unknown {
  if (Array.isArray(value)) {
    const items = value
      .map((item, index) => stripAccountBoundValue(item, `${path}[${index}]`, removed))
      .filter((item) => item !== undefined);
    return items.length ? items : undefined;
  }
  const source = record(value);
  if (!source) return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(source)) {
    const childPath = path ? `${path}.${key}` : key;
    if (ACCOUNT_BOUND_KEYS.has(key.toLowerCase())) {
      removed.add(childPath);
      continue;
    }
    const stripped = stripAccountBoundValue(child, childPath, removed);
    if (stripped !== undefined) result[key] = stripped;
  }
  return Object.keys(result).length ? result : undefined;
}

export function portableTemplateBlueprint(
  blueprint: AdTemplateBlueprint,
  crossAccount: boolean,
): PortableBlueprintResult {
  if (!crossAccount) return { blueprint, removedFields: [] };
  const removed = new Set<string>(blueprint.accountBoundFields);
  const targeting = (stripAccountBoundValue(blueprint.targeting, "targeting", removed) ?? {}) as Record<string, unknown>;
  return {
    blueprint: { ...blueprint, targeting },
    removedFields: [...removed].sort(),
  };
}

export function templatePortability(settings: unknown, sourceAccountId?: string, targetAccountId?: string) {
  const blueprint = templateBlueprintFromSettings(settings);
  const crossAccount = Boolean(sourceAccountId && targetAccountId && sourceAccountId !== targetAccountId);
  if (!blueprint) return { valid: !crossAccount, crossAccount, removedFields: [] as string[] };
  return { valid: true, crossAccount, removedFields: portableTemplateBlueprint(blueprint, crossAccount).removedFields };
}
