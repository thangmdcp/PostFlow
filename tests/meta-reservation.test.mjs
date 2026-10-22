import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import ts from "typescript";
import { spacingFor } from "../lib/metaThrottlePolicy.ts";
import { usageLevel } from "../lib/metaUsage.ts";

function fixture({ busy = false, conflicts = false } = {}) {
  const now = new Date("2030-01-01T00:00:00Z");
  const rows = Array.from({ length: 56 }, (_, i) => ({ scopeKey: `business_use_case:${i}:ads_management`, scopeType: "business_use_case", scopeId: `${i}:ads_management`, callCount: 0, totalCpuTime: 0, totalTime: 0 }));
  if (busy) rows[10].blockedUntil = new Date(now.getTime() + 300_000);
  let writes = 0, transactions = 0;
  const tx = { metaThrottleState: { findMany: async () => rows }, $executeRaw: async query => {
    writes++;
    assert.match(query.text, /ON CONFLICT/); assert.equal(query.values.length, 57 * 6);
    // A single statement contains every scope; no per-scope upsert is exposed.
    for (let i = 0; i < query.values.length; i += 6) {
      const [, scopeKey, scopeType, scopeId, nextAvailableAt] = query.values.slice(i, i + 6);
      const row = rows.find(row => row.scopeKey === scopeKey);
      if (row) row.nextAvailableAt = nextAvailableAt;
      else rows.push({ scopeKey, scopeType, scopeId, nextAvailableAt, callCount: 0, totalCpuTime: 0, totalTime: 0 });
    }
  } };
  const prisma = { metaThrottleState: { findMany: async () => rows.filter(row => row.scopeType === "business_use_case") }, $transaction: async (fn, options) => {
    transactions++; assert.equal(options.isolationLevel, "Serializable");
    if (conflicts) throw Object.assign(new Error("serialization conflict"), { code: "P2034" });
    return fn(tx);
  } };
  const mocks = { "@/lib/prisma": { prisma }, "@/lib/metaUsage": { usageLevel }, "@/lib/metaThrottlePolicy": { spacingFor }, "@prisma/client": { Prisma }, "node:crypto": { randomUUID } };
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL("../lib/metaThrottle.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("exports", "require", code)(module.exports, name => mocks[name]);
  return { now, api: module.exports, writes: () => writes, transactions: () => transactions };
}
test("57 quota scopes reserve with one atomic write and the next delivery waits", async () => {
  const f = fixture(); const scopes = f.api.scopesForPost();
  assert.equal((await f.api.reserveMetaJob("ads", scopes, "one", f.now)).allowed, true);
  assert.equal(f.writes(), 1);
  assert.equal((await f.api.reserveMetaJob("ads", scopes, "two", f.now)).allowed, false);
  assert.equal(f.writes(), 1);
});
test("known quota waits without writing or incrementing create attempts", async () => {
  const f = fixture({ busy: true });
  const result = await f.api.reserveMetaJob("campaign_read", f.api.scopesForPost(), "source", f.now);
  assert.equal(result.allowed, false); assert.ok(result.retryAfterSeconds >= 300); assert.equal(f.writes(), 0);
});
test("contending serializable reservations defer after bounded retries", async () => {
  const f = fixture({ conflicts: true });
  const result = await f.api.reserveMetaJob("ads", f.api.scopesForPost(), "source", f.now);
  assert.equal(result.allowed, false); assert.equal(f.transactions(), 3); assert.equal(f.writes(), 0);
});
