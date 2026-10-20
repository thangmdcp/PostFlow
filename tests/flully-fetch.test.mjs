import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { isIP } from "node:net";
import { createHash } from "node:crypto";
import { Readable, Transform, PassThrough } from "node:stream";
import { pipeline } from "node:stream/promises";
import vm from "node:vm";
import ts from "typescript";
import { SourceFetchError, sourceDiagnostic, fetchRetryDelaySeconds, FETCH_RETRY_DELAYS_SECONDS } from "../lib/sourceFetchError.ts";
import { FetchDownloadReady, FetchStageChanged, fetchStageFor, readDownloadSnapshot, reusableDownload } from "../lib/fetchDownloadSnapshot.ts";
import { readFetchMediaManifest, fetchMediaCanBeCleaned } from "../lib/fetchMediaManifest.ts";

const sourceUrl = "https://www.facebook.com/reel/123456789";
const media = { type: "video", url: "https://flully.com/_media-tmp/asset/cap/media.mp4", thumbnail: "https://flully.com/_media-tmp/asset/cap/thumbnail.jpg" };
const downloaded = () => ({ provider: "flully", caption: "caption\nhttps://s.shopee.vn/aff", media: [{ ...media }], expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
const snapshots = { FetchDownloadReady, FetchStageChanged, fetchStageFor, readDownloadSnapshot, reusableDownload };
function load(file, mocks, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: id => {
    if (!(id in mocks)) throw new Error(`Unexpected import ${id}`);
    return mocks[id];
  }, Date, Buffer, AbortSignal, URL, process: { env: {} }, ...globals });
  return module.exports;
}
function flullyFixture({ status = 200, body, key = "test-key", origin = "203.0.113.4" } = {}) {
  const calls = []; const circuits = [];
  const api = load("lib/autodown.ts", {
    "node:https": { request: (url, options, callback) => {
      const req = new EventEmitter();
      req.end = payload => { calls.push({ url, options, payload }); const response = new EventEmitter();
        response.statusCode = status; response.headers = {}; response.destroy = error => response.emit("error", error);
        callback(response); queueMicrotask(() => { response.emit("data", Buffer.from(body ?? JSON.stringify({ success: true, type: "video", ...downloaded() }))); response.emit("end"); });
      }; return req;
    } },
    "node:net": { isIP },
    "@/lib/prisma": { prisma: { appConfig: { findMany: async () => [
      { key: "flullyAutoDownApiKey", value: key }, { key: "flullyAutoDownOriginIp", value: origin },
    ] } } },
    "@/lib/sourceFetchError": { SourceFetchError },
    "@/lib/flullyDownloadLease": { withFlullyDownloadLease: run => run() },
    "@/lib/fetchProviderCircuit": { assertFetchProviderAvailable: async provider => circuits.push(provider), recordFetchProviderSuccess: async () => {}, recordFetchProviderFailure: async () => {} },
  });
  return { api, calls, circuits };
}
test("Flully uses only download, exact payload, isolated key, hostname/TLS and origin lookup", async () => {
  const f = flullyFixture(); const result = await f.api.autodownDownload(sourceUrl);
  assert.equal(result.media[0].thumbnail, media.thumbnail);
  assert.equal(result.media[0].public_id, undefined);
  assert.deepEqual(f.circuits, ["flully"]);
  assert.equal(f.calls.length, 1);
  const call = f.calls[0];
  assert.equal(call.url.href, "https://flully.com/api/autodown/v1/download");
  assert.equal(call.payload, JSON.stringify({ url: sourceUrl }));
  assert.equal(call.options.headers["X-API-Key"], "test-key");
  assert.notEqual(call.options.rejectUnauthorized, false);
  let address;
  call.options.lookup("flully.com", { all: true }, (_error, result) => { address = result; });
  assert.equal(address[0].address, "203.0.113.4");
  call.options.lookup("another.example", {}, error => assert.ok(error));
});
test("Flully rejects wrong keys, empty/non-JSON response and invalid origin without leaking payload", async () => {
  for (const input of [{ status: 401, body: '{"success":false,"code":"UNAUTHORIZED"}' }, { body: "<html>secret</html>" }, { body: '{"success":true,"media":[]}' }]) {
    await assert.rejects(flullyFixture(input).api.autodownDownload(sourceUrl), e => e instanceof SourceFetchError && !e.message.includes("secret"));
  }
  const f = flullyFixture({ origin: "https://flully.com" });
  await assert.rejects(f.api.autodownDownload(sourceUrl), e => e.code === "INVALID_ORIGIN" && !e.retryable);
  assert.equal(f.calls.length, 0);
  await assert.rejects(flullyFixture({ status: 401, body: "unauthorized" }).api.autodownDownload(sourceUrl), e => e.code === "UNAUTHORIZED" && !e.retryable);
  await assert.rejects(flullyFixture({ body: "{}" }).api.autodownDownload(sourceUrl), e => e.retryable && e.httpStatus === 502);
});
test("Flully busy, timeout, capacity and 429/5xx back off; oversized/private/auth do not", () => {
  const { api } = flullyFixture();
  for (const [code, status] of [["MEDIA_BUSY", 503], ["UPSTREAM_TIMEOUT", 504], ["MEDIA_CAPACITY_EXCEEDED", 507], ["API_UNAVAILABLE", 429]]) assert.equal(api.flullyError(code, status).retryable, true);
  for (const [code, status] of [["MEDIA_TOO_LARGE", 413], ["PRIVATE_SOURCE_DENIED", 400], ["UNAUTHORIZED", 401]]) assert.equal(api.flullyError(code, status).retryable, false);
});
test("only unsupported/photo sources fall back to RapidAPI; invalid Flully key is visible", async () => {
  for (const code of ["NO_VIDEO_SOURCE", "UNAUTHORIZED"]) {
    let fallbacks = 0;
    const api = load("lib/rapidapi.ts", {
      "@/lib/autodown": { autodownDownload: async () => { throw new SourceFetchError({ provider: "flully", code, message: code, retryable: false, httpStatus: code === "UNAUTHORIZED" ? 401 : 415 }); } },
      "@/lib/fetchProviderCircuit": { assertFetchProviderAvailable: async () => {}, recordFetchProviderSuccess: async () => {}, recordFetchProviderFailure: async () => {} },
      "@/lib/prisma": { prisma: { appConfig: { findUnique: async () => ({ value: "rapid-key" }) } } },
      "@/lib/sourceFetchError": { SourceFetchError, sourceDiagnostic },
    }, { fetch: async () => { fallbacks++; return new Response(JSON.stringify({ message: "photo", images: ["https://cdn/photo.jpg"] })); }, setTimeout: callback => callback() });
    if (code === "UNAUTHORIZED") await assert.rejects(api.fetchPostData(sourceUrl), error => error.code === code);
    else assert.equal((await api.fetchPostData(sourceUrl)).provider, "rapidapi");
    assert.equal(fallbacks, code === "UNAUTHORIZED" ? 0 : 1);
  }
});
test("download checkpoint expires with safety margin and cannot cross source URLs", () => {
  const now = Date.now(); const snapshot = { version: 1, purpose: "fetch", sourceUrl, data: downloaded(), expiresAt: new Date(now + 120_000).toISOString() };
  assert.ok(reusableDownload(readDownloadSnapshot(snapshot, sourceUrl), now));
  assert.equal(readDownloadSnapshot(snapshot, "another"), null);
  assert.equal(reusableDownload(snapshot, now + 61_000), null);
  assert.equal(reusableDownload({ ...snapshot, expiresAt: "bad" }), null);
});
function processorFixture({ fetchData = async () => downloaded(), upload = async () => ({ secureUrl: "https://res.cloudinary.com/demo/video/upload/video-p.mp4", publicId: "postflow-fetch/video-p" }) } = {}) {
  return load("lib/postProcessing.ts", {
    "@/lib/rapidapi": { fetchPostData: fetchData }, "@/lib/extractLinks": { extractLinks: () => [] },
    "@/lib/cloudinary": { uploadFetchedVideo: upload, uploadFromUrl: upload, cloudinaryFetchError: error => error },
    "@/lib/fetchDownloadSnapshot": snapshots, "@/lib/fetchMediaManifest": { readFetchMediaManifest }, "node:crypto": { createHash },
    "@/lib/sourceFetchError": { SourceFetchError },
  }).fetchPostFields;
}
test("download yields a checkpoint before any upload; retry upload never downloads again", async () => {
  let sourceCalls = 0, uploads = 0, snapshot;
  const run = processorFixture({ fetchData: async () => { sourceCalls++; return downloaded(); }, upload: async () => {
    uploads++; if (uploads === 1) throw new SourceFetchError({ provider: "cloudinary", code: "CLOUDINARY_FAILED", message: "storage", retryable: true });
    return { secureUrl: "https://res.cloudinary.com/demo/video/upload/test.mp4", publicId: "postflow-fetch/video-p" };
  } });
  await assert.rejects(run(sourceUrl, { separateDownload: true, postId: "p" }), error => { snapshot = error.snapshot; return error instanceof FetchDownloadReady; });
  assert.equal(sourceCalls, 1); assert.equal(uploads, 0);
  await assert.rejects(run(sourceUrl, { separateDownload: true, postId: "p", downloadSnapshot: snapshot }), error => error.provider === "cloudinary");
  const fields = await run(sourceUrl, { separateDownload: true, postId: "p", downloadSnapshot: snapshot });
  assert.equal(sourceCalls, 1); assert.equal(uploads, 2);
  assert.equal(fields.cloudinaryId, "postflow-fetch/video-p");
  assert.match(fields.thumbnailUrl, /cloudinary.*\.jpg$/);
  assert.equal(fields.fetchProvider, "flully");
});
test("expired checkpoint re-downloads; readable Cloudinary media has no Flully lifetime dependency", async () => {
  let calls = 0;
  const run = processorFixture({ fetchData: async () => { calls++; return downloaded(); } });
  await assert.rejects(run(sourceUrl, { postId: "p", separateDownload: true, downloadSnapshot: { version: 1, purpose: "fetch", sourceUrl, data: downloaded(), expiresAt: new Date(0).toISOString() } }), error => error instanceof FetchDownloadReady);
  assert.equal(calls, 1);
});
function workerFixture({ processor, row = {}, enqueue = true } = {}) {
  const state = { id: "p", sourceUrl, status: "queued", fetchAttempt: 0, fetchDiagnostics: null, fetchLeaseUntil: null, finalCaption: null, pageId: null, ...row };
  const published = [], routed = [];
  const matches = where => (!where.status || (typeof where.status === "string" ? state.status === where.status : where.status.in.includes(state.status)))
    && (!where.fetchLeaseUntil || state.fetchLeaseUntil?.getTime() === where.fetchLeaseUntil.getTime())
    && (!where.OR || !state.fetchLeaseUntil || state.fetchLeaseUntil.getTime() <= Date.now());
  class KnownError extends Error {}
  const post = {
    findUnique: async () => ({ ...state }),
    updateMany: async ({ where, data }) => { if (!matches(where)) return { count: 0 }; Object.assign(state, data); return { count: 1 }; },
    update: async ({ where, data }) => { if (!matches(where)) throw new KnownError(); Object.assign(state, data); return state; },
  };
  const api = load("lib/fetchPostJob.ts", {
    "@prisma/client": { Prisma: { PrismaClientKnownRequestError: KnownError, DbNull: null, JsonNull: null } },
    "@/lib/prisma": { prisma: { post } }, "@/lib/postProcessing": { fetchPostFieldsWithRetry: processor },
    "@/lib/sourceFetchError": { SourceFetchError, sourceDiagnostic, fetchRetryDelaySeconds, FETCH_RETRY_DELAYS_SECONDS },
    "@/lib/fetchDownloadSnapshot": snapshots, "@/lib/cloudflareQueue": {
      enqueuePublish: async (...args) => { published.push(args); return true; },
      enqueueFetch: async (...args) => { routed.push(args); return enqueue; },
    },
  });
  return { state, published, routed, run: stage => api.processFetchPost("p", stage) };
}
test("Queue stage transition releases 7-minute lease without consuming a failure attempt", async () => {
  let lease;
  const f = workerFixture({ processor: async () => { lease = f.state.fetchLeaseUntil; throw new FetchDownloadReady({ version: 1, purpose: "fetch", sourceUrl, data: downloaded(), expiresAt: downloaded().expiresAt }); } });
  const start = Date.now(); const result = await f.run();
  assert.equal(result.status, "handed_off"); assert.equal(f.state.fetchAttempt, 0);
  assert.deepEqual(f.routed, [["p", "upload"]]);
  assert.ok(lease.getTime() >= start + 419_000);
  assert.equal(f.state.status, "queued"); assert.equal(f.state.fetchLeaseUntil, null);
  assert.ok(f.state.fetchDownloadSnapshot.data);
});
test("duplicate deliveries claim only once and never publish inside Fetch", async () => {
  let release, calls = 0;
  const f = workerFixture({ row: { fetchDownloadSnapshot: { version: 1, purpose: "fetch", sourceUrl, data: downloaded(), expiresAt: downloaded().expiresAt } },
    processor: async () => { calls++; await new Promise(resolve => { release = resolve; }); return { fetchProvider: "flully", fetchMediaManifest: [], diagnostics: [], links: [] }; } });
  const first = f.run("upload"); await new Promise(resolve => setImmediate(resolve));
  const second = await f.run("upload"); assert.equal(second.status, "skipped");
  release(); await first; assert.equal(calls, 1); assert.equal(f.published.length, 0); assert.equal(f.state.status, "ready");
});
test("publish refresh changes only media, retains captions/affiliate/Ads snapshots and resumes Queue", async () => {
  const f = workerFixture({ row: { pageId: "page", finalCaption: "affiliate #sponsoredcontent", campaignName: "keep", scheduledAt: new Date(0), adCreativeId: "creative", adCtaType: "SHOP_NOW",
    fetchDownloadSnapshot: { version: 1, sourceUrl, purpose: "publish", publishToPage: false, data: downloaded(), expiresAt: downloaded().expiresAt } },
    processor: async () => ({ stableMediaUrl: "https://cloud/video", thumbnailUrl: "https://cloud/thumb", mediaType: "video", cloudinaryId: "video-p", fetchProvider: "flully" }) });
  await f.run("upload");
  assert.equal(f.state.finalCaption, "affiliate #sponsoredcontent"); assert.equal(f.state.campaignName, "keep"); assert.equal(f.state.adCreativeId, "creative");
  assert.equal(f.state.adCtaType, "SHOP_NOW"); assert.equal(f.state.status, "pending"); assert.equal(f.state.fetchDownloadSnapshot.prepared, true);
  assert.equal(f.published[0][1].publishToPage, false);
});
test("stale Fetch delivery cannot rebuild scheduled/cancelled/completed media", async () => {
  for (const row of [{ status: "ready" }, { status: "done" }, { status: "pending" }, { status: "queued", pageId: "page", finalCaption: "keep" }, { fetchDownloadSnapshot: { version: 1, sourceUrl, purpose: "publish", prepared: true } }]) {
    const f = workerFixture({ row, processor: async () => { throw new Error("must not download"); } });
    assert.equal((await f.run()).status, "skipped");
  }
});
test("refresh cannot silently switch a scheduled video to a photo; cron resumes unscheduled refreshes", async () => {
  const f = workerFixture({ row: { finalCaption: "keep", pageId: "page", fetchDownloadSnapshot: { version: 1, sourceUrl, purpose: "publish", data: downloaded(), expiresAt: downloaded().expiresAt } }, processor: async () => ({ mediaType: "image" }) });
  assert.equal((await f.run("upload")).status, "failed"); assert.equal(f.state.fetchErrorCode, "REFRESH_NOT_VIDEO"); assert.equal(f.published.length, 0);
  const cron = readFileSync(new URL("../app/api/cron/publish/route.ts", import.meta.url), "utf8");
  assert.match(cron, /fetchDownloadSnapshot: \{ path: \["prepared"\], equals: true \}/);
});
test("new pipeline has no Render URL, cleanup endpoint, publish-time source fetch or production fallback", () => {
  const source = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  for (const file of ["lib/autodown.ts", "lib/publishDuePost.ts", "lib/fetchMediaCleanup.ts"]) assert.doesNotMatch(source(file), /autodown\.vibevic|onrender\.com|\/api\/cleanup/);
  assert.doesNotMatch(source("lib/publishDuePost.ts"), /autodownDownload/);
  assert.match(source("app/api/queue/fetch/route.ts"), /maxDuration = 300/);
  assert.match(source("app/api/batches/route.ts"), /!process.env.VERCEL && process.env.NODE_ENV !== "production"/);
  assert.match(source("cloudflare/postflow-queue/wrangler.jsonc"), /"postflow-fetch"[\s\S]*"max_concurrency": 2/);
});

test("Cloudinary upload streams once, reuses deterministic ID and verifies HEAD before ready", async () => {
  let saved = null, uploads = 0; const calls = [], requestedIds = [];
  const api = load("lib/cloudinary.ts", {
    cloudinary: { v2: { config: () => {}, api: { resource: async id => { requestedIds.push(id); if (!saved) throw { http_code: 404 }; return saved; } }, uploader: {
      upload_stream: (options, callback) => { uploads++; const stream = new PassThrough(); stream.resume();
        stream.on("finish", () => { saved = { public_id: options.public_id, resource_type: "video", secure_url: "https://res.cloudinary.com/demo/video/upload/v1/test.mp4" }; callback(null, saved); }); return stream;
      },
    } } },
    "@/lib/mediaDimensions": { instagramUpscaleWidth: () => null },
    "@/lib/sourceFetchError": { SourceFetchError },
    "@/lib/fetchProviderCircuit": { assertFetchProviderAvailable: async () => {}, recordFetchProviderSuccess: async () => {}, recordFetchProviderFailure: async () => {} },
    "node:stream": { Readable, Transform }, "node:stream/promises": { pipeline },
  }, { fetch: async (url, options) => { calls.push([url, options.method ?? "GET"]); return options.method === "HEAD" ? new Response(null, { status: 200 }) : new Response("video-bytes"); } });
  await api.uploadFetchedVideo(media.url, "p"); await api.uploadFetchedVideo(media.url, "p");
  assert.equal(uploads, 1); assert.deepEqual(requestedIds, ["postflow-fetch/video-p", "postflow-fetch/video-p"]);
  assert.equal(calls.filter(([, method]) => method === "GET").length, 1);
  assert.equal(calls.filter(([, method]) => method === "HEAD").length, 2);
  assert.equal(api.cloudinaryFetchError({ http_code: 403 }).retryable, false);
  assert.equal(api.cloudinaryFetchError({ http_code: 503 }).retryable, true);
});

test("cleanup preserves shared assets and waits for Ads/Story; SDK confirmation precedes clearing", async () => {
  const row = { id: "p", status: "done", adStatus: null, adId: null, storyEnabled: false, storyStatus: null,
    cloudinaryId: "video-p", stableMediaUrl: "https://res.cloudinary.com/demo/video/upload/test.mp4", mediaType: "video", fetchMediaManifest: null, igMediaManifest: null };
  let references = [{ ...row, id: "other", status: "pending" }], deleted = [], updates = [];
  const api = load("lib/fetchMediaCleanup.ts", {
    "@prisma/client": { Prisma: { DbNull: null } },
    "@/lib/prisma": { prisma: { post: { findUnique: async () => row, findMany: async () => references, update: async value => updates.push(value) } } },
    "@/lib/cloudinary": { deleteFile: async id => deleted.push(id) },
    "@/lib/fetchMediaManifest": { readFetchMediaManifest, fetchMediaCanBeCleaned },
  }, { process: { env: { CLOUDINARY_CLOUD_NAME: "demo" } } });
  await api.cleanupFetchedPhotos("p"); assert.equal(deleted.length, 0); assert.equal(updates[0].data.cloudinaryId, undefined);
  references = []; row.adStatus = "pending"; await api.cleanupFetchedPhotos("p"); assert.equal(deleted.length, 0);
  row.adStatus = null; await api.cleanupFetchedPhotos("p"); assert.deepEqual(deleted, ["video-p"]); assert.equal(updates.at(-1).data.cloudinaryId, null);
});
test("publish preparation reuses >24h Cloudinary media and routes only missing files through Fetch", async () => {
  let available = true, updates = [], enqueues = [];
  const api = load("lib/preparePublishMedia.ts", {
    "@/lib/prisma": { prisma: { post: { updateMany: async value => { updates.push(value); return { count: 1 }; } } } },
    "@/lib/cloudflareQueue": { enqueueFetch: async id => { enqueues.push(id); return true; } },
    "@/lib/cloudinary": { mediaUrlAvailable: async () => { if (available instanceof Error) throw available; return available; } },
    "@/lib/fetchDownloadSnapshot": { readDownloadSnapshot },
  });
  const post = { id: "p", sourceUrl, status: "pending", publishToFacebook: true, mediaType: "video", stableMediaUrl: "https://res.cloudinary.com/demo/video/upload/video.mp4", fetchLeaseUntil: null,
    fetchDownloadSnapshot: { version: 1, sourceUrl, purpose: "fetch", data: downloaded(), expiresAt: new Date(Date.now() - 86_400_000).toISOString() } };
  assert.equal(await api.preparePublishMedia(post), true); assert.equal(enqueues.length, 0);
  available = new SourceFetchError({ provider: "cloudinary", code: "CLOUDINARY_ACCESS_DENIED", message: "locked", retryable: false });
  await assert.rejects(api.preparePublishMedia(post), error => error.code === "CLOUDINARY_ACCESS_DENIED"); assert.equal(enqueues.length, 0);
  available = false; assert.equal(await api.preparePublishMedia(post, false), false);
  assert.equal(enqueues.length, 1); assert.equal(updates[0].data.fetchDownloadSnapshot.purpose, "publish");
  assert.equal(updates[0].data.fetchDownloadSnapshot.publishToPage, false);
  const pending = { ...post, status: "queued", fetchDownloadSnapshot: { version: 1, sourceUrl, purpose: "publish", prepared: false, data: downloaded() } };
  await api.preparePublishMedia(pending); assert.equal(updates.length, 1);
});

test("busy capacity waits do not consume app attempts, even after the normal retry budget", async () => {
  let calls = 0;
  const f = workerFixture({ row: { fetchAttempt: 9 }, processor: async () => { calls++;
    throw new SourceFetchError({ provider: "flully", code: "MEDIA_BUSY", message: "busy", retryable: true });
  } });
  const result = await f.run("download");
  assert.equal(result.status, "waiting"); assert.equal(result.retryAfterSeconds, 10);
  assert.equal(f.state.fetchAttempt, 9); assert.equal(f.state.fetchErrorCode, "MEDIA_BUSY");
  assert.equal(f.state.fetchLeaseUntil, null); assert.equal(f.state.status, "queued");
  assert.match(f.state.errorMsg, /không tính lỗi/);
  assert.equal((await f.run("download")).status, "waiting"); assert.equal(calls, 1);
});
test("legacy and wrong-stage deliveries hand off without downloads or uploads", async () => {
  const snapshot = { version: 1, sourceUrl, purpose: "fetch", data: downloaded(), expiresAt: downloaded().expiresAt };
  for (const [stage, value, expected] of [["legacy", null, "download"], ["download", snapshot, "upload"], ["legacy", snapshot, "upload"],
    ["upload", { ...snapshot, expiresAt: new Date(0).toISOString() }, "download"]]) {
    const f = workerFixture({ row: { fetchDownloadSnapshot: value }, processor: async () => { throw new Error("must hand off, not process"); } });
    assert.equal((await f.run(stage)).status, "handed_off"); assert.deepEqual(f.routed, [["p", expected]]);
    assert.equal(f.state.fetchAttempt, 0); assert.equal(f.state.fetchLeaseUntil, null);
  }
});
test("upload handoff outage preserves checkpoint and never re-downloads", async () => {
  let calls = 0;
  const snapshot = { version: 1, sourceUrl, purpose: "fetch", data: downloaded(), expiresAt: downloaded().expiresAt };
  const f = workerFixture({ enqueue: false, processor: async () => { calls++; throw new FetchDownloadReady(snapshot); } });
  assert.equal((await f.run("download")).status, "deferred");
  assert.ok(f.state.fetchDownloadSnapshot.data); assert.equal(f.state.fetchAttempt, 0);
  assert.equal((await f.run("download")).status, "deferred"); assert.equal(calls, 1);
  assert.equal(f.state.status, "queued"); assert.equal(f.state.fetchLeaseUntil, null);
});
test("checkpoint expiring between route and processing cannot start a download in upload pool", async () => {
  let calls = 0;
  const run = processorFixture({ fetchData: async () => { calls++; return downloaded(); } });
  await assert.rejects(run(sourceUrl, { stage: "upload", postId: "p", separateDownload: true,
    downloadSnapshot: { version: 1, sourceUrl, purpose: "fetch", data: downloaded(), expiresAt: new Date(0).toISOString() } }),
    error => error instanceof FetchStageChanged && error.stage === "download");
  assert.equal(calls, 0);
});
