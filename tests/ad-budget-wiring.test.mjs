import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildBatchActionAllocation } from "../lib/batchAction.ts";
import { majorToMinor } from "../lib/adMoney.ts";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("every public create/schedule/retry path is wired through the currency guard", async () => {
  const [create, publish, queuePublish, schedule, retry, bulkRetry, runner, facebook, policy] = await Promise.all([
    read("app/api/ads/create/route.ts"),
    read("app/api/posts/[id]/publish/route.ts"),
    read("app/api/posts/[id]/queue-publish/route.ts"),
    read("app/api/posts/[id]/schedule/route.ts"),
    read("app/api/posts/[id]/retry-ads/route.ts"),
    read("app/api/queue/retry-ads/route.ts"),
    read("lib/autoAdsRunner.ts"),
    read("lib/facebook.ts"),
    read("lib/adBudgetPolicy.ts"),
  ]);

  assert.match(create, /validateBudgetForAccount/);
  assert.doesNotMatch(create, /dailyBudget\??:/);
  for (const source of [publish, queuePublish, schedule]) assert.match(source, /resolveAdBudgetSnapshot/);
  for (const source of [retry, bulkRetry]) {
    assert.match(source, /adBudgetMinor/);
    assert.match(source, /adBudgetCurrency/);
    assert.match(source, /validateMinorBudgetForAccount/);
  }
  assert.match(runner, /Thiếu snapshot TKQC\/currency\/ngân sách an toàn/);
  assert.match(runner, /không được phép random lại trong Queue/);
  assert.doesNotMatch(runner, /randomMinorStep/);
  assert.doesNotMatch(facebook, /100000/);
  assert.match(facebook, /daily_budget = dailyBudgetMinor/);
  assert.match(policy, /AbortSignal\.timeout\(10_000\)/);
  assert.match(policy, /pg_advisory_xact_lock/);
  assert.match(policy, /const refreshes = new Map/);
  assert.match(policy, /account\.accountStatus !== 1/);
  assert.match(policy, /AD_ACCOUNT_CURRENCY_UNVERIFIED/);
});

test("a Meta currency change invalidates both cap and random range", async () => {
  const policy = await read("lib/adBudgetPolicy.ts");
  assert.match(policy, /currencyChanged/);
  assert.match(policy, /maxDailyBudgetMinor: null/);
  assert.match(policy, /budgetPolicyCurrency: null/);
  assert.match(policy, /budgetPolicyConfirmedAt: null/);
  assert.match(policy, /SET "budgetCurrency"=NULL,"budgetMinMinor"=NULL,"budgetMaxMinor"=NULL,"budgetStepMinor"=NULL/);
});

test("a 20-post allocation keeps immutable account, currency and minor-unit snapshots", () => {
  const postIds = Array.from({ length: 20 }, (_, index) => `post-${index + 1}`);
  const allocation = buildBatchActionAllocation(
    postIds,
    [{ id: "page-a", weight: 100 }],
    [{ id: "act-vnd", weight: 55 }, { id: "act-usd", weight: 45 }],
    () => 0,
  );
  const policy = {
    "act-vnd": { currency: "VND", amount: "50000" },
    "act-usd": { currency: "USD", amount: "4" },
  };
  const snapshots = postIds.map((postId) => {
    const accountId = allocation.accountByPost[postId];
    const selected = policy[accountId];
    return Object.freeze({ postId, accountId, currency: selected.currency, amountMinor: majorToMinor(selected.amount, selected.currency) });
  });
  const retryPayloads = snapshots.map((snapshot) => ({ ...snapshot }));
  assert.equal(snapshots.length, 20);
  assert.deepEqual(retryPayloads, snapshots);
  for (const snapshot of snapshots) {
    assert.equal(snapshot.amountMinor, snapshot.currency === "VND" ? "50000" : "400");
  }
});
