import test from "node:test";
import assert from "node:assert/strict";
import { readFetchMediaManifest, fetchMediaCanBeCleaned } from "../lib/fetchMediaManifest.ts";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { SourceFetchError } from "../lib/sourceFetchError.ts";
import { createHash } from "node:crypto";

function processingHarness(data, upload) {
  const source = readFileSync(new URL("../lib/postProcessing.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  const mocks = {
    "@/lib/rapidapi": { fetchPostData: async () => structuredClone(data) },
    "@/lib/extractLinks": { extractLinks: () => ["https://s.shopee.vn/test"] },
    "@/lib/cloudinary": { uploadFromUrl: upload },
    "@/lib/sourceFetchError": { SourceFetchError },
    "@/lib/fetchMediaManifest": { readFetchMediaManifest },
    "node:crypto": { createHash },
  };
  vm.runInNewContext(output, { module, exports: module.exports, require: (id) => {
    if (!(id in mocks)) throw new Error(`Unexpected import ${id}`);
    return mocks[id];
  } });
  return module.exports.fetchPostFields;
}

test("photo manifest keeps order, URL, public ID and provider", () => {
  const asset = { sourceUrl: "https://fbcdn.net/a.jpg", url: "https://res.cloudinary.com/a.jpg", publicId: "photos/a", resourceType: "image", order: 1, provider: "autodown", extractor: "gallery-dl" };
  assert.deepEqual(readFetchMediaManifest([asset, {}, null]), [asset]);
  assert.deepEqual(readFetchMediaManifest(null), []);
});
test("photos retained during scheduling, partial publish, Ads retry and Story", () => {
  const post = { status: "done", adStatus: null, adId: null, storyEnabled: false, storyStatus: null };
  assert.equal(fetchMediaCanBeCleaned(post), true);
  for (const status of ["ready", "pending", "queued", "partial", "failed"]) assert.equal(fetchMediaCanBeCleaned({ ...post, status }), false);
  for (const adStatus of ["pending", "queued", "creating", "failed"]) assert.equal(fetchMediaCanBeCleaned({ ...post, adStatus }), false);
  assert.equal(fetchMediaCanBeCleaned({ ...post, adStatus: "done", adId: "123" }), true);
  assert.equal(fetchMediaCanBeCleaned({ ...post, storyEnabled: true }), false);
  assert.equal(fetchMediaCanBeCleaned({ ...post, storyEnabled: true, storyStatus: "done" }), true);
});
test("Fetch checkpoints each photo and rejects empty media before ready", () => {
  const processing = readFileSync(new URL("../lib/postProcessing.ts", import.meta.url), "utf8");
  const worker = readFileSync(new URL("../lib/fetchPostJob.ts", import.meta.url), "utf8");
  assert.match(processing, /FETCH_EMPTY_MEDIA/);
  assert.match(processing, /options\.checkpoint\?\.\(manifest\)/);
  assert.match(processing, /forceJpeg: true/);
  assert.match(worker, /fetchProvider: fields.fetchProvider/);
  assert.match(worker, /manifest: post.fetchMediaManifest/);
});

test("AutoDown photos are retained in order without uploading them again", async () => {
  const run = processingHarness({ provider: "autodown", extractor: "gallery-dl", caption: "caption", media: [
    { type: "photo", url: "https://cloud/a", publicId: "a" }, { type: "photo", url: "https://cloud/b", publicId: "b" },
  ] }, () => { throw new Error("must not reupload"); });
  const checkpoints = [];
  const fields = await run("source", { checkpoint: async (assets) => checkpoints.push(assets.length) });
  assert.equal(fields.mediaType, "carousel");
  assert.deepEqual(JSON.parse(fields.mediaUrls), ["https://cloud/a", "https://cloud/b"]);
  assert.equal(fields.fetchProvider, "gallery-dl");
  assert.deepEqual(checkpoints, [1, 2]);
});

test("RapidAPI upload failure checkpoints first image and resumes only remaining image", async () => {
  const input = { caption: "caption", media: [{ type: "photo", url: "https://cdn/a?token=1" }, { type: "photo", url: "https://cdn/b" }] };
  let saved = [];
  let calls = 0;
  const run = processingHarness(input, async () => {
    if (++calls === 2) throw new Error("temporary upload failure");
    return { secureUrl: "https://cloud/a", publicId: "a" };
  });
  await assert.rejects(run("source", { postId: "post", checkpoint: async (assets) => { saved = structuredClone(assets); } }), (e) => e.code === "CLOUDINARY_FAILED" && e.retryable);
  assert.equal(saved.length, 1);
  calls = 0;
  input.media[0].url = "https://cdn/a?token=2";
  const resume = processingHarness(input, async () => { calls++; return { secureUrl: "https://cloud/b", publicId: "b" }; });
  const fields = await resume("source", { manifest: saved });
  assert.equal(calls, 1);
  assert.deepEqual(JSON.parse(fields.mediaUrls), ["https://cloud/a", "https://cloud/b"]);
});

test("empty provider media cannot become ready", async () => {
  const run = processingHarness({ caption: "caption only", media: [] }, () => { throw new Error("unexpected upload"); });
  await assert.rejects(run("source"), (e) => e.code === "FETCH_EMPTY_MEDIA");
});
