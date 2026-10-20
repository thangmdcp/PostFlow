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

1. Two-slot Fetch Queue claims a seven-minute lease. Flully request has a
   280-second maximum. `/api/queue/fetch` has `maxDuration = 300`; Vercel Hobby
   must have Fluid Compute enabled (verify in project Settings → Functions).
2. Store `Post.fetchDownloadSnapshot` JSON: version, source URL, media with
   per-media thumbnail, expiry and purpose. Release lease, return a one-second
   deferred delivery. This transition consumes no failure retry.
3. Next delivery uploads via bounded streaming to Cloudinary using deterministic
   ID `postflow-fetch/video-<Post ID>`. Existing IDs are read/reused. Only a
   successful upload and readable Cloudinary HEAD allow `ready`. The retained
   thumbnail is Cloudinary-derived, not Flully's expiring URL.
4. Upload failure preserves checkpoint. Until its expiry (minus 60 seconds),
   retry upload without re-downloading. Missing/expired snapshots download
   again. Flully/media URLs never become persistent publish/Ads URLs.

Media timeout, busy, quota and capacity failures use durable backoff and
provider-specific circuit breakers. Flully does not inherit Render's breaker.
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

Apply `20261020000000_flully_download_checkpoint/migration.sql`, configure new
key/origin, deploy PostFlow. Existing Cloudflare consumer already supports
deferred responses and concurrency two; no worker change is required.
Run unit tests, TypeScript and production build. Accept using one isolated
public video: download, checkpoint, upload, API metadata and HEAD verification.
Do not invoke batch creation (which can also top up Stories), publishing, Ads,
or retry existing failed batches. Never fetch the previously flagged/deleted
source `facebook.com/reel/3662651097215819` (`nghithuy-rbt101`).

No Render project deletion, billing changes or automatic recovery of old jobs.
