import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mapWithConcurrency } from "../lib/concurrency.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("bulk workers preserve order and never exceed concurrency three", async () => {
  let active = 0;
  let peak = 0;
  const values = Array.from({ length: 13 }, (_, index) => index + 1);
  const result = await mapWithConcurrency(values, 3, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, value % 3));
    active -= 1;
    return value * 2;
  });
  assert.equal(peak, 3);
  assert.deepEqual(result, values.map((value) => value * 2));
});

test("bulk verify is partial-success and bulk cap validates before one transaction", async () => {
  const verify = await read("app/api/ad-accounts/budget-policy/verify-bulk/route.ts");
  const confirm = await read("lib/adBudgetPolicy.ts");
  assert.match(verify, /mapWithConcurrency\(accounts, 3/);
  assert.match(verify, /ok: false as const/);
  assert.match(confirm, /saved\.length !== ids\.length/);
  assert.match(confirm, /account\.currency !== currency/);
  assert.match(confirm, /BigInt\(maxDailyBudgetMinor\) < BigInt\(account\.minDailyBudgetMinor\)/);
  assert.match(confirm, /await prisma\.\$transaction/);
  assert.match(confirm, /where: \{ id: \{ in: ids \} \}/);
});

test("bulk UI groups currency, requires explicit selection and retains rescue actions", async () => {
  const ui = await read("components/ConnectionsClient.tsx");
  assert.match(ui, /Xác minh tất cả TKQC/);
  assert.match(ui, /budgetSelections\.has\(account\.id\)/);
  assert.match(ui, /Áp dụng cho đã chọn/);
  assert.match(ui, /Thao tác riêng từng TKQC/);
});
