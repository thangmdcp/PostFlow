import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import ts from "typescript";
import * as campaignSource from "../lib/campaignSource.ts";
import { existingAdsTimes } from "../lib/existingAdsPlan.ts";
import * as batchAction from "../lib/batchAction.ts";
import * as adMoney from "../lib/adMoney.ts";
import * as adAudience from "../lib/adAudience.ts";
import { AdSourceNotReadyError, facebookObjectStoryIdCandidate, facebookPromotableStoryId } from "../lib/adSourceReadiness.ts";
import { sanitizeMetaTargeting } from "../lib/instagramAds.ts";

function load(path, mocks) {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("module", "exports", "require", code)(module, module.exports, name => {
    assert.ok(name in mocks, `missing mock ${name}`); return mocks[name];
  });
  return module.exports;
}
const candidate = (storyId = "123_456", campaignId = "120254535360910450", adId = "ad1") => ({ storyId, pageId: storyId.split("_")[0], pageName: "Test Page", message: "original caption https://s.shopee.vn/original", thumbnailUrl: null, permalink: `https://www.facebook.com/${storyId}`,
  sources: [{ campaignId, campaignName: "Original", accountId: "act_1", accountName: "VND", adId, creativeId: "creative-original", adStatus: "PAUSED" }] });

test("campaign ID parsing retains 18-digit strings, deduplicates and rejects invalid or over-limit input", () => {
  assert.deepEqual(campaignSource.parseCampaignIds(["120254535360910450", " 120254535360910450 ", "120254535146940450"]), ["120254535360910450", "120254535146940450"]);
  for (const ids of [[120254535360910450], ["https://facebook.com/ads/1"], ["-12345"], [], Array.from({ length: 201 }, (_, i) => String(120000 + i))]) assert.throws(() => campaignSource.parseCampaignIds(ids));
});
test("source resolution prefers effective Story ID and never substitutes video ID", () => {
  assert.equal(campaignSource.storyIdFromCreative({ effective_object_story_id: "123_1", object_story_id: "123_2", video_id: "3" }), "123_1");
  assert.equal(campaignSource.storyIdFromCreative({ object_story_id: "123_2" }), "123_2");
  assert.equal(campaignSource.storyIdFromCreative({ video_id: "3" }), null);
  assert.equal(campaignSource.storyIdFromCreative({ effective_object_story_id: "invalid", object_story_id: "123_2" }), null);
});
test("same post across ads and campaigns is selected once with complete provenance", () => {
  const rows = campaignSource.mergeCampaignCandidates([candidate(), candidate("123_456", "other", "ad2"), candidate(), candidate("123_789")]);
  assert.equal(rows.length, 2); assert.equal(rows[0].sources.length, 2);
  assert.equal(candidate().sources.length, 1);
  assert.throws(() => campaignSource.assertSourceStory(rows[0], "999", rows[0].storyId));
});
test("preserved creative has no CTA, destination, content, media or deep-link override", () => {
  assert.deepEqual(campaignSource.preservedFacebookCreative("Reuse", "123_456", "fake"), { name: "Reuse", object_story_id: "123_456", access_token: "fake" });
});

const scheduleInput = { ids: ["a", "b", "c"], scheduleMode: "interval", baseTime: "2030-01-01T09:00", manualTime: "2030-01-01T09:00", stepMinutes: "5", postsPerDay: "2", endTime: "", adLaunchAt: "2030-01-01T10:00", prepareSpacing: "10" };
test("schedule waits to create, prepare spaces creation before launch, immediate creates now", () => {
  const now = new Date("2030-01-01T08:00:00+07:00").getTime();
  const scheduled = existingAdsTimes({ ...scheduleInput, kind: "schedule" }, now);
  assert.equal(scheduled[1].createAt.toISOString(), "2030-01-01T02:05:00.000Z"); assert.equal(scheduled[0].startAt, null);
  const prepared = existingAdsTimes({ ...scheduleInput, kind: "prepare" }, now);
  assert.equal(prepared[2].createAt.getTime(), now + 20 * 60000); assert.equal(prepared[2].startAt.toISOString(), "2030-01-01T03:00:00.000Z");
  assert.ok(existingAdsTimes({ ...scheduleInput, kind: "publish" }, now).every(p => p.createAt.getTime() === now && p.startAt === null));
  assert.throws(() => existingAdsTimes({ ...scheduleInput, kind: "prepare", prepareSpacing: "70" }, now));
  assert.throws(() => existingAdsTimes({ ...scheduleInput, kind: "prepare", prepareSpacing: "NaN" }, now));
});

class MetaApiError extends Error { constructor(category) { super(`Meta ${category}`); this.category = category; this.retryAfterSeconds = 123; } }
function importerFixture(graph) {
  const source = { id: "source", campaignId: "120254535360910450", tokenCursor: 0, candidates: [], issues: [], status: "pending", attempt: 0, nextAttemptAt: null, leaseUntil: null, updatedAt: new Date(0) };
  const calls = [];
  const prisma = { campaignImportSource: { findUnique: async () => ({ ...source }), updateMany: async ({ data }) => { Object.assign(source, data); source.updatedAt = new Date(); return { count: 1 }; } },
    fbAdAccount: { findMany: async () => [{ accountId: "act_1", name: "VND", accessToken: "fake1" }, { accountId: "act_2", name: "USD", accessToken: "fake2" }] },
    post: { findFirst: async () => null }, campaignTemplate: { findFirst: async () => null },
    fbConnection: { findUnique: async ({ where }) => ({ pageId: where.pageId, pageName: "Page", accessToken: "fake-page" }) } };
  const api = load("lib/campaignImport.ts", {
    "node:crypto": { createHash }, "@prisma/client": { Prisma: {} }, "@/lib/prisma": { prisma },
    "@/lib/meta": { META_GRAPH_API: "https://graph.example/v25" },
    "@/lib/metaApiClient": { MetaApiError, metaRequestJson: async raw => { const url = new URL(raw); calls.push(url); return { data: await graph(url) }; } },
    "@/lib/metaThrottle": { reserveMetaJob: async () => ({ allowed: true }), scopesForPost: () => [] }, "@/lib/cloudflareQueue": {}, "@/lib/campaignSource": campaignSource,
  });
  return { source, calls, run: async () => { source.nextAttemptAt = null; return api.processCampaignSource(source.id); } };
}
const ad = (id, storyId, status = "PAUSED") => ({ id, effective_status: status, creative: { id: `creative-${id}`, effective_object_story_id: storyId } });
test("campaign reader persists pagination, merges ads and never follows a token-bearing next URL", async () => {
  const f = importerFixture(url => {
    if (url.pathname.endsWith("/ads")) return url.searchParams.has("after") ? { data: [ad("a2", "123_456", "ACTIVE"), ad("a3", "123_789")] } : { data: [ad("a1", "123_456")], paging: { next: "https://untrusted.invalid/?access_token=secret", cursors: { after: "page2" } } };
    if (url.pathname.endsWith("120254535360910450")) return { id: "120254535360910450", name: "Campaign", account_id: "1", objective: "OUTCOME_TRAFFIC" };
    return { id: url.pathname.split("/").at(-1), message: "unchanged", is_eligible_for_promotion: true };
  });
  assert.equal((await f.run()).retry, true); assert.equal(f.source.cursor, "page2");
  assert.equal((await f.run()).retry, false); assert.equal(f.source.status, "done");
  assert.equal(f.source.candidates.length, 2); assert.equal(f.source.candidates[0].sources.length, 2);
  assert.ok(f.calls.every(url => url.hostname === "graph.example"));
  const count = f.calls.length; await f.run(); assert.equal(f.calls.length, count);
});
test("quota waits without trying unrelated tokens; definite denial probes one token per delivery", async () => {
  const quota = importerFixture(() => { throw new MetaApiError("rate_limit"); });
  assert.equal((await quota.run()).retry, true); assert.equal(quota.calls.length, 1); assert.equal(quota.source.attempt, 0); assert.equal(quota.source.tokenCursor, 0);
  const denial = importerFixture(() => { throw new MetaApiError("permission"); });
  assert.equal((await denial.run()).retry, true); assert.equal(denial.calls.length, 1); assert.equal(denial.source.tokenCursor, 1);
  assert.equal((await denial.run()).retry, false); assert.equal(denial.source.status, "failed");
});
test("database transaction timeout is retried rather than misreported as an unreadable campaign", async () => {
  const error = Object.assign(new Error("Transaction not found"), { code: "P2028" });
  const f = importerFixture(() => { throw error; });
  assert.equal((await f.run()).retry, true); assert.equal(f.source.status, "pending");
  assert.ok(f.source.nextAttemptAt instanceof Date); assert.ok(!f.source.errorMsg.includes("Transaction not found"));
});
test("missing/deleted/unpromotable post is reported without substituting another post", async () => {
  const f = importerFixture(url => {
    if (url.pathname.endsWith("/ads")) return { data: [ad("a1", "123_456"), { id: "a2", creative: { id: "c2", video_id: "456" } }] };
    if (url.pathname.endsWith("120254535360910450")) return { id: "120254535360910450", name: "Campaign", account_id: "1", objective: "OUTCOME_TRAFFIC" };
    return { id: "123_456", is_eligible_for_promotion: false };
  });
  await f.run(); assert.equal(f.source.status, "failed"); assert.equal(f.source.candidates.length, 0); assert.equal(f.source.issues.length, 2);
});

class AdTemplateConfigurationError extends Error {}
const cloneText = readFileSync(new URL("../lib/facebook.ts", import.meta.url), "utf8");
const cloneCode = ts.transpileModule(cloneText.slice(cloneText.indexOf("export async function cloneAdCampaign(")), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function cloneFixture({ mismatch = false, missing = false, activationFailure = false } = {}) {
  const calls = [], state = {};
  let failActivation = activationFailure;
  const dependencies = { AdTemplateConfigurationError, AdSourceNotReadyError, MetaApiError, sanitizeMetaTargeting,
    facebookObjectStoryIdCandidate, facebookPromotableStoryId, preservedFacebookCreative: campaignSource.preservedFacebookCreative,
    ensureAdAssetAccess: async () => "fake-creative-token", FB_API: "https://graph.example/v25", prisma: { appConfig: { deleteMany: async () => {} } },
    metaJson: async (url, init = {}) => {
      const node = new URL(url).pathname.split("/").at(-1); const body = init.body ? JSON.parse(init.body) : null;
      calls.push({ node, body });
      if (body?.status === "ACTIVE" && failActivation) { failActivation = false; throw new Error("activation timeout"); }
      if (!body) return node === "123_456" ? { id: "123_456", is_eligible_for_promotion: true } : { effective_object_story_id: missing ? undefined : mismatch ? "123_999" : "123_456" };
      return { id: ({ campaigns: "new-campaign", adsets: "new-adset", adcreatives: "new-creative", ads: "new-ad" })[node] };
    },
  };
  const exports = {};
  new Function("exports", ...Object.keys(dependencies), cloneCode)(exports, ...Object.values(dependencies));
  const run = status => exports.cloneAdCampaign({ name: "Template", targeting: {}, objective: "OUTCOME_TRAFFIC", targetingAutomation: {}, billingEvent: "IMPRESSIONS", optimizationGoal: "LINK_CLICKS", specialAdCategories: [], useCampaignBudget: true }, "123", { platform: "facebook", fbPostId: "123_456", ctaType: "NO_BUTTON", preserveOriginal: true }, "1", "fake-account", "50000", "fake-page", "Reuse", 18, 50, "", status, undefined, undefined, undefined, state, async update => Object.assign(state, update));
  return { run, calls, state };
}
test("new assets stay PAUSED until exact Story ID verified; activation proceeds leaf to campaign", async () => {
  const f = cloneFixture(); await f.run("ACTIVE");
  assert.ok(f.calls.filter(c => c.body && ["campaigns", "adsets", "ads"].includes(c.node)).every(c => c.body.status === "PAUSED"));
  assert.deepEqual(f.calls.filter(c => c.body?.status === "ACTIVE").map(c => c.node), ["new-ad", "new-adset", "new-campaign"]);
  const creative = f.calls.find(c => c.node === "adcreatives").body;
  assert.deepEqual(Object.keys(creative).sort(), ["access_token", "name", "object_story_id"]);
  assert.ok(f.calls.findIndex(c => c.node === "new-creative") < f.calls.findIndex(c => c.node === "ads"));
});
test("mismatched or unavailable effective Story ID prevents ad creation and activation", async () => {
  for (const options of [{ mismatch: true }, { missing: true }]) {
    const f = cloneFixture(options); await assert.rejects(f.run("ACTIVE"));
    assert.ok(!f.calls.some(c => c.node === "ads" || c.body?.status === "ACTIVE"));
  }
});
test("activation retry reuses every saved ID; PAUSED choice never activates", async () => {
  const f = cloneFixture({ activationFailure: true }); await assert.rejects(f.run("ACTIVE"));
  assert.equal(f.state.adId, "new-ad"); const count = f.calls.filter(c => ["campaigns", "adsets", "adcreatives", "ads"].includes(c.node)).length;
  await f.run("ACTIVE"); assert.equal(f.calls.filter(c => ["campaigns", "adsets", "adcreatives", "ads"].includes(c.node)).length, count);
  const paused = cloneFixture(); await paused.run("PAUSED"); assert.ok(!paused.calls.some(c => c.body?.status === "ACTIVE"));
});

test("twenty-post action freezes account/currency/budget once and does not re-roll after lost response", async () => {
  const posts = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, sourceKind: campaignSource.EXISTING_FACEBOOK_SOURCE, pageId: "123", sourceStoryId: `123_${i + 1}`, fbPostId: `123_${i + 1}`, fbObjectStoryId: `123_${i + 1}`, adSourceSnapshot: candidate(`123_${i + 1}`), updatedAt: new Date(0), adStatus: null }));
  const actions = new Map(); const checks = [];
  const prisma = { post: { findMany: async () => posts, updateMany: async ({ where, data }) => {
    const post = posts.find(p => p.id === where.id); if (!post || post.adStatus !== null) return { count: 0 }; Object.assign(post, data); return { count: 1 };
  } }, existingAdsAction: { findUnique: async ({ where }) => actions.get(where.requestKey), create: async ({ data }) => { actions.set(data.requestKey, data); } },
  fbConnection: { findUnique: async () => ({ accessToken: "fake-page" }) }, $queryRawUnsafe: async () => {}, $transaction: async fn => fn(prisma) };
  const config = { ...scheduleInput, adConfig: { adStatus: "PAUSED", ageMinFrom: "18", ageMinTo: "18", ageMaxFrom: "50", ageMaxTo: "50", gender: "", advantage: {} }, accountRows: [
    { accountId: "act_1", weight: 50, templateId: "template", budgetMin: "50000", budgetMax: "50000", budgetStep: "1", budgetCurrency: "VND" },
    { accountId: "act_2", weight: 50, templateId: "template", budgetMin: "4", budgetMax: "4", budgetStep: "0.01", budgetCurrency: "USD" },
  ] };
  const api = load("lib/existingPostAds.ts", { "node:crypto": { createHash }, "@prisma/client": { Prisma: { DbNull: null } }, "@/lib/prisma": { prisma },
    "@/lib/campaignSource": campaignSource, "@/lib/existingAdsPlan": { existingAdsTimes }, "@/lib/batchAction": batchAction,
    "@/lib/adSelection": { validateAdSelection: async () => null }, "@/lib/adBudgetRequest": { resolveAdBudgetSnapshot: async ({ accountId, budget }) => {
      checks.push({ accountId, ...budget }); const currency = accountId === "act_1" ? "VND" : "USD";
      assert.equal(budget.currency, currency); return { account: { currency }, amountMajor: budget.amount, amountMinor: adMoney.majorToMinor(budget.amount, currency), currency };
    } }, "@/lib/adAdvantageServer": { resolvePostAdAdvantage: async () => ({ audienceEnabled: false, placementsEnabled: true }) },
    "@/lib/adAudienceServer": { resolvePostAdAudience: async () => null }, "@/lib/adAudience": adAudience,
    "@/lib/adPlacements": { parseAdPlacementConfig: () => null }, "@/lib/adPermissionPreflight": { preflightPostAdPermission: async () => {} }, "@/lib/adMoney": adMoney,
    "@/lib/adSettings": { randomInteger: min => min }, "@/lib/cloudflareQueue": {},
    "@/lib/adBudgetPolicy": { validateMinorBudgetForAccount: ({ account, currency, amountMinor }) => {
      assert.equal(currency, account.currency); return { amountMinor, amountMajor: adMoney.minorToMajor(amountMinor, currency), currency };
    } },
  });
  const input = { requestKey: "action-request-12345", postIds: posts.map(p => p.id), kind: "schedule", config };
  const result = await api.configureExistingAds(input); assert.equal(result.count, 20);
  for (const post of posts) {
    const usd = post.adAccountUsed === "act_2"; assert.equal(post.adBudgetMinor, usd ? "400" : "50000"); assert.equal(post.adBudgetCurrency, usd ? "USD" : "VND");
    assert.equal(post.fbPostId, post.adSourceSnapshot.storyId); assert.equal(post.adCtaScope, "AD_ONLY"); assert.equal(post.storyEnabled, false);
  }
  assert.equal((await api.configureExistingAds(input)).reused, true); assert.equal(checks.length, 2);
});

function guardedModule(path, prisma, extra = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const mocks = Object.fromEntries([...source.matchAll(/from\s+["']([^"']+)["']/g)].map(match => [match[1], {}]));
  return load(path, { ...mocks, "@/lib/prisma": { prisma }, "next/server": { NextResponse: { json: (body, options = {}) => ({ body, status: options.status ?? 200 }) } }, ...extra });
}
test("direct publish/schedule/media/comment/affiliate/legacy-create requests reject reused posts before any mutation", async () => {
  const post = { id: "p", sourceKind: campaignSource.EXISTING_FACEBOOK_SOURCE };
  const prisma = { post: { findUnique: async () => post }, extractedLink: { findUnique: async () => ({ post }) } };
  const paths = [
    ["app/api/posts/[id]/publish/route.ts", "POST"], ["app/api/posts/[id]/queue-publish/route.ts", "POST"],
    ["app/api/posts/[id]/schedule/route.ts", "PATCH"], ["app/api/posts/[id]/retry/route.ts", "POST"],
    ["app/api/posts/[id]/upload-media/route.ts", "POST"], ["app/api/posts/[id]/comments/route.ts", "POST"],
    ["app/api/posts/[id]/links/route.ts", "POST"], ["app/api/links/[id]/route.ts", "PATCH"], ["app/api/ads/create/route.ts", "POST"],
  ];
  for (const [path, method] of paths) {
    const api = guardedModule(path, prisma);
    const request = { json: async () => ({ pageId: "123", postId: "p", comments: [{ text: "not allowed" }], competitorUrl: "https://example.com", myUrl: "https://example.com" }) };
    const result = await api[method](request, { params: { id: "p" } });
    assert.equal(result.status, 409, path);
  }
});
test("stale queue runners cannot fetch, publish, comment or post a Story for reused posts", async () => {
  const post = { id: "p", sourceKind: campaignSource.EXISTING_FACEBOOK_SOURCE, status: "queued" };
  const prisma = { post: { findUnique: async () => post }, postComment: { findUnique: async () => ({ post }) } };
  const publish = guardedModule("lib/publishDuePost.ts", prisma);
  assert.equal((await publish.publishDuePost(post)).status, "skipped");
  const fetch = guardedModule("lib/fetchPostJob.ts", prisma);
  assert.equal((await fetch.processFetchPost("p")).status, "skipped");
  const comments = guardedModule("lib/autoCommentsRunner.ts", prisma);
  await assert.rejects(comments.persistCommentJobs("p", [{ text: "not allowed" }]));
  await comments.scheduleCommentJobs("p");
  assert.equal((await comments.attemptComment("c")).retry, false);
  const story = guardedModule("lib/autoStoryRunner.ts", prisma);
  assert.equal((await story.attemptStory("p")).retry, false);
});
test("confirmation is idempotent, uses only server candidates and never copies original asset IDs into new asset slots", async () => {
  const session = { id: "import", sources: [{ status: "done", candidates: [candidate()] }] };
  const posts = []; let batches = 0; let locks = 0;
  const tx = { $queryRawUnsafe: async () => { locks++; },
    campaignImport: { findUnique: async () => session, update: async ({ data }) => Object.assign(session, data) },
    batch: { create: async () => ({ id: `batch${++batches}` }) }, post: { createMany: async ({ data }) => posts.push(...data) } };
  const prisma = { $transaction: async fn => fn(tx) };
  const api = guardedModule("lib/campaignImport.ts", prisma, { "node:crypto": { createHash }, "@prisma/client": { Prisma: {} }, "@/lib/campaignSource": campaignSource });
  await assert.rejects(api.confirmCampaignImport("import", ["123_999"]));
  assert.equal(await api.confirmCampaignImport("import", ["123_456"]), "batch1");
  assert.equal(await api.confirmCampaignImport("import", ["123_456"]), "batch1");
  assert.equal(posts.length, 1); assert.equal(batches, 1); assert.ok(locks >= 3);
  assert.equal(posts[0].fbObjectStoryId, "123_456"); assert.equal(posts[0].adSourceSnapshot.sources[0].creativeId, "creative-original");
  for (const field of ["adCampaignId", "adSetId", "adCreativeId", "adId"]) assert.equal(posts[0][field], undefined);
});
test("cancel clears only unstarted paid work and leaves immutable source and existing paid assets untouched", async () => {
  const posts = [
    { id: "a", sourceKind: campaignSource.EXISTING_FACEBOOK_SOURCE, adStatus: "scheduled", fbPostId: "123_456", adSourceSnapshot: candidate() },
    { id: "b", sourceKind: campaignSource.EXISTING_FACEBOOK_SOURCE, adStatus: "creating", adCampaignId: "new-campaign" },
    { id: "c", sourceKind: campaignSource.EXISTING_FACEBOOK_SOURCE, adStatus: "pending", adCreativeId: "new-creative" },
  ];
  const prisma = { post: { updateMany: async ({ where, data }) => {
    assert.equal(where.adCampaignId, null); assert.equal(where.adCreativeId, null); assert.equal(where.adId, null);
    const eligible = posts.filter(p => where.id.in.includes(p.id) && where.adStatus.in.includes(p.adStatus) && !p.adCampaignId && !p.adCreativeId);
    eligible.forEach(p => Object.assign(p, data)); return { count: eligible.length };
  } } };
  const api = guardedModule("lib/existingPostAds.ts", prisma, { "@/lib/campaignSource": campaignSource, "@prisma/client": { Prisma: { DbNull: null } } });
  assert.equal(await api.cancelExistingAds(["a", "b", "c"]), 1);
  assert.equal(posts[0].adStatus, null); assert.equal(posts[0].fbPostId, "123_456"); assert.equal(posts[0].adSourceSnapshot.storyId, "123_456");
  assert.equal(posts[0].adAudienceSnapshot, null);
  assert.equal(posts[1].adStatus, "creating"); assert.equal(posts[2].adCreativeId, "new-creative");
});

test("campaign-source jobs use metadata queue and invoke only their resolver endpoint", async () => {
  const api = load("cloudflare/postflow-queue/src/index.ts", {});
  const sent = []; const calls = []; let acknowledged = false;
  const queue = name => ({ send: async job => sent.push({ name, job }) });
  const env = { POSTFLOW_QUEUE_SECRET: "fake-secret", POSTFLOW_API_URL: "https://postflow.example",
    POSTFLOW_FETCH_QUEUE: queue("metadata"), POSTFLOW_DOWNLOAD_QUEUE: queue("download"), POSTFLOW_UPLOAD_QUEUE: queue("upload"), POSTFLOW_ADS_QUEUE: queue("ads"), POSTFLOW_PUBLISH_QUEUE: queue("publish"), POSTFLOW_ENGAGEMENT_QUEUE: queue("engagement") };
  const response = await api.default.fetch(new Request("https://worker.example/enqueue", { method: "POST", headers: { authorization: "Bearer fake-secret", "content-type": "application/json" }, body: JSON.stringify({ type: "campaign-source", sourceId: "s1" }) }), env);
  assert.equal(response.status, 202); assert.deepEqual(sent, [{ name: "metadata", job: { type: "campaign-source", sourceId: "s1" } }]);
  const before = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init) => { calls.push({ url, job: JSON.parse(init.body) }); return Response.json({ continued: true }); };
    await api.default.queue({ queue: "postflow-fetch", messages: [{ body: sent[0].job, ack: () => { acknowledged = true; }, retry: () => assert.fail("successful source continuation must ACK") }] }, env);
  } finally { globalThis.fetch = before; }
  assert.equal(acknowledged, true); assert.equal(calls[0].url, "https://postflow.example/api/queue/campaign-source");
  assert.deepEqual(calls[0].job, { type: "campaign-source", sourceId: "s1" });
});
