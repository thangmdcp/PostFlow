export const AD_CTA_TYPES = ["NO_BUTTON", "LEARN_MORE", "SHOP_NOW"] as const;

export type AdCtaType = (typeof AD_CTA_TYPES)[number];

export const DEFAULT_AD_CTA_TYPE: AdCtaType = "LEARN_MORE";

export function parseAdCtaType(value: unknown): AdCtaType | null {
  return typeof value === "string" && (AD_CTA_TYPES as readonly string[]).includes(value)
    ? value as AdCtaType
    : null;
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
