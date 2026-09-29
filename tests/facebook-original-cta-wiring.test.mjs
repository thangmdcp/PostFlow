import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("Facebook original CTA uses the saved native video id and remains independent from Ads", async () => {
  const facebook = await readFile(new URL("../lib/facebook.ts", import.meta.url), "utf8");
  const runner = await readFile(new URL("../lib/autoAdsRunner.ts", import.meta.url), "utf8");
  assert.match(facebook, /updateFacebookVideoCallToAction/);
  assert.match(facebook, /application\/x-www-form-urlencoded/);
  assert.match(facebook, /readFacebookOriginalCta/);
  assert.match(runner, /post\.fbMediaId/);
  assert.match(runner, /isFacebookOriginalCtaVerified/);
  assert.match(runner, /fbCtaVerifiedAt/);
  assert.match(runner, /Ads đã có CTA|fbCtaStatus:\s*"failed"/);
  assert.match(runner, /createAdCampaignForPost\(params\)/);
});

test("all publish entry points snapshot CTA scope", async () => {
  const paths = [
    "../app/api/posts/[id]/schedule/route.ts",
    "../app/api/posts/[id]/queue-publish/route.ts",
    "../app/api/posts/[id]/publish/route.ts",
    "../app/api/ads/create/route.ts",
  ];
  for (const path of paths) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(source, /adCtaScope/);
    assert.match(source, /fbCtaStatus/);
  }
});
