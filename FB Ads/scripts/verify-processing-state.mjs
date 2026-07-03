import assert from "node:assert/strict";

function adProcessingKey(ad) {
  return `${ad.pageId}|${ad.sourcePermalink || ad.permalink}`;
}

const readyAd = {
  pageId: "100",
  sourcePermalink: "https://www.facebook.com/reel/111",
  permalink: "https://www.facebook.com/example/posts/9001",
  processedKey: "100|https://www.facebook.com/reel/111",
  status: "ready",
};
const newAd = {
  pageId: "100",
  sourcePermalink: "https://www.facebook.com/reel/222",
  permalink: "https://www.facebook.com/reel/222",
  processedKey: "",
  status: "pending",
};

const candidates = [readyAd, newAd].filter(
  (ad) => ad.status !== "ready" || ad.processedKey !== adProcessingKey(ad),
);

assert.deepEqual(candidates, [newAd]);
assert.equal(adProcessingKey(readyAd), readyAd.processedKey);

console.log("Verified: adding a new link does not reprocess ready ads.");
