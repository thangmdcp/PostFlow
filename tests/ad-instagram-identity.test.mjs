import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createHash } from "node:crypto";
import { buildFacebookExistingPostCreative } from "../lib/instagramAds.ts";

function fixture({ rows = [], getError, postError } = {}) {
  const calls = []; let cache = null; let chain = Promise.resolve();
  const tx = { $queryRawUnsafe: async () => {}, appConfig: {
    findUnique: async () => cache,
    upsert: async ({ create }) => { cache = { ...create, updatedAt: new Date() }; },
  } };
  const mocks = {
    "node:crypto": { createHash },
    "@/lib/meta": { META_GRAPH_API: "https://graph.example/v25.0" },
    "@/lib/prisma": { prisma: { $transaction: (fn) => {
      const result = chain.then(() => fn(tx)); chain = result.catch(() => {}); return result;
    } } },
    "@/lib/metaApiClient": { metaRequestJson: async (url, init) => {
      calls.push(init.method || "GET");
      if (init.method === "POST") { if (postError) throw postError; rows = [{ id: "777" }]; return { data: { id: "777" } }; }
      if (getError) throw getError;
      return { data: { data: rows } };
    } },
  };
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL("../lib/adInstagramIdentity.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: id => mocks[id], Date });
  return { api: module.exports, calls, expire: () => { cache.updatedAt = new Date(0); } };
}
test("linked identity requires no Page-backed creation", async () => {
  const f = fixture();
  const result = await f.api.resolveAdInstagramIdentity("123", "token", "456");
  assert.equal(result.kind, "LINKED"); assert.equal(result.id, "456"); assert.deepEqual(f.calls, []);
});
test("concurrent jobs GET then create once and cache with token fingerprint", async () => {
  const f = fixture();
  const result = await Promise.all([1, 2, 3].map(() => f.api.resolveAdInstagramIdentity("123", "token")));
  assert.equal(result[0].kind, "PAGE_BACKED");
  assert.deepEqual(f.calls, ["GET", "POST"]);
  await f.api.resolveAdInstagramIdentity("123", "new-token");
  assert.deepEqual(f.calls, ["GET", "POST", "GET"]);
  f.expire(); await f.api.resolveAdInstagramIdentity("123", "new-token");
  assert.equal(f.calls.at(-1), "GET");
});
test("GET errors never trigger POST and creation errors do not cache success", async () => {
  for (const getError of [new Error("permission"), new Error("quota"), new Error("timeout")]) {
    const f = fixture({ getError }); await assert.rejects(f.api.resolveAdInstagramIdentity("123", "token"));
    assert.deepEqual(f.calls, ["GET"]);
  }
  const f = fixture({ postError: new Error("unsupported") });
  await assert.rejects(f.api.resolveAdInstagramIdentity("123", "token"));
});
test("existing Page-backed identity does not create and retry cannot switch identity", async () => {
  const f = fixture({ rows: [{ id: "777" }] });
  const identity = await f.api.resolveAdInstagramIdentity("123", "token");
  await f.api.verifyPageBackedIdentity(identity, "token");
  await assert.rejects(f.api.verifyPageBackedIdentity({ ...identity, id: "888" }, "token"));
  assert.deepEqual(f.calls, ["GET"]);
  assert.equal(f.api.parseAdInstagramIdentity({ id: "bad", kind: "PAGE_BACKED", pageId: "123" }), null);
});
test("Facebook creative keeps source and CTA while carrying Instagram identity", () => {
  const creative = buildFacebookExistingPostCreative({ name: "test", objectStoryId: "123_456", instagramUserId: "777", ctaType: "SHOP_NOW", destinationUrl: "https://s.shopee.vn/test", accessToken: "test" });
  assert.equal(creative.instagram_user_id, "777"); assert.equal(creative.object_story_id, "123_456");
  assert.equal(creative.call_to_action.type, "SHOP_NOW"); assert.equal(creative.applink_treatment, "deeplink_with_web_fallback");
});

test("worker snapshots identity before Campaign; cancelled schedules clear it", () => {
  const facebook = readFileSync(new URL("../lib/facebook.ts", import.meta.url), "utf8");
  assert.ok(facebook.indexOf("await onProgress?.({ instagramIdentity: identity })") < facebook.indexOf("const campBody:"));
  assert.match(facebook, /identity\?\.kind !== "PAGE_BACKED"/);
  assert.match(facebook, /campBody\.is_adset_budget_sharing_enabled = false/);
  assert.match(readFileSync(new URL("../app/api/posts/bulk-unschedule/route.ts", import.meta.url), "utf8"), /adInstagramIdentity: Prisma\.DbNull/);
  assert.match(readFileSync(new URL("../lib/autoAdsRunner.ts", import.meta.url), "utf8"), /instagramIdentity: parseAdInstagramIdentity\(postFull\?\.adInstagramIdentity\)/);
});
