import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ensureSponsoredContentHashtag,
  hasSponsoredContentHashtag,
  SPONSORED_CONTENT_HASHTAG,
} from "../lib/sponsoredContent.ts";

test("appends the sponsored-content hashtag after one blank line", () => {
  assert.equal(
    ensureSponsoredContentHashtag("Nội dung bài viết   \n"),
    "Nội dung bài viết\n\n#sponsoredcontent",
  );
  assert.equal(ensureSponsoredContentHashtag(""), SPONSORED_CONTENT_HASHTAG);
});

test("recognizes the hashtag case-insensitively and next to punctuation", () => {
  for (const caption of [
    "Mở đầu #sponsoredcontent kết thúc",
    "Mở đầu (#SPONSOREDCONTENT).",
    "#SponsoredContent!",
  ]) {
    assert.equal(hasSponsoredContentHashtag(caption), true);
    assert.equal(ensureSponsoredContentHashtag(caption), caption);
  }
});

test("does not mistake a longer hashtag for sponsoredcontent", () => {
  const caption = "Nội dung #sponsoredcontents";
  assert.equal(hasSponsoredContentHashtag(caption), false);
  assert.equal(
    ensureSponsoredContentHashtag(caption),
    `${caption}\n\n#sponsoredcontent`,
  );
});

test("normalization is idempotent and disabled snapshots stay untouched", () => {
  const once = ensureSponsoredContentHashtag("Nội dung");
  assert.equal(ensureSponsoredContentHashtag(once), once);
  assert.equal(ensureSponsoredContentHashtag("Bài cũ", false), "Bài cũ");
});

test("all execution entry points enable the snapshot and worker gates old posts", async () => {
  const routeFiles = [
    "app/api/posts/[id]/schedule/route.ts",
    "app/api/posts/[id]/queue-publish/route.ts",
    "app/api/posts/[id]/publish/route.ts",
  ];
  for (const path of routeFiles) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    assert.match(source, /sponsoredContentTagEnabled:\s*true/);
    assert.match(source, /finalCaption:\s*ensureSponsoredContentHashtag\(post\.finalCaption\)/);
  }

  const worker = await readFile(new URL("../lib/publishDuePost.ts", import.meta.url), "utf8");
  assert.match(worker, /post\.sponsoredContentTagEnabled === true/);

  const unschedule = await readFile(new URL("../app/api/posts/bulk-unschedule/route.ts", import.meta.url), "utf8");
  assert.match(unschedule, /sponsoredContentTagEnabled:\s*null/);
});
