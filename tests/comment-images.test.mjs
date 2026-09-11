import test from "node:test";
import assert from "node:assert/strict";
import { cloudinaryCommentPublicId, collectCommentImageUrls, replaceCommentImageUrls } from "../lib/commentImages.ts";

test("recognizes only managed Cloudinary comment assets", () => {
  assert.equal(cloudinaryCommentPublicId("https://res.cloudinary.com/demo/image/upload/v1/postflow/comments/a.jpg"), "postflow/comments/a");
  assert.equal(cloudinaryCommentPublicId("https://res.cloudinary.com/demo/image/upload/v1/postflow/branding/a.jpg"), null);
});

test("collects and replaces nested comment image pools without touching other URLs", () => {
  const value = { engagement: { commentSharedImageUrls: ["old"], commentCustomEntries: [{ imageUrls: ["old", "keep"], link: "old" }] } };
  assert.deepEqual(new Set(collectCommentImageUrls(value)), new Set(["old", "keep"]));
  assert.deepEqual(replaceCommentImageUrls(value, { old: "new", keep: null }), { engagement: { commentSharedImageUrls: ["new"], commentCustomEntries: [{ imageUrls: ["new"], link: "old" }] } });
});
