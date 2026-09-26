import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyRapidApiStatus,
  fetchRetryDelaySeconds,
  parseRetryAfter,
  SourceFetchError,
  sourceDiagnostic,
} from "../lib/sourceFetchError.ts";

test("classifies transient RapidAPI failures and permanent source errors", () => {
  for (const status of [408, 425, 429, 500, 502, 503, 504]) {
    assert.equal(classifyRapidApiStatus(status).retryable, true);
  }
  assert.deepEqual(classifyRapidApiStatus(404), { code: "SOURCE_NOT_FOUND", retryable: false });
  assert.deepEqual(classifyRapidApiStatus(403), { code: "RAPIDAPI_KEY_REJECTED", retryable: false });
});

test("fetch retry backoff follows the durable schedule and respects Retry-After", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((attempt) => fetchRetryDelaySeconds(attempt)), [15, 45, 120, 300, 900, 1800]);
  assert.equal(fetchRetryDelaySeconds(2, 120, 7), 127);
  assert.equal(fetchRetryDelaySeconds(99), 1800);
});

test("Retry-After supports seconds and HTTP dates", () => {
  assert.equal(parseRetryAfter("45"), 45);
  const future = new Date(Date.now() + 60_000).toUTCString();
  assert.ok((parseRetryAfter(future) ?? 0) >= 59);
});

test("structured diagnostics preserve provider and error code", () => {
  const error = new SourceFetchError({
    provider: "autodown",
    code: "FACEBOOK_PARSE_FAILED",
    message: "Không đọc được Reel",
    httpStatus: 422,
    retryable: false,
  });
  assert.deepEqual(sourceDiagnostic(error), {
    provider: "autodown",
    code: "FACEBOOK_PARSE_FAILED",
    message: "Không đọc được Reel",
    httpStatus: 422,
    retryable: false,
  });
});
