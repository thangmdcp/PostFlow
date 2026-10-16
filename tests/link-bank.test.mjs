import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import ts from "typescript";
import vm from "node:vm";
import * as linkBank from "../lib/linkBank.ts";
import { readComposerDraft, readComposerBankState, writeComposerDraft, COMPOSER_DRAFT_KEY } from "../lib/batchDraft.ts";

function load(file, mocks) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: module.exports, module, Date, Set, Map, require: name => {
    if (!(name in mocks)) throw Error(`Unexpected import ${name}`); return mocks[name];
  } });
  return module.exports;
}
const url = n => `https://www.facebook.com/reel/${n}`;
function fixture() {
  let state = { entries: [], batches: [] }, serial = Promise.resolve();
  const tx = {
    $queryRawUnsafe: async () => [],
    linkBankEntry: {
      createMany: async ({ data }) => {
        let count = 0;
        for (const e of data) if (!state.entries.some(old => old.listId === e.listId && old.urlKey === e.urlKey)) {
          state.entries.push({ ...e, id: `entry${state.entries.length}`, lastUsedAt: null, useCount: 0 }); count++;
        }
        return { count };
      },
      findMany: async ({ where }) => state.entries.filter(e => where.id.in.includes(e.id)),
      updateMany: async ({ where, data }) => { for (const e of state.entries.filter(e => where.id.in.includes(e.id))) Object.assign(e, { ...data, useCount: e.useCount + 1 }); },
    },
    batch: {
      findUnique: async ({ where }) => state.batches.find(b => b.requestKey === where.requestKey),
      findUniqueOrThrow: async ({ where }) => state.batches.find(b => b.id === where.id),
      create: async ({ data }) => { const batch = { ...data, id: `batch${state.batches.length}`, posts: [] }; state.batches.push(batch); return batch; },
    },
    post: { createMany: async ({ data }) => { for (const row of data) state.batches.find(b => b.id === row.batchId).posts.push(row); } },
  };
  const prisma = { $transaction: fn => {
    const next = serial.then(async () => { const previous = structuredClone(state); try { return await fn(tx); } catch (e) { state = previous; throw e; } });
    serial = next.catch(() => {}); return next;
  } };
  const mocks = { "@/lib/prisma": { prisma }, "@/lib/linkBank": linkBank, "node:crypto": { createHash } };
  return { ...load("../lib/createFetchBatch.ts", mocks), ...load("../lib/linkBankService.ts", mocks), tx, state: () => state };
}

test("normalizes known Facebook/TikTok identities and ignores tracking, never invalid protocols", () => {
  assert.equal(linkBank.sourceLinkKey(url(123)), linkBank.sourceLinkKey("https://m.facebook.com/watch/?v=123&fbclid=abc"));
  assert.equal(linkBank.sourceLinkKey("https://facebook.com/a/posts/pfbidABC"), linkBank.sourceLinkKey("https://www.facebook.com/permalink.php?story_fbid=pfbidABC&id=1"));
  assert.equal(linkBank.sourceLinkKey("https://www.tiktok.com/@a/video/123"), "tiktok:video:123");
  assert.equal(linkBank.sourceLinkKey("https://example.com/item?utm_source=a&id=4"), "https://example.com/item?id=4");
  for (const bad of ["javascript:alert(1)", "ftp://x", "https://secret:password@example.com"]) assert.equal(linkBank.sourceLinkKey(bad), null);
});
test("named lists dedup existing and incoming links independently while preserving order", async () => {
  const f = fixture();
  const first = await f.appendBankLinks(f.tx, "A", [url(1), url(2), url(1), "bad"]);
  assert.equal(first.added, 2); assert.equal(first.duplicates, 1); assert.equal(first.invalid, 1);
  assert.equal((await f.appendBankLinks(f.tx, "A", [url(2), url(3)])).added, 1);
  assert.equal((await f.appendBankLinks(f.tx, "B", [url(1)])).added, 1);
  assert.deepEqual(f.state().entries.map(e => e.sourceUrl), [url(1), url(2), url(3), url(1)]);
});
test("batch marks only submitted bank entries used atomically, with Fetch failures retaining usage", async () => {
  const f = fixture(); await f.appendBankLinks(f.tx, "A", [url(1), url(2)]);
  const result = await f.createFetchBatch({ urls: [url(1)], bankSelections: [{ entryId: "entry0", url: url(1), allowUsed: false }] });
  assert.equal(result.batch.posts[0].linkBankEntryId, "entry0");
  assert.equal(f.state().entries[0].lastBatchId, result.batch.id);
  assert.equal(f.state().entries[0].useCount, 1);
  assert.equal(f.state().entries[1].lastUsedAt, null);
  result.batch.posts[0].status = "failed";
  assert.ok(f.state().entries[0].lastUsedAt);
});
test("two stale tabs cannot consume an unused entry twice; explicit reuse works", async () => {
  const f = fixture(); await f.appendBankLinks(f.tx, "A", [url(1)]);
  const input = { urls: [url(1)], bankSelections: [{ entryId: "entry0", url: url(1), allowUsed: false }] };
  const results = await Promise.allSettled([f.createFetchBatch(input), f.createFetchBatch(input)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(f.state().batches.length, 1);
  await f.createFetchBatch({ ...input, bankSelections: [{ ...input.bankSelections[0], allowUsed: true }] });
  assert.equal(f.state().entries[0].useCount, 2);
});
test("response-loss retry reuses the same batch and does not double-consume entries", async () => {
  const f = fixture(); await f.appendBankLinks(f.tx, "A", [url(1)]);
  const input = { urls: [url(1)], requestKey: "request-1234567890", bankSelections: [{ entryId: "entry0", url: url(1), allowUsed: false }] };
  const [a, b] = await Promise.all([f.createFetchBatch(input), f.createFetchBatch(input)]);
  assert.equal(a.batch.id, b.batch.id); assert.equal(b.reused, true);
  assert.equal(f.state().entries[0].useCount, 1);
  await assert.rejects(f.createFetchBatch({ ...input, urls: [url(2)] }), /đã thay đổi/);
});
test("200 links supported, 201 rejected without truncation or mutation", async () => {
  const f = fixture();
  const urls = Array.from({ length: 200 }, (_, i) => url(i));
  assert.equal((await f.createFetchBatch({ urls })).batch.posts.length, 200);
  await assert.rejects(f.createFetchBatch({ urls: [...urls, url(201)] }), /200/);
  assert.equal(f.state().batches.length, 1);
  assert.equal((await f.createFetchBatch({ urls: [url(1), `${url(1)}?fbclid=x`] })).batch.posts.length, 1);
});
test("forged provenance rolls back and removing imported link does not consume it", async () => {
  const f = fixture(); await f.appendBankLinks(f.tx, "A", [url(1)]);
  await assert.rejects(f.createFetchBatch({ urls: [url(2)], bankSelections: [{ entryId: "entry0", url: url(2), allowUsed: false }] }), /đã thay đổi/);
  assert.equal(f.state().batches.length, 0); assert.equal(f.state().entries[0].lastUsedAt, null);
  await f.createFetchBatch({ urls: [url(2)], bankSelections: [{ entryId: "entry0", url: url(1), allowUsed: false }] });
  assert.equal(f.state().entries[0].lastUsedAt, null);
});
test("draft roundtrip keeps provenance and idempotency across F5/tabs; legacy drafts survive", () => {
  const data = new Map(); const storage = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) };
  const bank = { bankSelections: [{ entryId: "entry0", url: url(1), allowUsed: false }], requestKey: "request-1234567890" };
  writeComposerDraft(storage, url(1), Date.now(), bank);
  assert.equal(readComposerDraft(storage), url(1)); assert.deepEqual(readComposerBankState(storage), bank);
  writeComposerDraft(storage, url(2));
  assert.deepEqual(readComposerBankState(storage), { bankSelections: [], requestKey: undefined });
  storage.setItem(COMPOSER_DRAFT_KEY, "broken"); assert.deepEqual(readComposerBankState(storage), { bankSelections: [] });
});

test("quantity picker excludes composer links and defaults to unused, without marking used", async () => {
  let query;
  const { POST } = load("../app/api/link-lists/[id]/pick/route.ts", {
    "@/lib/linkBank": linkBank,
    "@/lib/prisma": { prisma: { linkBankEntry: { findMany: async args => { query = args; return [{ id: "1", sourceUrl: url(2) }]; } } } },
    "next/server": { NextResponse: { json: (data, options) => ({ data, status: options?.status ?? 200 }) } },
  });
  const response = await POST({ json: async () => ({ count: 20, excludeUrls: [url(1)] }) }, { params: { id: "A" } });
  assert.equal(query.where.listId, "A"); assert.equal(query.where.lastUsedAt, null);
  assert.equal(query.where.urlKey.notIn[0], linkBank.sourceLinkKey(url(1))); assert.equal(query.take, 20);
  assert.equal(response.data.imported, 1);
  assert.equal((await POST({ json: async () => ({ count: 201, excludeUrls: [] }) }, { params: { id: "A" } })).status, 400);
});
