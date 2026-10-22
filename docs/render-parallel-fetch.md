# Render + Flully parallel downloads

Render runs the minimal `render_api:app`, never the local AutoDown UI. One
Free instance, one Gunicorn worker, threads 4, timeout 290s, Singapore.
`GET /healthz` is public and only returns `{"ok":true}`. All other API calls
require a separate API key. No cookie or Facebook browser-session access.

Server AppConfig: `renderDownloadEnabled` (`true`/`false`), `renderDownloadUrl`
(HTTPS onrender.com origin), `renderDownloadApiKey` (masked) and
`renderDownloadPlatforms` (internal rollout allowlist, initially facebook).
Do not reuse the old Render key or Flully key. Existing Flully snapshots are
unchanged. With `_internal_fetch_pool_enabled=true`, idle-source pump messages
claim the oldest eligible queued Post from a shared database FIFO. The Post CAS
and numbered provider slot are reserved in one advisory-locked transaction.
Slot owner tokens fence release; leases expire after seven minutes. A source
immediately enqueues its next pump after finishing, with cron as recovery only.
Private AppConfig leases fence legacy single-slot calls during rollout: those
must finish/expire before new slots open. Cloudflare Render
Queue concurrency is 2, Flully is 1, Cloudinary upload is 2. Duplicate Post
deliveries remain fenced by the existing 7-minute CAS lease.

Render API also admits at most two children, checking cgroup available RAM
(minimum 160 MiB) and temporary disk (minimum 200 MiB) before each start.
Authenticated `/api/health` reports capacity/resource pauses; public `/healthz`
stays minimal. PostFlow fails closed on missing/invalid capacity and caches it
for ten seconds. Render remains one Free instance, one worker, four threads.
Only never-started source jobs can rebalance; started, uncertain and media
checkpoint jobs keep their source. Existing scheduled/published rows are not
changed. Batch UI shows safe global active counts and source/upload phases;
the authenticated status API never returns tokens or temporary media URLs.

Render downloads and uploads to deterministic `postflow-fetch/video-<postId>`;
source hash context prevents reusing another source under the same ID. Retry
checks Cloudinary first, recovers caption through metadata-only probing if
needed, and never reuploads an existing video. PostFlow verifies that exact
public ID in its own Cloudinary account before ready. Upload checkpoint does
not repeat the Render request. Storage failures never switch source.

Busy waits without app/Queue retry budget or circuit penalty. A disconnected
Render response stays pinned for at least seven minutes; it cannot start a
parallel Flully download for the same Post. Explicit unavailable/not-started
responses may hand off to Flully. Render circuit blocks new assignments while
Flully continues. Assigned uncertain jobs wait for deterministic asset recovery;
they are not silently rerouted or considered successful.

Rollout: deploy/test Render API, create `postflow-render` and
`postflow-render-dlq`, deploy Worker (keep vars/secrets), then deploy PostFlow,
verify private health advertises capacity 2, then enable the pool flag. Enable
only verified platforms. No migrations.
No old failed-batch retries, publishing, Ads, account upgrades or billing changes.
Do not fetch flagged source `facebook.com/reel/3662651097215819`.

cron-job.org: create only one `AutoDown Render · Health 10 phút`, GET the exact
service `/healthz` every 10 minutes, Asia/Ho_Chi_Minh, 30-second timeout, no
auth/keys/query parameters and no new email notifications. Cold starts may
timeout once. Cron neither downloads nor invokes PostFlow publish/Ads/cleanup;
it consumes Free hours and cannot bypass bandwidth/resource suspension.
