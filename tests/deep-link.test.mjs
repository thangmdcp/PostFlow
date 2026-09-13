import assert from "node:assert/strict";
import test from "node:test";
import { getDeepLinkDisplay } from "../lib/deepLink.ts";

test("reports supported deep-link fallback modes as enabled", () => {
  assert.deepEqual(getDeepLinkDisplay("deeplink_with_web_fallback"), {
    state: "enabled",
    label: "Đã bật",
  });
  assert.equal(getDeepLinkDisplay("deeplink_with_appstore_fallback").state, "enabled");
});

test("explains that PostFlow overrides a web-only source creative", () => {
  assert.deepEqual(getDeepLinkDisplay("web_only"), {
    state: "source_disabled",
    label: "Tắt ở quảng cáo mẫu · PostFlow vẫn bật khi tạo",
  });
});

test("does not misreport an omitted Meta field as disabled", () => {
  assert.deepEqual(getDeepLinkDisplay(undefined), {
    state: "not_reported",
    label: "Sẽ bật khi PostFlow tạo Ads",
  });
});
