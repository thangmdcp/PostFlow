// Real affiliate links are almost always shortened (s.shopee.vn/xxx) and
// carry no visible query string themselves — the ?utm_content= param only
// exists on the page the short link redirects to, set server-side by
// Shopee's own affiliate tool when the short link was created. A single
// HEAD request with redirect left "manual" reads that Location header
// without downloading the destination page.
function extractUtmContent(rawUrl: string): string | null {
  try {
    const raw = new URL(rawUrl).searchParams.get("utm_content");
    if (!raw) return null;
    // Shopee pads unused Sub_id slots with trailing "-" (e.g. "name-bai1---").
    return decodeURIComponent(raw).replace(/-+$/, "").trim() || null;
  } catch {
    return null;
  }
}

export async function resolveUtmContent(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
    });
    const location = res.headers.get("location");
    // Redirected (the normal short-link case) — utm_content lives on the
    // destination URL. Not redirected — url itself might already be the
    // long-form link with a visible ?utm_content=.
    return location ? extractUtmContent(location) : extractUtmContent(url);
  } catch {
    return extractUtmContent(url);
  }
}
