import assert from "node:assert/strict";
import test from "node:test";
import {
  BATCH_DRAFT_TTL_MS,
  batchDraftKey,
  legacyBatchDraftKey,
  migrateLegacyBatchDraft,
  parseBatchDraft,
  readBatchDraft,
  readComposerDraft,
  readLinkDraft,
  writeBatchDraft,
  writeComposerDraft,
  writeLinkDraft,
} from "../lib/batchDraft.ts";

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
}

test("batch draft round-trips and prunes missing posts/pages", () => {
  const storage = memoryStorage();
  writeBatchDraft(storage, "b1", {
    selectedPageIds: ["page-1", "gone"],
    checkedIds: ["post-1", "gone"],
    pageFilterIds: ["page-1", "gone"],
    rowPageId: { "post-1": "page-1", gone: "gone", "post-2": "gone" },
    rowAdParams: { "post-1": { budget: 10 }, gone: { budget: 20 } },
  }, 1000);
  const draft = readBatchDraft(storage, "b1", { now: 2000, validPostIds: ["post-1", "post-2"], validPageIds: ["page-1"] });
  assert.deepEqual(draft.selectedPageIds, ["page-1"]);
  assert.deepEqual(draft.checkedIds, ["post-1"]);
  assert.deepEqual(draft.pageFilterIds, ["page-1"]);
  assert.deepEqual(draft.rowPageId, { "post-1": "page-1" });
  assert.deepEqual(draft.rowAdParams, { "post-1": { budget: 10 } });
});

test("invalid and expired drafts are rejected", () => {
  assert.equal(parseBatchDraft("not json"), null);
  const storage = memoryStorage();
  writeBatchDraft(storage, "old", { checkedIds: ["post-1"] }, 1);
  assert.equal(readBatchDraft(storage, "old", { now: BATCH_DRAFT_TTL_MS + 2 }), null);
  assert.equal(storage.getItem(batchDraftKey("old")), null);
});

test("malformed fields are sanitized without breaking the whole draft", () => {
  const draft = parseBatchDraft(JSON.stringify({
    version: 2,
    updatedAt: 1000,
    scheduleMode: "sometimes",
    detailTab: "unknown",
    checkedIds: ["p1", 7],
    rowRunAds: { p1: true, p2: "yes" },
    rowPublishTargets: { p1: ["instagram", "email"], p2: "facebook" },
  }), { now: 2000, validPostIds: ["p1", "p2"] });
  assert.equal(draft.scheduleMode, undefined);
  assert.equal(draft.detailTab, undefined);
  assert.deepEqual(draft.checkedIds, ["p1"]);
  assert.deepEqual(draft.rowRunAds, { p1: true });
  assert.deepEqual(draft.rowPublishTargets, { p1: ["instagram"] });
});

test("legacy session draft migrates once to local storage", () => {
  const local = memoryStorage();
  const session = memoryStorage();
  session.setItem(legacyBatchDraftKey("b2"), JSON.stringify({ rowPageId: { p1: "page-1" }, rowRunAds: { p1: true } }));
  const draft = migrateLegacyBatchDraft(local, session, "b2", { now: 1000, validPostIds: ["p1"] });
  assert.deepEqual(draft.rowPageId, { p1: "page-1" });
  assert.deepEqual(draft.rowRunAds, { p1: true });
  assert.equal(session.getItem(legacyBatchDraftKey("b2")), null);
  assert.ok(local.getItem(batchDraftKey("b2")));
});

test("composer draft survives until cleared", () => {
  const storage = memoryStorage();
  writeComposerDraft(storage, "https://one.example\nhttps://two.example", 1000);
  assert.equal(readComposerDraft(storage, 2000), "https://one.example\nhttps://two.example");
  writeComposerDraft(storage, "", 3000);
  assert.equal(readComposerDraft(storage, 4000), "");
});

test("affiliate draft is restored only while its server baseline matches", () => {
  const storage = memoryStorage();
  writeLinkDraft(storage, "link-1", "https://draft.example", "", 1000);
  assert.equal(readLinkDraft(storage, "link-1", "", 2000), "https://draft.example");
  assert.equal(readLinkDraft(storage, "link-1", "https://saved.example", 2000), null);
});
