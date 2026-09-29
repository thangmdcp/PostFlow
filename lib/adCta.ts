export const AD_CTA_TYPES = ["NO_BUTTON", "LEARN_MORE", "SHOP_NOW"] as const;

export type AdCtaType = (typeof AD_CTA_TYPES)[number];

export const AD_CTA_SCOPES = ["AD_ONLY", "AD_AND_FACEBOOK_POST"] as const;
export type AdCtaScope = (typeof AD_CTA_SCOPES)[number];

export const DEFAULT_AD_CTA_TYPE: AdCtaType = "LEARN_MORE";
export const DEFAULT_AD_CTA_SCOPE: AdCtaScope = "AD_ONLY";

export function parseAdCtaType(value: unknown): AdCtaType | null {
  return typeof value === "string" && (AD_CTA_TYPES as readonly string[]).includes(value)
    ? value as AdCtaType
    : null;
}

export function parseAdCtaScope(value: unknown): AdCtaScope | null {
  return typeof value === "string" && (AD_CTA_SCOPES as readonly string[]).includes(value)
    ? value as AdCtaScope
    : null;
}

export function resolveAdCtaScope(value: unknown): AdCtaScope {
  return parseAdCtaScope(value) ?? DEFAULT_AD_CTA_SCOPE;
}

export function validateAdCtaScope(input: {
  scope: unknown;
  ctaType: AdCtaType;
  publishToFacebook: boolean;
  publishedToPage: boolean;
}): { scope: AdCtaScope; error?: string } {
  const parsed = input.scope == null ? DEFAULT_AD_CTA_SCOPE : parseAdCtaScope(input.scope);
  if (!parsed) return { scope: DEFAULT_AD_CTA_SCOPE, error: "Phạm vi CTA không được hỗ trợ." };
  if (input.ctaType === "NO_BUTTON") return { scope: DEFAULT_AD_CTA_SCOPE };
  if (parsed === "AD_AND_FACEBOOK_POST" && (!input.publishToFacebook || !input.publishedToPage)) {
    return { scope: parsed, error: "CTA trên bài gốc chỉ dùng được với bài Facebook đăng công khai." };
  }
  return { scope: parsed };
}

export function validateAdCta(input: {
  ctaType: unknown;
  destinationUrl?: string | null;
  adsEnabled: boolean;
}): { ctaType: AdCtaType; error?: string } {
  const parsed = parseAdCtaType(input.ctaType);
  if (input.ctaType !== undefined && input.ctaType !== null && !parsed) {
    return { ctaType: DEFAULT_AD_CTA_TYPE, error: "Loại CTA quảng cáo không được hỗ trợ." };
  }
  const ctaType = parsed ?? DEFAULT_AD_CTA_TYPE;
  if (!input.adsEnabled || ctaType === "NO_BUTTON") return { ctaType };
  if (!input.destinationUrl) {
    return { ctaType, error: "CTA quảng cáo cần link affiliate đầu tiên của bài." };
  }
  try {
    const url = new URL(input.destinationUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("invalid protocol");
  } catch {
    return { ctaType, error: "Link affiliate dùng cho CTA không hợp lệ." };
  }
  return { ctaType };
}

export function adCallToAction(ctaType: AdCtaType, destinationUrl?: string | null) {
  if (ctaType === "NO_BUTTON") return undefined;
  if (!destinationUrl) throw new Error("CTA quảng cáo cần URL đích.");
  return { type: ctaType, value: { link: destinationUrl } };
}
