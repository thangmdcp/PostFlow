export const MAX_BATCH_LINKS = 200;
export const MAX_BANK_IMPORT = 10000;
export type BankSelection = { entryId: string; url: string; allowUsed: boolean };

export function sourceLinkKey(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) return null;
    const host = u.hostname.toLowerCase().replace(/^(www|m|mbasic|mobile)\./, "");
    if (host === "facebook.com" || host === "fb.watch") {
      const video = u.pathname.match(/\/(?:reel|videos)\/(\d+)/)?.[1] ?? u.searchParams.get("v");
      if (video) return `facebook:video:${video}`;
      const story = u.searchParams.get("story_fbid") ?? u.pathname.match(/\/posts\/([^/]+)/)?.[1];
      if (story) return `facebook:post:${u.searchParams.get("id") && /^\d+$/.test(story) ? `${u.searchParams.get("id")}:` : ""}${story}`;
    }
    if (host === "tiktok.com") {
      const id = u.pathname.match(/\/video\/(\d+)/)?.[1];
      if (id) return `tiktok:video:${id}`;
    }
    u.hostname = host;
    u.protocol = "https:";
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid$|mibextid$|ref$|refsrc$|__tn__$|__cft__|share_)/i.test(key)) u.searchParams.delete(key);
    }
    u.searchParams.sort();
    u.pathname = u.pathname.replace(/\/$/, "") || "/";
    return u.toString();
  } catch { return null; }
}

export function cleanSourceLinks(values: unknown[]): { urls: string[]; invalid: number; duplicates: number } {
  const seen = new Set<string>();
  const urls: string[] = [];
  let invalid = 0, duplicates = 0;
  for (const value of values) {
    const url = typeof value === "string" ? value.trim() : "";
    const key = sourceLinkKey(url);
    if (!key) { invalid++; continue; }
    if (seen.has(key)) { duplicates++; continue; }
    seen.add(key); urls.push(url);
  }
  return { urls, invalid, duplicates };
}
