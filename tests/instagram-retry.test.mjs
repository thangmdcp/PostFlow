import test from "node:test";
import assert from "node:assert/strict";
import { isRetryableInstagramApiError } from "../lib/instagramRetry.ts";

test("treats Meta media-processing failures as retryable", () => {
  assert.equal(isRetryableInstagramApiError(2207076), true);
  assert.equal(isRetryableInstagramApiError(undefined, "Media upload has failed with error code 2207076"), true);
});

test("does not retry an unrelated permanent API error", () => {
  assert.equal(isRetryableInstagramApiError(100, "Invalid parameter"), false);
});
