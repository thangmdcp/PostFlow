# Prompt — PostFlow (copy nguyên vào Claude / Cursor / v0)

---

## CONTEXT

Build a full-stack web application called **PostFlow** — a Facebook competitor-post cloning and scheduling tool for affiliate marketers.

The app lets a user:
1. Paste a **list** of competitor Facebook post URLs (one per line, up to 50)
2. App fetches each post via RapidAPI and **extracts all affiliate links found in each post's caption**, grouped by post
3. User sees a table: each row = one extracted link, grouped under its post, with an input field to paste their own replacement aff link
4. After user fills in their own links → app builds the final post body (original caption with links replaced) → downloads media to Cloudinary
5. User schedules each post to publish on their Facebook Page via FB Graph API
6. Cron job triggers publish at scheduled time → on success: delete Cloudinary file, save published post URL
7. Dashboard shows all published posts; user can select posts and create Facebook Ads from a campaign template

---

## TECH STACK

- **Framework**: Next.js 14 App Router (TypeScript)
- **Database**: PostgreSQL via Prisma ORM
- **Auth**: NextAuth.js with Facebook OAuth (for FB Page + Ad Account access)
- **Storage**: Cloudinary (temporary — deleted after publish)
- **Job scheduler**: Vercel Cron (calls `/api/cron/publish` every minute)
- **External APIs**:
  - RapidAPI: `social-download-all-in-one.p.rapidapi.com` — POST `/v1/social/autolink`
  - Facebook Graph API v19+: post to Page, create Ads
- **UI**: Tailwind CSS + shadcn/ui
- **Hosting**: Vercel + Railway or Supabase (PostgreSQL)

---

## DATABASE SCHEMA (Prisma)

```prisma
model Batch {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  posts     Post[]
}

model Post {
  id             String    @id @default(cuid())
  batchId        String?
  batch          Batch?    @relation(fields: [batchId], references: [id])
  sourceUrl      String                         // original competitor post URL
  title          String?
  rawCaption     String?                        // original caption as-is from RapidAPI
  finalCaption   String?                        // caption after user replaces aff links — used for publishing
  cloudinaryId   String?                        // public_id, for deletion after publish
  stableMediaUrl String?                        // Cloudinary URL
  mediaType      String?                        // "image" | "video"
  extractedLinks ExtractedLink[]
  pageId         String?
  scheduledAt    DateTime?
  status         String    @default("fetching") // fetching | ready | pending | publishing | done | failed
  fbPostId       String?
  fbPostUrl      String?
  errorMsg       String?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt
}

model ExtractedLink {
  id          String  @id @default(cuid())
  postId      String
  post        Post    @relation(fields: [postId], references: [id])
  order       Int                              // position in caption (1-based)
  competitorUrl String                         // original aff link from competitor's post
  myUrl       String?                          // user's own aff link (filled in manually)
}

model FbConnection {
  id          String   @id @default(cuid())
  pageId      String   @unique
  pageName    String
  accessToken String                           // long-lived page token
  adAccountId String?
  createdAt   DateTime @default(now())
}
```

---

## CORE FLOWS TO IMPLEMENT

### Flow 1 — Batch ingest (one RapidAPI call per post, sequential)

```
POST /api/batches
body: { urls: string[] }   // up to 50 URLs

1. Validate + dedupe URLs
2. Create Batch row in DB
3. Create one Post row per URL with status: "fetching"
4. Return { batchId, posts[] } immediately — UI renders the table right away
5. Trigger background worker (sequential, 1.5s delay between calls):
   For each post:
     a. Call RapidAPI → get { title, caption, media[] }
     b. Extract all URLs from caption using regex
     c. Save to DB:
        - post: { title, rawCaption, status: "ready" }
        - extractedLinks: one row per URL found, with order + competitorUrl
     d. Update post status: "ready"
     e. If RapidAPI fails: status: "failed", errorMsg
```

**Why sequential**: RapidAPI has rate limits. Process one post at a time with a short delay to avoid 429 errors.

**Background worker options** (pick one based on hosting):
- Vercel: after returning response, use `waitUntil` from `@vercel/functions` to run the sequential loop
- Railway/VPS: use a simple async queue with `setImmediate` + DB polling

### Flow 2 — User fills in their own aff links

```
This is a manual UI step — no API call needed.

UI: For each ExtractedLink row, user pastes their own aff link into the "My link" input.

PATCH /api/links/:id
body: { myUrl: string }
→ Update ExtractedLink.myUrl

When all links for a post have myUrl filled:
→ Build finalCaption: take rawCaption, replace each competitorUrl with myUrl in order
→ Update Post.finalCaption
→ Trigger Cloudinary upload for that post's media (background)
→ Post status stays "ready" until user schedules it
```

### Flow 3 — Cloudinary upload (after user fills links)

```
Triggered automatically when all ExtractedLinks for a post have myUrl filled.

POST /api/posts/:id/upload-media (internal)
1. Download media from RapidAPI's returned media URL
2. Upload to Cloudinary → get { public_id, secure_url }
3. Update post: { cloudinaryId, stableMediaUrl, mediaType }

NOTE: RapidAPI media URLs are short-lived CDN links.
Upload to Cloudinary immediately after fetching — do not wait until publish time.
```

### Flow 4 — Schedule

```
PATCH /api/posts/:id/schedule
body: { pageId: string, scheduledAt: string (ISO) }

Precondition: post.finalCaption must exist (all links filled + finalCaption built)
Update post: { pageId, scheduledAt, status: "pending" }
```

### Flow 5 — Cron publish (Vercel Cron, every minute)

```
GET /api/cron/publish
Header: Authorization: Bearer {CRON_SECRET}

1. Query posts WHERE status = "pending" AND scheduledAt <= now()
2. For each post:
   a. Set status = "publishing"
   b. POST to FB Graph API /{pageId}/feed:
      { message: finalCaption, [photo/video upload via stableMediaUrl] }
   c. On success:
      - Delete Cloudinary file using cloudinaryId
      - Update post: { status: "done", fbPostId, fbPostUrl, cloudinaryId: null, stableMediaUrl: null }
   d. On failure:
      - Update post: { status: "failed", errorMsg }
      - Keep Cloudinary file (for manual retry)
```

### Flow 6 — Create Ad from template

```
POST /api/ads/create
body: { postId: string, templateCampaignId: string }

1. Fetch template from FB Marketing API:
   GET /{templateCampaignId}?fields=name,objective,status,special_ad_categories
   GET /{templateCampaignId}/adsets?fields=name,targeting,billing_event,optimization_goal,bid_amount,daily_budget
   GET /{adSetId}/ads?fields=name,creative

2. Clone campaign (same settings, new name = original + " [PostFlow]")
3. Clone ad set (same targeting + budget)
4. Create new creative: { object_story_id: "{pageId}_{fbPostId}" }
5. Create new ad
6. Return { campaignId, adSetId, adId }
```

---

## PAGES & UI COMPONENTS

### `/posts/new` — Batch import (main entry point)

```
Step 1 — Paste URLs:
  - Large textarea: "Paste competitor post URLs, one per line"
  - "Fetch all" button
  - Shows paste count: "12 URLs detected"

Step 2 — Link extraction table (appears while fetching, updates in realtime via polling):

  Columns: # | Post | Competitor aff link | My aff link | Status

  Rows are grouped by post. Example for a post with 3 links:
  ┌─────┬──────────────────┬──────────────────────┬────────────────────┬────────┐
  │ 1   │ fb.com/post/111  │ shopee.vn/aff/abc    │ [input field]      │ ready  │
  │ 1   │ ↳ (same post)   │ lazada.vn/aff/xyz    │ [input field]      │        │
  │ 1   │ ↳ (same post)   │ tiki.vn/aff/def      │ [input field]      │        │
  │ 2   │ fb.com/post/222  │ shopee.vn/aff/ghi    │ [input field]      │ ready  │
  └─────┴──────────────────┴──────────────────────┴────────────────────┴────────┘

  - Each "My aff link" cell: input + copy-competitor-link button
  - "Copy all competitor links" button → copies all in a grouped text block
  - Post rows with status "fetching" show a spinner
  - Post rows with status "failed" show error + retry button

Step 3 — After user fills all "My aff link" inputs:
  - "Build posts" button appears per-post (or "Build all ready posts")
  - Triggers finalCaption construction + Cloudinary upload
  - Post card expands: shows preview (thumbnail + finalCaption with links highlighted)

Step 4 — Schedule panel (per post or bulk):
  - Page selector (connected FB pages)
  - Date/time picker
  - "Schedule" button → sets status: pending
```

### `/` — Dashboard

```
Table: Post title | Source URL | Status badge | Scheduled At | FB Post URL | Actions
Status badges: fetching · ready · pending · publishing · done · failed
Actions: Preview | Reschedule | Create Ad | Retry (if failed)
Bulk: checkbox select → "Create Ads from Template"
```

### `/settings/connections` — FB OAuth

```
- "Connect Facebook" → OAuth → store long-lived page token
- List connected pages (toggle active)
- List ad accounts
```

### `/ads` — Ad manager

```
- Campaign template selector (from connected TKQC)
- List of created ads with FB status
```

---

## UI STATES TO HANDLE

```
Post status: "fetching"   → spinner, inputs disabled
Post status: "ready"      → links table editable, "Build post" button
Post status: "pending"    → scheduled badge, reschedule button
Post status: "publishing" → spinner, no actions
Post status: "done"       → green badge, FB post link, "Create Ad" button
Post status: "failed"     → red badge, error message, "Retry" button
```

---

## POLLING STRATEGY (frontend)

```typescript
// Poll batch status every 2s while any post is "fetching"
// Stop polling when all posts are "ready" or "failed"

const { data } = useSWR(
  batchId ? `/api/batches/${batchId}` : null,
  fetcher,
  {
    refreshInterval: (data) => {
      const stillFetching = data?.posts.some(p => p.status === 'fetching')
      return stillFetching ? 2000 : 0
    }
  }
)
```

---

## FB OAUTH SCOPES REQUIRED

```
pages_manage_posts
pages_read_engagement
ads_management
ads_read
business_management
```

---

## ENV VARIABLES

```env
DATABASE_URL=
NEXTAUTH_SECRET=
NEXTAUTH_URL=

FACEBOOK_CLIENT_ID=
FACEBOOK_CLIENT_SECRET=

RAPIDAPI_KEY=
RAPIDAPI_HOST=social-download-all-in-one.p.rapidapi.com

CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

CRON_SECRET=
```

```json
// vercel.json
{
  "crons": [{ "path": "/api/cron/publish", "schedule": "* * * * *" }]
}
```

---

## IMPORTANT CONSTRAINTS

- **RapidAPI: exactly 1 call per post**, at batch ingest time. Never call again for same post.
- **Sequential fetching**: process posts one at a time, 1.5s delay between calls.
- **User replaces links manually**: app extracts competitor links → user provides their own → app builds finalCaption. No auto-replacement.
- **Cloudinary is temporary**: upload after user confirms links, delete immediately after FB publish success.
- **finalCaption must exist** before a post can be scheduled. Gate the schedule button on this.
- **FB API uses page token** from FbConnection, never the user token.
- **Ad cloning**: copy all campaign/adset settings from template, only swap the creative (object_story_id).

---

## FILE BUILD ORDER

```
1.  prisma/schema.prisma
2.  lib/rapidapi.ts          — fetch post data
3.  lib/extractLinks.ts      — regex URL extraction from caption
4.  lib/buildCaption.ts      — replace competitorUrl with myUrl in rawCaption
5.  lib/cloudinary.ts        — upload + delete
6.  lib/facebook.ts          — Graph API + Marketing API
7.  app/api/batches/route.ts              — POST: create batch + trigger worker
8.  app/api/batches/[id]/route.ts         — GET: batch status for polling
9.  app/api/links/[id]/route.ts           — PATCH: save myUrl, trigger caption build
10. app/api/posts/[id]/upload-media/route.ts — internal: Cloudinary upload
11. app/api/posts/[id]/schedule/route.ts  — PATCH: set schedule
12. app/api/cron/publish/route.ts         — GET: cron publish job
13. app/api/ads/create/route.ts           — POST: clone campaign + create ad
14. UI: /posts/new → / (dashboard) → /settings → /ads
```

Build production-ready code with TypeScript types, error handling, loading/error states. Use shadcn/ui throughout.
