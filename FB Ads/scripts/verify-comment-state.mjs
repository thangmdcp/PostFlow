import assert from "node:assert/strict";

function commentMessage(ad) {
  const body = String(ad.body || "").trim();
  const defaultText = String(ad.commentText || "").trim();
  if (ad.commentMode === "DEFAULT") return defaultText;
  if (ad.commentMode === "DEFAULT_BODY") {
    return [defaultText, body].filter(Boolean).join("\n\n");
  }
  return body;
}

function adCommentKey(ad) {
  return `${ad.storyId}|${commentMessage(ad)}`;
}

function commentNeedsPosting(ad) {
  return (
    ad.commentEnabled &&
    ad.commentPostedKey !== adCommentKey(ad)
  );
}

function normalizedCommentText(text) {
  return String(text || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("vi");
}

const ad = {
  storyId: "100_200",
  commentEnabled: true,
  commentMode: "BODY",
  body: "Nội dung bài viết",
  commentText: "Link sản phẩm ở đây",
  commentPostedKey: "",
};

assert.equal(commentNeedsPosting(ad), true);
assert.equal(commentMessage(ad), "Nội dung bài viết");
ad.commentPostedKey = adCommentKey(ad);
assert.equal(commentNeedsPosting(ad), false);
ad.body = "Nội dung mới";
assert.equal(commentNeedsPosting(ad), true);
ad.commentMode = "DEFAULT";
assert.equal(commentMessage(ad), "Link sản phẩm ở đây");
ad.commentMode = "DEFAULT_BODY";
assert.equal(commentMessage(ad), "Link sản phẩm ở đây\n\nNội dung mới");
ad.commentEnabled = false;
assert.equal(commentNeedsPosting(ad), false);
assert.equal(
  normalizedCommentText("  Nội dung\n bài viết  "),
  normalizedCommentText("nội DUNG bài viết"),
);

console.log("Verified: comments are opt-in and duplicate text is normalized.");
