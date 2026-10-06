import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { recheckAdPermissionForRetry } from "../lib/adPermissionRecovery.ts";
import { metaErrorDisplay } from "../lib/metaErrorDisplay.ts";

const source = await readFile(new URL("../lib/autoAdsRunner.ts", import.meta.url), "utf8");
const start = source.indexOf("export async function attemptAutoAds(");
const code = ts.transpileModule(source.slice(start, source.indexOf("\n/**", start)), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
class MetaApiError extends Error {
  constructor(category) { super(`Meta write failed: ${category}`); this.category = category; }
}
class AdTemplateConfigurationError extends Error {}
class BudgetPolicyError extends Error {}
class AdSourceNotReadyError extends Error {}

function fixture({ platform = "facebook", fail = new MetaApiError("permission"), probeError, attempt = 0 } = {}) {
  const row = { id: "post", pageId: "page", adStatus: "pending", adAttempt: attempt,
    adAccountUsed: "act_123", adBudgetMinor: "100", adBudgetCurrency: "USD",
    fbPostId: "page_story", igPostId: "ig_story", adPlatform: platform,
    adCtaType: "NO_BUTTON", adCtaScope: "AD_ONLY", adCampaignId: "existing-campaign" };
  const updates = [], probes = [], creations = [];
  let failure = fail;
  const prisma = { post: {
    findUnique: async () => ({ ...row }),
    update: async ({ data }) => { updates.push(data); Object.assign(row, data); },
    updateMany: async ({ data }) => { Object.assign(row, data); return { count: 1 }; },
  }, fbConnection: { findUnique: async () => ({ accessToken: "fake-page-token", instagramUserId: "ig" }) } };
  const dependencies = { prisma, MetaApiError, AdTemplateConfigurationError, BudgetPolicyError, AdSourceNotReadyError,
    recheckAdPermissionForRetry,
    preflightPostAdPermission: async (post, fresh) => { probes.push({ post, fresh }); if (probeError) throw probeError; },
    createAdCampaignForPost: async (params) => { creations.push(params); if (failure) throw failure; return { campaignId: row.adCampaignId, adAccountId: row.adAccountUsed }; },
    resolveAdCtaScope: () => "AD_ONLY", parseAdCtaType: () => "NO_BUTTON", validateAdCta: () => ({}),
    attemptFacebookOriginalCta: async () => ({ retry: false }), parseAdPlacementConfig: () => undefined,
    parseAdAdvantageConfig: () => undefined, isMetaRateLimited: () => false, metaRateLimitDelayMs: () => 300000,
    RETRY_DELAYS_MS: [30000, 120000, 300000], MAX_ATTEMPTS: 3, SOURCE_READY_RETRY_DELAYS_MS: [30000, 120000],
    console: { log() {}, error() {} },
  };
  const exports = {};
  new Function("exports", ...Object.keys(dependencies), code)(exports, ...Object.values(dependencies));
  return { row, updates, probes, creations, run: () => exports.attemptAutoAds("post"), succeed: () => { failure = null; } };
}

test("permission failure with fresh valid access automatically queues and completes without manual Retry", async () => {
  for (const platform of ["facebook", "instagram"]) {
    const f = fixture({ platform });
    assert.deepEqual(await f.run(), { retry: true, retryAfterSeconds: 30 });
    assert.equal(f.probes.length, 1);
    assert.equal(f.probes[0].fresh, true);
    assert.equal(f.row.adStatus, "pending");
    assert.match(f.row.errorMsg, /\[permission-retry\]/);
    assert.equal(f.row.adCampaignId, "existing-campaign");
    f.succeed();
    assert.deepEqual(await f.run(), { retry: false });
    assert.equal(f.row.adStatus, "done");
    assert.equal(f.row.adAttempt, 2);
    assert.equal(f.row.adAccountUsed, "act_123");
    assert.equal(f.row.errorMsg, null);
    assert.equal(f.creations[0].adPlatform, f.creations[1].adPlatform);
    assert.equal(f.creations[0].budgetMinor, f.creations[1].budgetMinor);
  }
});
test("persistent permission error stops after three attempts without a retry loop", async () => {
  const f = fixture();
  assert.equal((await f.run()).retry, true);
  assert.equal((await f.run()).retry, true);
  assert.equal((await f.run()).retry, false);
  assert.equal(f.row.adStatus, "failed");
  assert.equal(f.probes.length, 2);
  assert.equal(f.creations.length, 3);
  assert.equal((await f.run()).retry, false);
  assert.equal(f.creations.length, 3);
});
test("confirmed missing access stops and reports probe failure", async () => {
  const f = fixture({ probeError: new AdTemplateConfigurationError("Thiếu quyền quảng bá Page") });
  assert.equal((await f.run()).retry, false);
  assert.equal(f.row.adStatus, "failed");
  assert.match(f.row.errorMsg, /Thiếu quyền quảng bá Page/);
});
test("expired token and configuration errors do not enter permission recovery", async () => {
  for (const category of ["token", "configuration", "media"]) {
    const f = fixture({ fail: new MetaApiError(category) });
    assert.equal((await f.run()).retry, false);
    assert.equal(f.probes.length, 0);
  }
});
test("quota during fresh permission check keeps quota retry handling", async () => {
  const f = fixture({ probeError: new MetaApiError("rate_limit") });
  assert.deepEqual(await f.run(), { retry: true, retryAfterSeconds: 300 });
  assert.match(f.row.errorMsg, /\[quota\]/);
  assert.equal(f.row.adAttempt, 0);
});
test("pending recovery label does not claim confirmed missing permission", () => {
  assert.equal(metaErrorDisplay("[permission-retry] code=200 permission denied").kind, "other");
  assert.match(metaErrorDisplay("[permission-retry] code=200").label, /Đang tự thử lại/);
  assert.equal(metaErrorDisplay("[ads] code=200 permission denied").kind, "permission");
});
