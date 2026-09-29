export const SPONSORED_CONTENT_HASHTAG = "#sponsoredcontent";

const SPONSORED_CONTENT_PATTERN =
  /(^|[^\p{L}\p{N}_])#sponsoredcontent(?![\p{L}\p{N}_])/iu;

export function hasSponsoredContentHashtag(caption: string): boolean {
  return SPONSORED_CONTENT_PATTERN.test(caption);
}

export function ensureSponsoredContentHashtag(
  caption: string,
  enabled = true,
): string {
  if (!enabled || hasSponsoredContentHashtag(caption)) return caption;

  const normalized = caption.trimEnd();
  return normalized
    ? `${normalized}\n\n${SPONSORED_CONTENT_HASHTAG}`
    : SPONSORED_CONTENT_HASHTAG;
}
