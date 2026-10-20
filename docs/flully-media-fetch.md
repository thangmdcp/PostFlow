# Flully media Fetch (2026-10-20)

Render AutoDown is retired. No request, health check or cleanup is sent there.
Normal Fetch calls only `POST https://flully.com/api/autodown/v1/download`,
with `X-API-Key` and exactly `{ "url": "..." }`. Extract is metadata-only
and is not called as a preflight. Flully returns video, not photos/albums.
Unsupported photo sources fall back to RapidAPI and photos are stabilized
in Cloudinary. Authentication/config errors never silently fall back.

## Configuration

Setup → Flully API key (`AppConfig.flullyAutoDownApiKey`, environment fallback
`AUTODOWN_PUBLIC_API_KEY`). This is a separate credential from the old Render
key. Setup/API responses mask it; do not print credentials or capability URLs.
Optional origin IP: `AppConfig.flullyAutoDownOriginIp` or
`AUTODOWN_ORIGIN_IP`. The backend client is adapted from the provider's supplied
Node HTTPS client: only DNS is overridden; hostname, Host, TLS SNI and normal
certificate verification remain `flully.com`. No insecure TLS/redirect bypass.

## Durable steps

1. `postflow-download` has concurrency **one**; `postflow-upload` has concurrency
   **two**. Both call `/api/queue/fetch` with an explicit stage and claim a seven-minute
   per-Post lease. A shared, owner-fenced seven-minute Flully lease in AppConfig
   also protects cross-instance/legacy/local calls; DB transactions end before
   network I/O. Flully request has a
   280-second maximum. `/api/queue/fetch` has `maxDuration = 300`; Vercel Hobby
   must have Fluid Compute enabled (verify in project Settings → Functions).
2. Store `Post.fetchDownloadSnapshot` JSON: version, source URL, media with
   per-media thumbnail, expiry and purpose. Release lease, enqueue immediately
   to the **upload queue**, then ACK the download job. This transition consumes
   neither application nor Queue failure retries. Failed enqueue preserves the
   checkpoint and retries only the handoff; cron also routes recovery by stage.
3. The independent upload delivery streams to Cloudinary using deterministic
   ID `postflow-fetch/video-<Post ID>`. Existing IDs are read/reused. Only a
   successful upload and readable Cloudinary HEAD allow `ready`. The retained
   thumbnail is Cloudinary-derived, not Flully's expiring URL.
4. Upload failure preserves checkpoint. Until its expiry (minus 60 seconds),
   retry upload without re-downloading. Missing/expired snapshots download
   again. Flully/media URLs never become persistent publish/Ads URLs.

`MEDIA_BUSY` is resource waiting, not failure: no app attempt increment, no
circuit update, and no Queue retry consumption. The consumer sends a delayed
replacement (normally 5–10 seconds) and ACKs only once the send succeeds. Old
breakers caused solely by `MEDIA_BUSY` are ignored and don't count toward the
next real failure window. Real timeout, quota and capacity failures keep their
durable backoff/circuit behavior. Flully does not inherit Render's breaker.
Cloudinary authentication/account locks surface as storage errors; no bypass
and no alternate source downloads. Jobs stay queued for cron recovery if the
producer is unavailable in production, never run in the batch-create 60s route.

Before Publish Queue reserves Meta quota, check video availability. Only
404/410 imply missing media; authorization errors do not. Missing video is
prepared through Fetch Queue, preserving caption, affiliate, schedule and Ads
snapshots. The completed refresh resumes Publish Queue, never publishes in
Fetch. Legacy assets are not rewritten or backfilled during rollout.

Cleanup uses Cloudinary SDK and checks deletion confirmation and references.
Assets are retained until publishing, Ads and Story finish and no other active
post needs the ID. Legacy assets in a different Cloudinary cloud are not deleted.
Flully has no assumed public cleanup or health endpoint.

## Rollout / acceptance

The original Flully integration requires
`20261020000000_flully_download_checkpoint/migration.sql` and key/origin config.
The split-queue optimization needs **no further migration**. Create
`postflow-download`, `postflow-upload` and their respective `-dlq` queues, then
deploy the Cloudflare Worker/bindings **before** the new PostFlow deployment.
Keep `postflow-fetch` and its DLQ: old messages are handed to the correct new
queue using the current database checkpoint, never replayed as inline downloads.
The producer still accepts old `{type:"fetch",postId}` jobs; missing stage means
download. Queue name overrides delivery payload stage. No failed/DLQ batch is
automatically retried. Existing publish/Ads/engagement queues stay unchanged.

Fetch logs contain only Post ID, stage, result and duration in milliseconds;
they never include keys, captions or temporary capability URLs. Use these
stage timings to distinguish actual download/upload latency from queue waiting.
Run unit tests, TypeScript and production build. Accept using one isolated
public video: download, checkpoint, upload, API metadata and HEAD verification.
Do not invoke batch creation (which can also top up Stories), publishing, Ads,
or retry existing failed batches. Never fetch the previously flagged/deleted
source `facebook.com/reel/3662651097215819` (`nghithuy-rbt101`).

No Render project deletion, billing changes or automatic recovery of old jobs.
