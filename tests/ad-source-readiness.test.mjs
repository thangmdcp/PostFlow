import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  AdSourceNotReadyError,
  SOURCE_READY_RETRY_DELAYS_MS,
  facebookObjectStoryIdCandidate,
  facebookPromotableStoryId,
} from "../lib/adSourceReadiness.ts";

test("Facebook source readiness uses a typed error", () => {
  const error = new AdSourceNotReadyError();
  assert.equal(error.code, "AD_SOURCE_NOT_READY");
  assert.match(error.message, /đang được xử lý/i);
});

test("source readiness backoff covers about thirty minutes", () => {
  assert.deepEqual(SOURCE_READY_RETRY_DELAYS_MS, [30_000, 120_000, 300_000, 600_000, 900_000]);
  assert.ok(SOURCE_READY_RETRY_DELAYS_MS.reduce((sum, delay) => sum + delay, 0) >= 30 * 60_000);
});

test("canonical Facebook story candidate uses PageID_ReelID", () => {
  assert.equal(facebookObjectStoryIdCandidate("233853783154665", "1742013207103324"), "233853783154665_1742013207103324");
  assert.equal(facebookObjectStoryIdCandidate("233853783154665", "233853783154665_1742013207103324"), "233853783154665_1742013207103324");
});

test("Reel resolver prefers Meta promotable_id over the visible story id", () => {
  assert.equal(facebookPromotableStoryId({
    id: "233853783154665_1709441733462492",
    promotable_id: "233853783154665_122237008658288611",
    is_eligible_for_promotion: true,
  }), "233853783154665_122237008658288611");
  assert.equal(facebookPromotableStoryId({ id: "page_post", is_eligible_for_promotion: false }), "");
});

test("Facebook story readiness is checked before any Campaign is created", () => {
  const source = fs.readFileSync(new URL("../lib/facebook.ts", import.meta.url), "utf8");
  const readinessCheck = source.indexOf("if (!objectStoryId) throw new AdSourceNotReadyError()");
  const campaignCreate = source.indexOf("if (!campaignId)", readinessCheck);
  assert.ok(readinessCheck > 0);
  assert.ok(campaignCreate > readinessCheck);
});
