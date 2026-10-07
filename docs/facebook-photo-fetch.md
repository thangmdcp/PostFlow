# Facebook photo Fetch

AutoDown `/api/download` tries cookie-free gallery-dl 1.32.15 for Facebook
post/permalink/photo/set URLs. Explicit Reel/video URLs continue using yt-dlp.
Unsupported or video results fall through to yt-dlp; other photo failures return
a structured error so PostFlow can use RapidAPI. No browser cookies/configuration
are loaded. No Facebook post or ad is created during Fetch.

Photo jobs use two slots per AutoDown process (production Procfile uses one
worker), a hard 60-second subprocess deadline, 50-photo maximum and 25 MiB per
image. Photos are validated by Pillow and uploaded as images. Failed extraction,
skipped images and partial uploads cannot return a successful album. Source
results do not establish completeness unless the provider supplies a reliable
total. Default followup/comment extraction and album wraparound are disabled.

Apply `prisma/migrations/20261007000000_add_fetch_media_manifest/migration.sql`
before deploying PostFlow. No old rows are backfilled. `fetchMediaManifest`
checkpoints each photo, its source URL, stable Cloudinary URL, public ID, order,
provider and extractor. RapidAPI photos also upload before `ready`. Stable IDs
and stored checkpoints avoid duplicate uploads during retry; empty media is a
Fetch error rather than a text-only ready post.

AutoDown photo cache checks asset URLs before reuse. AutoDown uploads use its
own Cloudinary credentials; PostFlow uses `/api/cleanup` for those assets and
its own Cloudinary credentials for RapidAPI assets. Photo manifests are retained
while scheduled, partially published, or waiting for Ads/Story. Successful
publish, Ads, and Story handlers attempt cleanup only when all dependencies have
completed. Failed dependencies retain assets for manual retry. Shared cached
assets are not deleted while another Post manifest references them.

Rollout: AutoDown deploy and authenticated health (`galleryDlVersion`) → nullable
database column → PostFlow deploy. Acceptance reads/downloads the two supplied
sample URLs, verifies media bytes/caption/Shopee links and checks image order
against Facebook. Never enqueue publishing or Ads as part of this acceptance.
