const COMMENT_IMAGE_KEYS = new Set(["commentCaptionImageUrls", "commentSharedImageUrls", "captionImageUrls", "sharedImageUrls", "imageUrls"]);

export function cloudinaryCommentPublicId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !parsed.hostname.endsWith("res.cloudinary.com")) return null;
    const parts = parsed.pathname.split("/").filter(Boolean);
    const uploadIndex = parts.indexOf("upload");
    const versionIndex = parts.findIndex((part, index) => index > uploadIndex && /^v\d+$/.test(part));
    if (uploadIndex < 0 || versionIndex < 0) return null;
    const publicId = parts.slice(versionIndex + 1).join("/").replace(/\.[^.]+$/, "");
    return publicId.startsWith("postflow/comments/") ? publicId : null;
  } catch { return null; }
}

export function collectCommentImageUrls(value: unknown): string[] {
  const found = new Set<string>();
  function visit(node: unknown, parentKey = "") {
    if (Array.isArray(node)) {
      if (COMMENT_IMAGE_KEYS.has(parentKey)) node.forEach((item) => { if (typeof item === "string" && item) found.add(item); });
      else node.forEach((item) => visit(item, parentKey));
      return;
    }
    if (!node || typeof node !== "object") return;
    Object.entries(node as Record<string, unknown>).forEach(([key, child]) => visit(child, key));
  }
  visit(value);
  return [...found];
}

export function replaceCommentImageUrls(value: unknown, replacements: Record<string, string | null>): unknown {
  function visit(node: unknown, parentKey = ""): unknown {
    if (Array.isArray(node)) {
      if (COMMENT_IMAGE_KEYS.has(parentKey)) return node.flatMap((item) => {
        if (typeof item !== "string" || !(item in replacements)) return [item];
        const replacement = replacements[item];
        return replacement ? [replacement] : [];
      });
      return node.map((item) => visit(item, parentKey));
    }
    if (!node || typeof node !== "object") return node;
    return Object.fromEntries(Object.entries(node as Record<string, unknown>).map(([key, child]) => [key, visit(child, key)]));
  }
  return visit(value);
}
