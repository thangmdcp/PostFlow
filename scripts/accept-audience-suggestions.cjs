// Read-only targeting lookup + validate_only. Never creates Meta assets or Posts.
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
require("dotenv").config({ path: ".env.local", quiet: true });
const root = path.resolve(__dirname, "..");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...args) {
  if (request.startsWith("@/")) request = path.join(root, request.slice(2)) + ".ts";
  return originalResolve.call(this, request, parent, ...args);
};
Module._extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, file);
if (process.env.DIRECT_DATABASE_URL) process.env.DATABASE_URL = process.env.DIRECT_DATABASE_URL;
const { prisma } = require("@/lib/prisma");
const { META_GRAPH_API } = require("@/lib/meta");
const { metaRequestJson } = require("@/lib/metaApiClient");
const { audienceOptionsForAccount, resolvePostAdAudience } = require("@/lib/adAudienceServer");
const { DEFAULT_AUDIENCE_SUGGESTIONS, applyAudienceSnapshot } = require("@/lib/adAudience");
const { templateBlueprintFromSettings } = require("@/lib/adTemplateBlueprint");
const { applyAdvantagePlacements } = require("@/lib/adAdvantage");
const arg = name => process.argv[process.argv.indexOf(name) + 1];
async function main() {
  const templateId = process.argv.includes("--template") ? arg("--template") : null;
  const template = await prisma.campaignTemplate.findFirstOrThrow({ where: templateId ? { campaignId: templateId } : { templateName: "Tem1" } });
  const account = await prisma.fbAdAccount.findUniqueOrThrow({ where: { accountId: template.adAccountId } });
  const headers = { Authorization: `Bearer ${account.accessToken}` };
  const read = async (node, params) => {
    const url = new URL(`${META_GRAPH_API}/${node}`);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    return (await metaRequestJson(url.toString(), { headers, signal: AbortSignal.timeout(20_000) })).data;
  };
  const selections = {};
  for (const [kind, query] of [["interest", "Shopping"], ["behavior", "Engaged"], ["custom", ""]]) {
    const result = await audienceOptionsForAccount({ accountId: account.accountId, kind, query });
    selections[kind] = result.options;
    console.log(JSON.stringify({ lookup: kind, count: result.options.length, paginated: !!result.nextCursor }));
  }
  const campaign = await read(template.campaignId, { fields: "id,account_id,daily_budget,lifetime_budget" });
  if (`act_${campaign.account_id}` !== account.accountId) throw new Error("Campaign account mismatch");
  const adsets = await read(`${campaign.id}/adsets`, { fields: "id,daily_budget,billing_event,optimization_goal,destination_type,promoted_object", limit: "1" });
  const adset = adsets.data?.[0];
  const blueprint = templateBlueprintFromSettings(template.settings);
  if (!adset || !blueprint) throw new Error("Existing Ad Set/template snapshot required");
  const cases = [
    ["template", DEFAULT_AUDIENCE_SUGGESTIONS],
    ["none", { ...DEFAULT_AUDIENCE_SUGGESTIONS, mode: "none" }],
    ...["", "1", "2"].map(gender => [`custom-${gender || "all"}`, { ...DEFAULT_AUDIENCE_SUGGESTIONS, mode: "custom", ageRange: [25, 35], gender,
      interests: selections.interest.slice(0, 1), behaviors: selections.behavior.slice(0, 1) }]),
  ];
  const availableAudience=selections.custom.find(row=>!row.disabled);
  if (availableAudience) cases.push(["custom-audience", { ...DEFAULT_AUDIENCE_SUGGESTIONS, mode: "custom", customAudiencesByAccount: { [account.accountId]: [{id:availableAudience.id,name:availableAudience.name}] } }]);
  else console.log(JSON.stringify({ customAudienceAcceptance: "No currently deliverable audience in this account", unavailableOptionsDisabled: selections.custom.length }));
  for (const [label, config] of cases) {
    const snapshot = await resolvePostAdAudience(template.campaignId, account.accountId, config, true, 18);
    const targeting = applyAdvantagePlacements(applyAudienceSnapshot({ ...blueprint.targeting, age_min: 18 }, snapshot, account.accountId));
    const params = new URLSearchParams({ name: "[PostFlow validate_only] audience", campaign_id: campaign.id, status: "PAUSED", billing_event: adset.billing_event,
      optimization_goal: adset.optimization_goal, targeting: JSON.stringify(targeting), execution_options: JSON.stringify(["validate_only"]) });
    if (!campaign.daily_budget && !campaign.lifetime_budget) { params.set("daily_budget", adset.daily_budget || "50000"); params.set("bid_strategy", "LOWEST_COST_WITHOUT_CAP"); }
    if (adset.destination_type) params.set("destination_type", adset.destination_type);
    if (adset.promoted_object) params.set("promoted_object", JSON.stringify(adset.promoted_object));
    const result = (await metaRequestJson(`${META_GRAPH_API}/${account.accountId}/adsets`, { method: "POST", headers, body: params, signal: AbortSignal.timeout(30_000) })).data;
    if (result.success !== true || result.id) throw new Error("validate_only was not confirmed; do not release");
    console.log(JSON.stringify({ label, validateOnly: true, success: result.success, ageRange: snapshot.targeting.age_range, genders: snapshot.targeting.genders, assetsCreated: false }));
  }
  let rejected = false;
  try { await resolvePostAdAudience(template.campaignId, account.accountId, { ...DEFAULT_AUDIENCE_SUGGESTIONS, mode: "custom", interests: [{ id: "999999999999999999", name: "Invalid ID probe" }] }, true, 18); }
  catch (error) { if (error.code === "AD_AUDIENCE_INVALID") rejected = true; else throw error; }
  if (!rejected) throw new Error("Invalid targeting ID was accepted; do not release without ID verification.");
  console.log(JSON.stringify({ invalidIdRejected: true, assetsCreated: false }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
