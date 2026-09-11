import assert from "node:assert/strict";
import test from "node:test";
import {
  BATCH_ACTION_STORAGE_TTL_MS,
  allocateByPercentage,
  allocationCounts,
  batchActionStorageKey,
  buildBatchActionAllocation,
  readLastBatchAction,
  weightsAreValid,
  writeLastBatchAction,
} from "../lib/batchAction.ts";

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
}

test("percentage allocation is exact for a representative batch and interleaved", () => {
  const result = allocateByPercentage([
    { id: "page-a", weight: 70 },
    { id: "page-b", weight: 30 },
  ], 20, () => 0);
  assert.deepEqual(allocationCounts(result), { "page-a": 14, "page-b": 6 });
  assert.ok(result.slice(0, 6).includes("page-b"));
});

test("small batches assign every post and resolve percentage remainder", () => {
  const allocation = buildBatchActionAllocation(
    ["p1", "p2", "p3"],
    [{ id: "page-a", weight: 50 }, { id: "page-b", weight: 50 }],
    [{ id: "ad-a", weight: 34 }, { id: "ad-b", weight: 66 }],
    () => 0,
  );
  assert.equal(Object.keys(allocation.pageByPost).length, 3);
  assert.equal(Object.values(allocation.pageCounts).reduce((sum, value) => sum + value, 0), 3);
  assert.equal(Object.values(allocation.accountCounts).reduce((sum, value) => sum + value, 0), 3);
});

test("weights require positive rows totaling exactly 100", () => {
  assert.equal(weightsAreValid([{ id: "a", weight: 60 }, { id: "b", weight: 40 }]), true);
  assert.equal(weightsAreValid([{ id: "a", weight: 60 }, { id: "b", weight: 30 }]), false);
  assert.equal(weightsAreValid([{ id: "a", weight: 100 }, { id: "b", weight: 0 }]), false);
});

test("last action config is versioned and expires", () => {
  const storage = memoryStorage();
  writeLastBatchAction(storage, "schedule", { mode: "publish_only" }, 1000);
  assert.deepEqual(readLastBatchAction(storage, "schedule", 2000), { mode: "publish_only" });
  assert.equal(readLastBatchAction(storage, "schedule", BATCH_ACTION_STORAGE_TTL_MS + 1001), null);
  assert.equal(storage.getItem(batchActionStorageKey("schedule")), null);
});
