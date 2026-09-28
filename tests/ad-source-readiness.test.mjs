import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { AdSourceNotReadyError, SOURCE_READY_RETRY_DELAYS_MS } from "../lib/adSourceReadiness.ts";

test("Facebook source readiness uses a typed error", () => {
  const error = new AdSourceNotReadyError();
  assert.equal(error.code, "AD_SOURCE_NOT_READY");
  assert.match(error.message, /đang được xử lý/i);
});

test("source readiness backoff covers about thirty minutes", () => {
  assert.deepEqual(SOURCE_READY_RETRY_DELAYS_MS, [30_000, 120_000, 300_000, 600_000, 900_000]);
  assert.ok(SOURCE_READY_RETRY_DELAYS_MS.reduce((sum, delay) => sum + delay, 0) >= 30 * 60_000);
});

test("Facebook story readiness is checked before any Campaign is created", () => {
  const source = fs.readFileSync(new URL("../lib/facebook.ts", import.meta.url), "utf8");
  const readinessCheck = source.indexOf("if (!objectStoryId) throw new AdSourceNotReadyError()");
  const campaignCreate = source.indexOf("if (!campaignId)", readinessCheck);
  assert.ok(readinessCheck > 0);
  assert.ok(campaignCreate > readinessCheck);
});
