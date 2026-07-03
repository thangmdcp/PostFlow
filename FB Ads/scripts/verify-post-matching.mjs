import assert from "node:assert/strict";

function idsFromUrl(url) {
  return [...String(url).matchAll(/\d{8,}/g)].map((match) => match[0]);
}

function attachmentMediaIds(attachments) {
  const ids = [];

  for (const attachment of attachments?.data || []) {
    if (attachment.target?.id) ids.push(String(attachment.target.id));
    ids.push(...idsFromUrl(attachment.url || ""));
    ids.push(...attachmentMediaIds(attachment.subattachments));
  }

  return ids;
}

function normalizedFacebookPath(url) {
  try {
    return new URL(url).pathname.replace(/\/+$/, "").toLowerCase();
  } catch {
    return "";
  }
}

function pfbidFromUrl(url) {
  return normalizedFacebookPath(url)
    .split("/")
    .find((part) => part.startsWith("pfbid")) || "";
}

function explicitPostId(url) {
  const patterns = [
    /\/posts\/(\d+)/i,
    /[?&]story_fbid=(\d+)/i,
    /\/videos\/(\d+)/i,
  ];
  for (const pattern of patterns) {
    const match = String(url).match(pattern);
    if (match) return match[1];
  }
  return "";
}

function postMatchesLink(post, permalink, mediaId) {
  const attachmentIds = new Set(attachmentMediaIds(post.attachments));
  if (mediaId && attachmentIds.has(mediaId)) return true;

  const requestedPath = normalizedFacebookPath(permalink);
  const returnedPath = normalizedFacebookPath(post.permalink_url);
  if (requestedPath && returnedPath && requestedPath === returnedPath) return true;

  const requestedPfbid = pfbidFromUrl(permalink);
  if (requestedPfbid && requestedPfbid === pfbidFromUrl(post.permalink_url)) return true;

  const requestedPostId = explicitPostId(permalink);
  if (!requestedPostId) return false;
  const returnedPostId = explicitPostId(post.permalink_url);
  const graphPostId = String(post.id || "").split("_").at(-1);
  return requestedPostId === returnedPostId || requestedPostId === graphPostId;
}

const reelPost = {
  id: "249610694892143_122298607982194212",
  permalink_url: "https://www.facebook.com/example/posts/122298607982194212",
  attachments: {
    data: [
      {
        media_type: "video",
        target: { id: "1571158507913865" },
        url: "https://www.facebook.com/reel/1571158507913865/",
      },
    ],
  },
};

assert.equal(
  postMatchesLink(
    reelPost,
    "https://www.facebook.com/reel/1571158507913865/",
    "1571158507913865",
  ),
  true,
);
assert.deepEqual(attachmentMediaIds(reelPost.attachments), [
  "1571158507913865",
  "1571158507913865",
]);

const imagePostUrl =
  "https://www.facebook.com/61552628540685/posts/pfbid02zjBVrkHm3wFVHqoYivZyTnUVBQ3Ru4Ma9q8JjenmxboJK8yYdQBuhdvuxo29eSxbl";
assert.equal(
  postMatchesLink({ permalink_url: imagePostUrl, attachments: { data: [] } }, imagePostUrl, ""),
  true,
);

const samePageWrongPost = {
  id: "61552628540685_122298271532194212",
  permalink_url:
    "https://www.facebook.com/61552628540685/posts/pfbidDIFFERENTPOST",
  attachments: { data: [] },
};
assert.equal(postMatchesLink(samePageWrongPost, imagePostUrl, ""), false);

assert.equal(
  postMatchesLink(
    {
      id: "249610694892143_122298607982194212",
      permalink_url:
        "https://www.facebook.com/example/posts/122298607982194212",
      attachments: { data: [] },
    },
    "https://www.facebook.com/example/posts/122298607982194212",
    "",
  ),
  true,
);

console.log("Verified: post matching ignores shared Page IDs and requires a specific post.");
