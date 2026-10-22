# Ads on the original Facebook post

The **ID campaign** composer reads ads from a campaign and resolves their canonical
`effective_object_story_id` (falling back only to `object_story_id`). It never
infers a post from a video ID. Ads sharing a story are merged, retaining all
campaign/account/ad/creative provenance. Published and dark posts are eligible
when the connected Page can read/promote them. Instagram-only/dynamic creatives
without a concrete Facebook Story ID are reported as unsupported, not recreated.

Imports checkpoint each page in `CampaignImportSource`. The original Graph node
and cursor are used rather than following a token-bearing `paging.next` URL.
Account discovery tries one unique saved token per delivery. Quota/pagination
continuations enqueue a fresh message, preserving Cloudflare retry budget. A
two-minute lease and conditional updates fence duplicate deliveries; cron
recovers expired/lost work without a browser. Tokens never enter preview/snapshots.

Confirmation creates `Post` rows with `sourceKind=existing_facebook_post` and an
immutable `adSourceSnapshot`. Source campaign/ad/creative IDs are kept separate
from newly created paid-asset IDs. The Facebook post status is always `done`;
the Ads lifecycle lives in `adStatus`. A request key/hash makes both confirmation
and configuration retry-safe after a lost response. No automatic re-run after a
completed ad: use a new import session to intentionally create another campaign.

Setup uses normal account templates and currency/cap guards. The Page is fixed.
CTA, destination, caption, media, deep links and original-post mutation are never
overridden. Creative enhancements are off in this mode; targeting/placements
remain configurable. Server guards also cover direct/legacy publish, fetch,
affiliate editing, CTA, comments and Story jobs.

Schedule defers creation; Prepare spaces creation before a future ad-set start;
Now enqueues immediately. PAUSED remains PAUSED in all three modes. Late jobs
start as soon as possible, without rolling to tomorrow. A schedule can be
cancelled only before any new paid asset or creation claim exists. Duplicate
deliveries honor due times and atomically claim jobs. Each paid-asset ID is
checkpointed; activation retries reuse them. All new assets begin PAUSED.
The new creative's effective Story ID must equal the source before an Ad is
created; ACTIVE activation proceeds Ad → Ad Set → Campaign (last).

## Rollout

1. Run tests, TypeScript and build. Apply only
   `20261022000000_reuse_campaign_posts` before deploying the new Prisma client.
   `node --env-file=.env.local scripts/migrate-campaign-reuse.mjs` checks state;
   append `--apply` to apply this additive migration atomically. It does not run
   historical migrations or rewrite existing posts/campaigns.
2. Deploy `cloudflare/postflow-queue/wrangler.jsonc` first. It accepts the new
   `{type:"campaign-source",sourceId}` job and sends it to the existing
   `postflow-fetch` metadata queue; video download/upload pools are unchanged.
3. Deploy PostFlow backend/UI together after schema/Worker readiness. No new
   secrets, queue bindings or account permissions beyond existing read/manage
   ads and connected Page access are introduced.
4. Acceptance: use a selected source campaign and a budget-confirmed destination
   account, with all newly created assets PAUSED. Check the effective Story ID,
   original CTA/destination and unchanged source campaign. Do not run acceptance
   with ACTIVE status. Unit/integration fakes never contact Meta or spend money.

If migration or Worker rollout cannot complete, do not deploy the new app.
Rolling back the app/Worker may retain additive tables for recovery/audit.

## Live acceptance — 2026-10-22

Source campaign `120254535360910450` resolved to the existing story
`249610694892143_122311787978194212`. Isolated acceptance batch:
`cmvix9r99000110huqufycsfx`. New campaign `120255334857190045`, Ad Set
`120255334857610045`, creative `1921509355240109`, Ad `120255334859360045`.
All three configured statuses were read back from Meta as **PAUSED**. The
creative's effective Story ID matched, original caption was unchanged, and
the actual daily budget was `50000` minor units / `50000` VND. Assets remain
PAUSED and are identified with `[PostFlow PAUSED acceptance]` for audit.

The live run exposed 56 cached Business quota scopes: sequential per-scope
upserts exceeded the interactive transaction timeout. Reservations now use one
parameterized bulk UPSERT under the same Serializable transaction, preserving
quota/spacing values. Conflicting reservations defer after bounded retries.
Regression covers 57 simultaneous scopes and a 20-post VND/USD action; metadata
and permission checks are reused per account/Page pair within that action.
