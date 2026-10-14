# Instagram placements using Facebook Page identity

Facebook-source ads can use Instagram placements without a linked Instagram Professional account. Organic Instagram publishing still needs a real linked account. Threads retains its linked-account requirement.

The server prefers the linked identity. Otherwise it reads the Page-backed Instagram edge, creating only after a successful empty response. A Page-scoped database advisory lock coalesces creation; discovery is cached for 24 hours with a token fingerprint. Tokens are never stored in the cache value. Discovery errors never trigger creation.

`Post.adInstagramIdentity` freezes the identity before Campaign creation. Retry never replaces it, and existing creatives are not modified. Page-backed identities are checked through Page ownership and Page advertising permissions rather than the linked-account asset listing. They are never written into `FbConnection.instagramUserId`.

Apply `20261014000000_add_ad_instagram_identity` before deploying. Existing rows stay null; no old batch is automatically retried. On unsupported identity/objective errors, the selected placements are not silently removed. Page-backed Instagram does not imply Threads support.

Acceptance uses an existing Facebook story with all newly created Campaign/Ad Set/Ad statuses Paused. This verifies configuration, not actual paid delivery.
