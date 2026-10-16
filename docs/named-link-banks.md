# Named link banks

Each bank has its own name and unique normalized source keys. Identical links in different banks remain independent. Known Facebook Reel/video and TikTok video IDs, Facebook post/permalink IDs, and common tracking parameters are normalized without resolving redirects or fetching source pages. Unknown short-link aliases are not guaranteed to match their long URLs.

Create an empty bank and add links, or save the composer as a bank. Additions report added, duplicate and invalid counts. Banks retain links after use. Quantity imports default to unused links, preserve bank order, and exclude the current composer. Explicit reuse is opt-in; imports may return fewer links than requested if insufficient eligible links remain.

Importing only fills the composer; it does not reserve/consume entries. The composer stores entry provenance and a request key alongside its existing draft, surviving F5 and storage-event sync. Manual source links retain their current behavior; legacy historical links remain available via “Lịch sử batch cũ” and are not automatically converted into named banks.

`POST /api/batches` accepts optional `bankSelections` and `requestKey`. Server validation matches every entry to the normalized URL. A transaction locks entries in stable order, creates the batch and records usage together. If another tab used an entry first, the whole request returns 409 and retains the composer, not a partially created batch. The same request key/payload reuses the existing batch after a lost response. Explicit reuse creates a new batch but never resets usage history. A failed Fetch remains used and should be retried at its existing batch. Deleting a Post does not reset bank usage.

The limit is 200 unique links per batch, with a clear validation error rather than silent truncation. Fetch processing still uses the existing Queue; selecting a large quantity does not raise provider concurrency. No Facebook publish or Ads operation is initiated by bank management.

Apply `20261016000000_named_link_banks` before Vercel deployment. This adds tables and nullable provenance/idempotency columns only; no old batch or schedule is modified.
