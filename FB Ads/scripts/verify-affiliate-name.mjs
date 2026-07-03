import assert from "node:assert/strict";

function normalizedUtmContent(raw) {
  return decodeURIComponent(String(raw || "")).trim().replace(/[-_]+$/, "");
}

function utmContentFromUrl(url) {
  return normalizedUtmContent(new URL(url).searchParams.get("utm_content"));
}

const resolved =
  "https://shopee.vn/product?utm_campaign=test&utm_content=toan-toan466---&utm_medium=affiliates";

assert.equal(utmContentFromUrl(resolved), "toan-toan466");
console.log("Verified: utm_content becomes the shared campaign name.");
