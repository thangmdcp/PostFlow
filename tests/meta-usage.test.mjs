import test from "node:test";
import assert from "node:assert/strict";
import {
  META_RATE_LIMIT_CODES,
  isMetaRateLimit,
  metaErrorCategory,
  parseMetaUsageHeaders,
  usageLevel,
} from "../lib/metaUsage.ts";
import { spacingFor } from "../lib/metaThrottlePolicy.ts";
import { metaErrorDisplay } from "../lib/metaErrorDisplay.ts";

test("parses app, page, ad-account and business quota headers", () => {
  const headers = new Headers({
    "x-app-usage": JSON.stringify({ call_count: 61, total_cputime: 12, total_time: 20 }),
    "x-page-usage": JSON.stringify({ call_count: 81, total_cputime: 15, total_time: 10 }),
    "x-ad-account-usage": JSON.stringify({ acc_id_util_pct: 91, ads_api_access_tier: "full_access", reset_time_duration: 120 }),
    "x-business-use-case-usage": JSON.stringify({ "123": [{ type: "ads_management", call_count: 42, estimated_time_to_regain_access: 2 }] }),
  });
  const result = parseMetaUsageHeaders(headers, { pageId: "page-1", adAccountId: "act_456" });
  assert.equal(result.length, 4);
  assert.equal(result.find((row) => row.scopeKey === "app:current")?.callCount, 61);
  assert.equal(result.find((row) => row.scopeKey === "page:page-1")?.callCount, 81);
  const adAccount = result.find((row) => row.scopeKey === "ad_account:456");
  assert.equal(adAccount?.callCount, 91);
  assert.equal(adAccount?.accessTier, "full_access");
  assert.equal(adAccount?.estimatedRecoverySeconds, 120);
  assert.equal(result.find((row) => row.scopeType === "business_use_case")?.estimatedRecoverySeconds, 120);
});

test("recognizes every documented Meta rate-limit code", () => {
  for (const code of META_RATE_LIMIT_CODES) assert.equal(isMetaRateLimit(400, { code }), true, `code ${code}`);
  assert.equal(isMetaRateLimit(429, null), true);
  assert.equal(metaErrorCategory(400, { code: 200, message: "Permissions error" }), "permission");
  assert.equal(metaErrorCategory(400, { code: 190 }), "token");
  assert.equal(metaErrorCategory(503, { is_transient: true }), "transient");
});

test("adaptive spacing follows 60/80/90 usage thresholds", () => {
  assert.equal(spacingFor("ads", 0, null), 20);
  assert.equal(spacingFor("ads", 60, null), 60);
  assert.equal(spacingFor("ads", 80, null), 120);
  assert.equal(spacingFor("ads", 20, "standard_access"), 2);
  assert.equal(spacingFor("comment", 60, null), 10);
  assert.equal(spacingFor("comment", 80, null), 30);
  assert.equal(usageLevel({ callCount: 20, totalCpuTime: 83, totalTime: 50 }), 83);
});

test("maps stored Meta failures to actionable Vietnamese labels", () => {
  assert.equal(metaErrorDisplay("[quota] code=613").label, "Meta đang giới hạn TKQC/Page");
  assert.equal(metaErrorDisplay("OAuthException code=190").label, "Token hết hạn");
  assert.equal(metaErrorDisplay("Tài khoản quảng cáo chưa được cấp quyền quảng bá Page đã chọn.").label, "Thiếu quyền quảng bá Page");
  assert.equal(metaErrorDisplay("[source] Bài chưa sẵn sàng").label, "Bài chưa sẵn sàng làm quảng cáo");
});
