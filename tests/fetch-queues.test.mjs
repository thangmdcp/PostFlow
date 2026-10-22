import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { SourceFetchError } from "../lib/sourceFetchError.ts";

function load(file, mocks = {}, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, require: id => { if (!(id in mocks)) throw new Error(`Unexpected import ${id}`); return mocks[id]; },
    Date, URL, Request, Response, ...globals });
  return module.exports;
}
function queueFixture({ reply = { fetchStatus: "handed_off" }, httpStatus = 200, sendFailure = false } = {}) {
  const sent = [], requests = [], acks = [], retries = [];
  const queue = type => ({ send: async (body, options) => { if (sendFailure) throw new Error("Queue unavailable"); sent.push({ type, body, options }); } });
  const env = { POSTFLOW_QUEUE_SECRET: "secret", POSTFLOW_API_URL: "https://postflow.example",
    POSTFLOW_PUBLISH_QUEUE: queue("publish"), POSTFLOW_ADS_QUEUE: queue("ads"), POSTFLOW_ENGAGEMENT_QUEUE: queue("engagement"),
    POSTFLOW_FETCH_QUEUE: queue("legacy"), POSTFLOW_DOWNLOAD_QUEUE: queue("download"), POSTFLOW_UPLOAD_QUEUE: queue("upload"), POSTFLOW_RENDER_QUEUE: queue("render") };
  const api = load("cloudflare/postflow-queue/src/index.ts", {}, { fetch: async (url, init) => { requests.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(reply), { status: httpStatus }); } }).default;
  return { api, env, sent, requests, acks, retries,
    message: body => ({ body, ack: () => acks.push(true), retry: options => retries.push(options) }) };
}
test("producer sends new downloads and uploads into different bindings; other jobs stay unchanged", async () => {
  const f = queueFixture();
  for (const [body, expected] of [[{ type: "fetch", postId: "p" }, "download"], [{ type: "fetch", postId: "p", stage: "upload" }, "upload"],
    [{ type: "publish", postId: "p" }, "publish"], [{ type: "ads", postId: "p" }, "ads"], [{ type: "comment", commentId: "c" }, "engagement"]]) {
    const result = await f.api.fetch(new Request("https://worker.example/enqueue", { method: "POST", headers: { Authorization: "Bearer secret" }, body: JSON.stringify(body) }), f.env);
    assert.equal(result.status, 202); assert.equal(f.sent.at(-1).type, expected);
  }
  for (const stage of ["legacy", "unknown"]) {
    const result = await f.api.fetch(new Request("https://worker.example/enqueue", { method: "POST", headers: { Authorization: "Bearer secret" }, body: JSON.stringify({ type: "fetch", postId: "p", stage }) }), f.env);
    assert.equal(result.status, 400);
  }
});
test("actual Queue name overrides payload stage and legacy deliveries only hand off", async () => {
  for (const [queue, expected] of [["postflow-download", "download"], ["postflow-upload", "upload"], ["postflow-fetch", "legacy"]]) {
    const f = queueFixture();
    await f.api.queue({ queue, messages: [f.message({ type: "fetch", postId: "p", stage: "download" })] }, f.env);
    assert.equal(f.requests[0].body.stage, expected); assert.equal(f.acks.length, 1); assert.equal(f.retries.length, 0);
  }
});
test("MEDIA_BUSY sends a delayed replacement then ACKs without consuming Queue retries", async () => {
  const f = queueFixture({ reply: { fetchStatus: "waiting", retryAfterSeconds: 10 } });
  await f.api.queue({ queue: "postflow-download", messages: [f.message({ type: "fetch", postId: "p" })] }, f.env);
  assert.equal(f.sent[0].type, "download"); assert.equal(f.sent[0].body.stage, "download"); assert.equal(f.sent[0].options.delaySeconds, 10);
  assert.equal(f.acks.length, 1); assert.equal(f.retries.length, 0);
});
test("failed replacement enqueue does not ACK or lose the waiting message", async () => {
  const f = queueFixture({ reply: { fetchStatus: "waiting", retryAfterSeconds: 5 }, sendFailure: true });
  await assert.rejects(f.api.queue({ queue: "postflow-download", messages: [f.message({ type: "fetch", postId: "p" })] }, f.env));
  assert.equal(f.acks.length, 0);
});
test("idle-source pump immediately pulls next work; busy waits; empty pool stops", async () => {
  for (const [status,delay] of [["done",0],["handed_off",0],["failed",0],["waiting",10],["skipped",null]]) {
    const f=queueFixture({reply:{fetchStatus:status,retryAfterSeconds:10}});
    await f.api.queue({queue:"postflow-render",messages:[f.message({type:"fetch-pump",provider:"flully"})]},f.env);
    assert.equal(f.requests[0].body.provider,"render");
    assert.equal(f.acks.length,1);
    if(delay===null)assert.equal(f.sent.length,0);
    else {assert.equal(f.sent[0].type,"render");assert.equal(f.sent[0].options.delaySeconds,delay);}
  }
});
test("pump enqueue failure or malformed response does not lose delivery", async () => {
  for(const options of [{reply:{fetchStatus:"done"},sendFailure:true},{reply:{}}]){
    const f=queueFixture(options);
    const run=f.api.queue({queue:"postflow-download",messages:[f.message({type:"fetch-pump",provider:"flully"})]},f.env);
    if(options.sendFailure)await assert.rejects(run);else {await run;assert.equal(f.retries.length,1);}
    assert.equal(f.acks.length,0);
  }
});
test("a single Render pump starts two independent lanes without waiting for autoscaling",async()=>{
  let release;let active=0,max=0,calls=0;
  const api=load("cloudflare/postflow-queue/src/index.ts",{},{fetch:async()=>{
    calls++;active++;max=Math.max(max,active);if(calls<=2)await new Promise(resolve=>{if(release){release();resolve();}else release=resolve;});active--;
    return new Response(JSON.stringify({fetchStatus:"skipped"}));
  }}).default;
  let ack=0;await api.queue({queue:"postflow-render",messages:[{body:{type:"fetch-pump",provider:"render"},ack:()=>ack++,retry:()=>assert.fail()}]}, {POSTFLOW_API_URL:"https://test",POSTFLOW_QUEUE_SECRET:"secret"});
  assert.equal(max,2);assert.equal(ack,1);
});
test("real upload/network errors retain Queue retry/backoff and never move into download pool", async () => {
  const f = queueFixture({ reply: { retryAfterSeconds: 120 }, httpStatus: 503 });
  await f.api.queue({ queue: "postflow-upload", messages: [f.message({ type: "fetch", postId: "p" })] }, f.env);
  assert.equal(f.retries[0].delaySeconds, 120); assert.equal(f.acks.length, 0); assert.equal(f.sent.length, 0);
});
test("download concurrency is one, upload concurrency is two, legacy consumer is retained", () => {
  const config = JSON.parse(readFileSync(new URL("../cloudflare/postflow-queue/wrangler.jsonc", import.meta.url), "utf8"));
  const byQueue = Object.fromEntries(config.queues.consumers.map(c => [c.queue, c]));
  assert.equal(byQueue["postflow-download"].max_concurrency, 1);
  assert.equal(byQueue["postflow-upload"].max_concurrency, 2);
  assert.ok(byQueue["postflow-fetch"]);
});
function leaseFixture() {
  let row = null, chain = Promise.resolve(), counter = 0;
  const config = { findUnique: async () => row && { ...row }, findMany: async () => [],
    upsert: async ({ create, update }) => { row = row ? { ...row, ...update } : { ...create }; },
    updateMany: async ({ where, data }) => { if (row?.value !== where.value) return { count: 0 }; Object.assign(row, data); return { count: 1 }; } };
  const api = load("lib/flullyDownloadLease.ts", { "node:crypto": { randomUUID: () => `owner-${++counter}` },
    "@/lib/sourceFetchError": { SourceFetchError }, "@/lib/prisma": { prisma: {
      appConfig: config, $transaction: callback => { const next = chain.then(() => callback({ appConfig: config, $queryRawUnsafe: async () => [] })); chain = next.catch(() => {}); return next; },
    } } });
  return { api, value: () => row?.value, expire: () => { row.value = JSON.stringify({ owner: "expired", until: 0 }); } };
}
test("shared lease admits one Flully download across workers and releases after failure", async () => {
  const f = leaseFixture(); let release, calls = 0;
  const first = f.api.withFlullyDownloadLease(async () => { calls++; await new Promise(resolve => { release = resolve; }); });
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(f.api.withFlullyDownloadLease(async () => calls++), error => error.code === "MEDIA_BUSY");
  assert.equal(calls, 1); release(); await first; assert.equal(f.value(), "");
  await assert.rejects(f.api.withFlullyDownloadLease(async () => { throw new Error("upstream failure"); })); assert.equal(f.value(), "");
});
test("expired owner cannot release a successor's shared lease", async () => {
  const f = leaseFixture(); let firstRelease, secondRelease;
  const first = f.api.withFlullyDownloadLease(() => new Promise(resolve => { firstRelease = resolve; }));
  await new Promise(resolve => setImmediate(resolve)); f.expire();
  const second = f.api.withFlullyDownloadLease(() => new Promise(resolve => { secondRelease = resolve; }));
  await new Promise(resolve => setImmediate(resolve)); const successor = f.value();
  firstRelease(); await first; assert.equal(f.value(), successor);
  secondRelease(); await second; assert.equal(f.value(), "");
});
test("busy never opens a circuit; legacy busy circuits don't poison real failure counts", async () => {
  let state = { lastErrorCode: "MEDIA_BUSY", blockedUntil: new Date(Date.now() + 60_000), consecutiveFailures: 10, failureWindowStartedAt: new Date() }, writes = [];
  const api = load("lib/fetchProviderCircuit.ts", { "@/lib/sourceFetchError": { SourceFetchError },
    "@/lib/prisma": { prisma: { fetchProviderState: { findUnique: async () => state, upsert: async ({ update }) => { writes.push(update); state = { ...state, ...update }; } } } } });
  await api.assertFetchProviderAvailable("flully");
  for (let i = 0; i < 10; i++) await api.recordFetchProviderFailure(new SourceFetchError({ provider: "flully", code: "MEDIA_BUSY", message: "busy", retryable: true }));
  assert.equal(writes.length, 0);
  const real = new SourceFetchError({ provider: "flully", code: "UPSTREAM_TIMEOUT", message: "timeout", retryable: true });
  await api.recordFetchProviderFailure(real); assert.equal(writes[0].consecutiveFailures, 1); assert.equal(writes[0].blockedUntil, null);
  await api.recordFetchProviderFailure(real); await api.recordFetchProviderFailure(real);
  await assert.rejects(api.assertFetchProviderAvailable("flully"), error => error.code === "PROVIDER_CIRCUIT_OPEN");
});
