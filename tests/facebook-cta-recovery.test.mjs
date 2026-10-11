import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { isFacebookOriginalCtaVerified, shouldProbeFacebookCtaReadiness } from "../lib/facebookOriginalCta.ts";

class MetaApiError extends Error {
  constructor(code, category = "permission") { super(`Meta code=${code}`); this.code = code; this.category = category; }
}
const source = readFileSync(new URL("../lib/autoAdsRunner.ts", import.meta.url), "utf8");
const start = source.indexOf("async function attemptFacebookOriginalCta(");
const code = ts.transpileModule(source.slice(start, source.indexOf("// Called only", start)), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
function fixture({ probeError, mutationError, attempt = 0 } = {}) {
  const row = { id: "post", mediaType: "video", pageId: "page", fbPostId: "video", fbMediaId: "video",
    fbObjectStoryId: "page_story", adDestinationUrl: "https://s.shopee.vn/test", adCtaScope: "AD_AND_FACEBOOK_POST",
    fbCtaStatus: "pending", fbCtaAttempt: attempt, adId: "existing-ad", adCampaignId: "existing-campaign" };
  let ready = false, probes = 0, writes = 0;
  const dependencies = {
    prisma: { post: { update: async ({ data }) => Object.assign(row, data) } },
    resolveAdCtaScope: value => value, MetaApiError, isFacebookOriginalCtaVerified, shouldProbeFacebookCtaReadiness,
    FACEBOOK_CTA_RETRY_DELAYS_MS: [10000, 30000, 120000, 300000, 900000],
    checkFacebookCtaPageReadAccess: async () => { probes++; if (probeError) throw probeError; },
    readFacebookOriginalCta: async () => {
      if (!ready) throw new MetaApiError(10);
      return writes ? { attachmentType: "video_direct_response", ctaType: "SHOP_NOW", destinationUrl: row.adDestinationUrl }
        : { attachmentType: "video_inline", ctaType: null, destinationUrl: null };
    },
    updateFacebookVideoCallToAction: async () => { writes++; if (mutationError) throw mutationError; },
  };
  const run = new Function(...Object.keys(dependencies), `${code}; return attemptFacebookOriginalCta;`)(...Object.values(dependencies));
  return { row, run: () => run(row, "token", "SHOP_NOW"), ready: () => { ready = true; row.fbCtaNextAttemptAt = null; }, counts: () => ({ probes, writes }) };
}
test("fresh story code 10 automatically waits then verifies CTA without recreating Ads", async () => {
  const f = fixture();
  assert.deepEqual(await f.run(), { retry: true, retryAfterSeconds: 10 });
  assert.equal(f.row.fbCtaStatus, "pending");
  assert.match(f.row.fbCtaErrorMsg, /tự thử lại/);
  assert.deepEqual(f.counts(), { probes: 1, writes: 0 });
  f.ready();
  assert.deepEqual(await f.run(), { retry: false });
  assert.equal(f.row.fbCtaStatus, "done");
  assert.ok(f.row.fbCtaVerifiedAt);
  assert.equal(f.row.adId, "existing-ad");
  assert.equal(f.row.adCampaignId, "existing-campaign");
});
test("true permission and token denial stop; transient Page probe waits", async () => {
  for (const error of [new MetaApiError(10), new MetaApiError(190, "token")]) {
    const f = fixture({ probeError: error });
    assert.deepEqual(await f.run(), { retry: false });
    assert.equal(f.row.fbCtaStatus, "failed");
    assert.equal(f.counts().writes, 0);
  }
  const f = fixture({ probeError: new MetaApiError(2, "transient") });
  assert.equal((await f.run()).retry, true);
});
test("readiness retries are bounded and mutation permission failures are not retried", async () => {
  const exhausted = fixture({ attempt: 5 });
  assert.equal((await exhausted.run()).retry, false);
  assert.equal(exhausted.row.fbCtaStatus, "failed");
  const mutation = fixture({ mutationError: new MetaApiError(10) });
  mutation.ready();
  assert.equal((await mutation.run()).retry, false);
  assert.equal(mutation.counts().probes, 0);
});
test("AD_ONLY and NO_BUTTON never read or mutate the original post", async () => {
  const f = fixture();
  f.row.adCtaScope = "AD_ONLY";
  assert.equal((await f.run()).retry, false);
  assert.deepEqual(f.counts(), { probes: 0, writes: 0 });
  assert.equal(shouldProbeFacebookCtaReadiness({ code: 190 }, "read"), false);
});

test("readiness uses delayed Queue backoff instead of a hot retry loop", async () => {
  for (const [attempt, seconds] of [10, 30, 120, 300, 900].entries()) {
    const f = fixture({ attempt });
    assert.equal((await f.run()).retryAfterSeconds, seconds);
    const calls = f.counts();
    assert.equal((await f.run()).retry, true);
    assert.deepEqual(f.counts(), calls);
  }
});

test("Page probe Retry-After is honored", async () => {
  const error = new MetaApiError(4, "rate_limit");
  error.retryAfterSeconds = 600;
  const f = fixture({ probeError: error });
  assert.equal((await f.run()).retryAfterSeconds, 600);
});
