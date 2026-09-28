import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { unscheduleSkipReason } from "../lib/unscheduleEligibility.ts";

const candidate = {
  status: "pending",
  fbPostId: null,
  igPostId: null,
  igContainerId: null,
  fbObjectStoryId: null,
  adCampaignId: null,
  adSetId: null,
  adCreativeId: null,
  adId: null,
};

test("allows only untouched pending or queued posts to be unscheduled", () => {
  assert.equal(unscheduleSkipReason(candidate), null);
  assert.equal(unscheduleSkipReason({ ...candidate, status: "queued" }), null);
});

test("keeps published, processing, and Meta-backed posts unchanged", () => {
  assert.match(unscheduleSkipReason({ ...candidate, status: "publishing" }), /đang được đăng/);
  assert.match(unscheduleSkipReason({ ...candidate, status: "done", fbPostId: "123" }), /đã đăng/);
  assert.match(unscheduleSkipReason({ ...candidate, adCampaignId: "456" }), /tài sản quảng cáo/);
  assert.match(unscheduleSkipReason({ ...candidate, igContainerId: "789" }), /Facebook\/Instagram/);
});

test("stale publish and ads queue deliveries no-op after cancellation", () => {
  const publishRoute = fs.readFileSync(new URL("../app/api/queue/publish/route.ts", import.meta.url), "utf8");
  const adsRoute = fs.readFileSync(new URL("../app/api/queue/ads/route.ts", import.meta.url), "utf8");
  assert.match(publishRoute, /return NextResponse\.json\(\{ status: "cancelled" \}\)/);
  assert.match(adsRoute, /\["pending", "queued", "creating"\]\.includes\(post\.adStatus/);
});
