// Live acceptance: reads only the supplied source campaign; paid creation is
// opt-in with explicit destination account/template/currency/amount, always PAUSED.
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const { randomUUID } = require("node:crypto");
const root = path.resolve(__dirname, "..");
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...args) {
  if (request.startsWith("@/")) {
    const base = path.join(root, request.slice(2));
    request = [base, `${base}.ts`, `${base}.tsx`].find(file => fs.existsSync(file)) ?? base;
  }
  return resolve.call(this, request, parent, ...args);
};
for (const extension of [".ts", ".tsx"]) Module._extensions[extension] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, file);

const arg = name => process.argv[process.argv.indexOf(name) + 1];
const campaignId = arg("--campaign");
if (!process.argv.includes("--campaign") || !/^\d{5,30}$/.test(campaignId)) throw new Error("Supply --campaign <ID>.");
const { prisma } = require("@/lib/prisma");
async function main() {
  const { createCampaignImport, processCampaignSource, getCampaignImport, confirmCampaignImport } = require("@/lib/campaignImport");
  const session = process.argv.includes("--import") ? await prisma.campaignImport.findUniqueOrThrow({ where: { id: arg("--import") }, include: { sources: true } }) : await createCampaignImport({ campaignIds: [campaignId], requestKey: randomUUID() });
  if (session.sources.length !== 1 || session.sources[0].campaignId !== campaignId) throw new Error("Import does not match the supplied campaign.");
  const source = session.sources[0];
  if (process.argv.includes("--resume")) await prisma.campaignImportSource.updateMany({ where: { id: source.id, status: "failed" }, data: { status: "pending", errorMsg: null, attempt: 0, nextAttemptAt: null, leaseUntil: null } });
  // Normal producer uses Queue. Acceptance drives only this isolated import
  // and honors persisted backoff; it never invokes the global cron/recovery.
  for (let i = 0; i < 100; i++) {
    const state = await prisma.campaignImportSource.findUniqueOrThrow({ where: { id: source.id } });
    if (["done", "failed"].includes(state.status)) break;
    const delay = Math.max(0, (state.nextAttemptAt?.getTime() ?? 0) - Date.now());
    if (delay > 30_000) throw new Error("Source is waiting for Meta quota/network; resume via the saved import.");
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    await processCampaignSource(source.id);
  }
  const result = await getCampaignImport(session.id);
  console.log(JSON.stringify({ importId: session.id, campaignId, sources: result.sources.map(s => ({ status: s.status, error: s.errorMsg, issues: s.issues })),
    candidates: result.candidates.map(c => ({ storyId: c.storyId, pageId: c.pageId, sourceAccountId: c.sources[0].accountId })) }));
  if (!result.candidates.length || result.sources.some(s => s.status !== "done")) throw new Error("Source acceptance did not complete.");
  if (!process.argv.includes("--create-paused")) return;
  for (const key of ["--account", "--template", "--amount", "--currency"]) if (!process.argv.includes(key)) throw new Error(`Supply ${key} for PAUSED acceptance.`);
  const accountId = arg("--account"), templateId = arg("--template"), amount = arg("--amount"), currency = arg("--currency");
  const batchId = await confirmCampaignImport(session.id, [result.candidates[0].storyId]);
  const post = await prisma.post.findFirstOrThrow({ where: { batchId } });
  const { configureExistingAds } = require("@/lib/existingPostAds");
  const { DEFAULT_BATCH_ADVANTAGE } = require("@/lib/adAdvantage");
  const { dateToVnSchedule } = require("@/lib/schedulePlan");
  const { currencyMajorInputStep } = require("@/lib/adMoney");
  const later = dateToVnSchedule(new Date(Date.now() + 24 * 3600_000));
  const config = { adConfig: { adStatus: "PAUSED", ageMinFrom: "18", ageMinTo: "18", ageMaxFrom: "50", ageMaxTo: "50", gender: "", advantage: DEFAULT_BATCH_ADVANTAGE },
    accountRows: [{ accountId, templateId, weight: 100, budgetMin: amount, budgetMax: amount, budgetStep: currencyMajorInputStep(currency), budgetCurrency: currency }],
    scheduleMode: "manual", baseTime: later, manualTime: later, stepMinutes: "5", postsPerDay: "1", endTime: "", prepareSpacing: "0", adLaunchAt: later };
  if (!post.adStatus) await configureExistingAds({ requestKey: randomUUID(), postIds: [post.id], kind: "schedule", config });
  else if (post.adPublishStatus !== "PAUSED" || post.adAccountUsed !== accountId || post.adTemplateId !== templateId || post.adBudgetCurrency !== currency || post.adBudget !== amount) throw new Error("Existing acceptance snapshot differs; do not overwrite it.");
  if (post.adStatus !== "done") await prisma.post.updateMany({ where: { id: post.id, adStatus: { in: ["scheduled", "failed", "pending", "queued"] } }, data: { adStatus: "pending", adNextAttemptAt: new Date(), campaignName: `[PostFlow PAUSED acceptance] ${batchId}` } });
  const { reserveMetaJob, scopesForPost } = require("@/lib/metaThrottle");
  const gate = await reserveMetaJob("ads", scopesForPost(post.pageId, accountId), post.id);
  if (!gate.allowed) {
    await prisma.post.updateMany({ where: { id: post.id, adStatus: "pending" }, data: { adNextAttemptAt: new Date(Date.now() + gate.retryAfterSeconds * 1000), errorMsg: gate.reason ?? "Waiting for quota" } });
    throw new Error("Ads quota gate is waiting; isolated PAUSED job remains recoverable.");
  }
  if (post.adStatus !== "done") await require("@/lib/autoAdsRunner").attemptAutoAds(post.id);
  const created = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
  console.log(JSON.stringify({ batchId, postId: post.id, adStatus: created.adStatus, requestedStatus: created.adPublishStatus, storyId: created.fbObjectStoryId,
    campaignId: created.adCampaignId, adSetId: created.adSetId, creativeId: created.adCreativeId, adId: created.adId, currency: created.adBudgetCurrency, amountMinor: created.adBudgetMinor, error: created.errorMsg }));
  if (created.adStatus !== "done" || created.adPublishStatus !== "PAUSED") throw new Error("PAUSED acceptance incomplete; no ACTIVE request was made.");
  const account = await prisma.fbAdAccount.findUniqueOrThrow({ where: { accountId } });
  const page = await prisma.fbConnection.findUniqueOrThrow({ where: { pageId: created.pageId } });
  const { metaRequestJson } = require("@/lib/metaApiClient");
  const { META_GRAPH_API } = require("@/lib/meta");
  const read = async (id, fields, token = account.accessToken) => (await metaRequestJson(`${META_GRAPH_API}/${id}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(12_000) }, { adAccountId: accountId, pageId: page.pageId })).data;
  const campaign = await read(created.adCampaignId, "id,status,daily_budget");
  const adSet = await read(created.adSetId, "id,status,daily_budget");
  const ad = await read(created.adId, "id,status");
  const creative = await read(created.adCreativeId, "id,effective_object_story_id");
  const original = await read(created.fbObjectStoryId, "id,message", page.accessToken);
  const verification = { statuses: [campaign.status, adSet.status, ad.status], storyMatches: creative.effective_object_story_id === created.fbObjectStoryId,
    originalCaptionUnchanged: (original.message ?? "") === created.adSourceSnapshot.message,
    budgetMatches: String(campaign.daily_budget ?? adSet.daily_budget) === created.adBudgetMinor, currency: created.adBudgetCurrency };
  console.log(JSON.stringify({ verification }));
  if (verification.statuses.some(status => status !== "PAUSED") || !verification.storyMatches || !verification.originalCaptionUnchanged || !verification.budgetMatches) throw new Error("Live PAUSED/Story/budget verification did not pass.");
}
main().catch(error => { console.error("Campaign acceptance incomplete:", error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
