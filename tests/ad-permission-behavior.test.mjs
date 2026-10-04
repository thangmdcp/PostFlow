import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import ts from "typescript";

// Execute the actual permission functions with Graph/database fakes. No token,
// live account or campaign mutation is needed for these regression scenarios.
const source = await readFile(new URL("../lib/facebook.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source.slice(source.indexOf("function permissionCacheKey("), source.indexOf("export async function cloneAdCampaign(")), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
class MetaApiError extends Error {
  constructor(category) { super("Graph probe failed"); this.category = category; }
}
class AdTemplateConfigurationError extends Error {}
function fixture(graph, cached) {
  const calls = [];
  const rows = new Map();
  const writes = [];
  const prisma = { metaPermissionCache: {
    findUnique: async ({ where }) => rows.get(where.cacheKey) ?? cached ?? null,
    deleteMany: async ({ where }) => { rows.delete(where.cacheKey); cached = null; },
    upsert: async ({ where, create }) => { rows.set(where.cacheKey, create); writes.push(create); },
  } };
  const metaJson = async (raw) => { const url = new URL(raw); calls.push(url); return graph(url, calls.length); };
  const exports = {};
  new Function("exports", "createHash", "prisma", "metaJson", "MetaApiError", "AdTemplateConfigurationError", "FB_API", code)(
    exports, createHash, prisma, metaJson, MetaApiError, AdTemplateConfigurationError, "https://graph.facebook.com/v23.0",
  );
  return { check: exports.ensureAdAssetAccess, calls, writes };
}
const denied = (url) => url.pathname.endsWith("promote_pages") ? { data: [] } : {};

test("stale negative cache does not block fresh automatic permission lookup", async () => {
  const f = fixture(() => ({ data: [{ id: "page" }] }), { allowed: false, expiresAt: new Date(Date.now() + 3600000) });
  assert.equal(await f.check("act_123", "page", undefined, "account"), "account");
  assert.equal(f.calls.length, 1);
  assert.equal(f.writes[0].allowed, true);
});
test("discovery permission error still tries the exact scoped Page/account token", async () => {
  const f = fixture((url) => {
    if (url.pathname.endsWith("promote_pages")) throw new MetaApiError("permission");
    assert.equal(url.searchParams.get("access_token"), "page-token");
    return url.pathname.endsWith("act_123") ? { id: "act_123", account_status: 1 } : { id: "page" };
  });
  assert.equal(await f.check("123", "page", undefined, "account", "page-token"), "page-token");
  assert.equal(f.writes[0].errorMsg, "__POSTFLOW_USE_PAGE_TOKEN__");
});
test("automatic recheck succeeds without a manual Retry and writes no denial", async () => {
  let probes = 0;
  const f = fixture((url) => url.pathname.endsWith("promote_pages")
    ? { data: ++probes === 1 ? [] : [{ id: "page" }] } : {});
  assert.equal(await f.check("123", "page", undefined, "account"), "account");
  assert.equal(probes, 2);
  assert.equal(f.writes.length, 1);
});
test("confirmed denial stops after two probes and is never cached", async () => {
  const f = fixture(denied);
  await assert.rejects(f.check("123", "page", undefined, "account"), AdTemplateConfigurationError);
  assert.equal(f.calls.filter((url) => url.pathname.endsWith("promote_pages")).length, 2);
  assert.equal(f.writes.length, 0);
});
test("unreadable discovery is not reported as confirmed missing Page permission", async () => {
  const f = fixture(() => { throw new MetaApiError("permission"); });
  await assert.rejects(f.check("123", "page", undefined, "account"), (error) =>
    !(error instanceof AdTemplateConfigurationError) && error.message.includes("[asset-access-check]"));
  assert.equal(f.calls.length, 2);
});
test("cache identity changes with either token and contains no raw token", async () => {
  const f = fixture(() => ({ data: [{ id: "page" }] }));
  await f.check("123", "page", undefined, "account-secret", "page-secret");
  await f.check("123", "page", undefined, "account-secret", "page-secret");
  assert.equal(f.calls.length, 1);
  await f.check("123", "page", undefined, "new-account", "page-secret");
  await f.check("123", "page", undefined, "new-account", "new-page");
  assert.equal(f.calls.length, 3);
  assert.equal(new Set(f.writes.map((row) => row.cacheKey)).size, 3);
  assert.ok(f.writes.every((row) => !/secret|new-account|new-page/.test(row.cacheKey)));
});
test("Page and Instagram discovery follow later pages using original endpoint", async () => {
  const f = fixture((url) => {
    if (!url.searchParams.has("after")) return { data: [], paging: { next: "https://untrusted.invalid/", cursors: { after: "cursor" } } };
    return { data: [{ id: url.pathname.endsWith("instagram_accounts") ? "ig" : "page" }] };
  });
  assert.equal(await f.check("123", "page", "ig", "account"), "account");
  assert.equal(f.calls.length, 4);
  assert.ok(f.calls.every((url) => url.hostname === "graph.facebook.com"));
});
test("partner Page success is not lost when owned_pages discovery fails", async () => {
  const f = fixture((url) => {
    if (url.pathname.endsWith("owned_pages")) throw new MetaApiError("permission");
    if (url.pathname.endsWith("client_pages")) return { data: [{ id: "page" }] };
    if (url.pathname.endsWith("promote_pages")) return { data: [] };
    return { business: { id: "bm" } };
  });
  assert.equal(await f.check("123", "page", undefined, "account"), "account");
});
test("fallback cannot switch to another account or bypass inactive account", async () => {
  for (const target of [{ id: "act_other", account_status: 1 }, { id: "act_123", account_status: 2 }]) {
    const f = fixture((url) => {
      if (url.searchParams.get("access_token") === "account") return denied(url);
      return url.pathname.endsWith("act_123") ? target : { id: "page" };
    });
    await assert.rejects(f.check("123", "page", undefined, "account", "page-token"), AdTemplateConfigurationError);
    assert.equal(f.writes.length, 0);
  }
});
test("token/rate-limit/transient failures preserve structured queue error", async () => {
  for (const category of ["token", "rate_limit", "transient"]) {
    const error = new MetaApiError(category);
    const f = fixture(() => { throw error; });
    await assert.rejects(f.check("123", "page", undefined, "account", "page-token"), (actual) => actual === error);
    assert.equal(f.calls.length, 1);
    assert.equal(f.writes.length, 0);
  }
});
test("manual force refresh ignores a positive cached check", async () => {
  const f = fixture(denied, { allowed: true, expiresAt: new Date(Date.now() + 3600000) });
  await assert.rejects(f.check("123", "page", undefined, "account", undefined, { forceRefresh: true }), AdTemplateConfigurationError);
  assert.equal(f.calls.filter((url) => url.pathname.endsWith("promote_pages")).length, 2);
});
test("fallback rejects another Page and requires the selected Instagram identity", async () => {
  for (const wrongPage of [true, false]) {
    const f = fixture((url) => {
      if (url.searchParams.get("access_token") === "account") return denied(url);
      if (url.pathname.endsWith("act_123")) return { id: "act_123", account_status: 1 };
      if (url.pathname.endsWith("instagram_accounts")) return { data: [{ id: "other-ig" }] };
      return { id: wrongPage ? "other-page" : "page" };
    });
    await assert.rejects(f.check("123", "page", "ig", "account", "page-token"), AdTemplateConfigurationError);
    assert.equal(f.writes.length, 0);
  }
});
test("broken/repeated pagination cursors never produce a cached denial", async () => {
  const f = fixture(() => ({ data: [], paging: { next: "https://graph.facebook.com/next", cursors: { after: "same" } } }));
  await assert.rejects(f.check("123", "page", undefined, "account"), /asset-access-check/);
  assert.equal(f.calls.length, 4);
  assert.equal(f.writes.length, 0);
});
