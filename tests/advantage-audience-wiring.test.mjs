import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("schedule and immediate publish resolve Advantage+ Audience demographics into the Post snapshot", () => {
  for (const source of [
    read("app/api/posts/[id]/schedule/route.ts"),
    read("app/api/posts/[id]/queue-publish/route.ts"),
  ]) {
    assert.match(source, /advantageSnapshot\?\.audienceEnabled/);
    assert.match(source, /adAgeMax:\s*null/);
    assert.match(source, /adGender:\s*null/);
  }
});

test("batch row values and UI stop presenting hard max-age/gender controls while Advantage+ Audience is active", () => {
  const panel = read("components/AdsConfigPanel.tsx");
  const form = read("components/AdParametersForm.tsx");
  assert.match(panel, /cfg\.advantage\.audienceEnabled\s*\?\s*65/);
  assert.match(panel, /cfg\.advantage\.audienceEnabled\s*\?\s*""\s*:\s*cfg\.gender/);
  assert.match(panel, /advantageAudience=\{adConfig\.advantage\.audienceEnabled\}/);
  assert.match(form, /65\+ · Meta mở rộng/);
  assert.match(form, /Tất cả · Meta mở rộng/);
});

test("Meta subcode 1870189 is a permanent Ads configuration error", () => {
  const runner = read("lib/autoAdsRunner.ts");
  assert.match(runner, /isConfigurationError[^;]+1870189/s);
});
