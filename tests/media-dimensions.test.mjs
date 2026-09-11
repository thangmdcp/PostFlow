import test from "node:test";
import assert from "node:assert/strict";
import { instagramUpscaleWidth, INSTAGRAM_MEDIA_TARGET_WIDTH } from "../lib/mediaDimensions.ts";

test("upscales Instagram media below Meta's 500px requirement", () => {
  assert.equal(instagramUpscaleWidth(360), INSTAGRAM_MEDIA_TARGET_WIDTH);
  assert.equal(instagramUpscaleWidth(499), INSTAGRAM_MEDIA_TARGET_WIDTH);
});

test("keeps compliant media at its original resolution", () => {
  assert.equal(instagramUpscaleWidth(500), null);
  assert.equal(instagramUpscaleWidth(720), null);
  assert.equal(instagramUpscaleWidth(1080), null);
});

test("does not invent a transformation for an unknown dimension", () => {
  assert.equal(instagramUpscaleWidth(undefined), null);
  assert.equal(instagramUpscaleWidth(0), null);
});
