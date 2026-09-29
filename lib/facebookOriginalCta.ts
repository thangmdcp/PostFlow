import type { AdCtaType } from "@/lib/adCta";

export interface FacebookOriginalCtaState {
  attachmentType: string | null;
  ctaType: string | null;
  destinationUrl: string | null;
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstAttachment(payload: UnknownRecord): UnknownRecord | null {
  const attachments = record(payload.attachments);
  const data = attachments && Array.isArray(attachments.data) ? attachments.data : [];
  return record(data[0]);
}

function ctaFrom(payload: UnknownRecord, attachment: UnknownRecord | null): UnknownRecord | null {
  return record(payload.call_to_action)
    ?? record(attachment?.call_to_action)
    ?? record(attachment?.cta);
}

function destinationFromCta(cta: UnknownRecord | null): string | null {
  if (!cta) return null;
  const value = record(cta.value);
  return text(value?.link)
    ?? text(value?.url)
    ?? text(cta.link)
    ?? text(cta.url);
}

/** Extract the fields Meta exposes after a Reel/video becomes a direct-response post. */
export function facebookOriginalCtaState(payload: UnknownRecord): FacebookOriginalCtaState {
  const attachment = firstAttachment(payload);
  const cta = ctaFrom(payload, attachment);
  const target = record(attachment?.target);
  return {
    attachmentType: text(attachment?.type),
    ctaType: text(cta?.type) ?? text(cta?.call_to_action_type),
    destinationUrl: destinationFromCta(cta) ?? text(attachment?.url) ?? text(target?.url),
  };
}

function unwrapFacebookRedirect(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.hostname === "l.facebook.com" || parsed.hostname === "lm.facebook.com") {
      return parsed.searchParams.get("u") ?? value;
    }
  } catch {
    // The verifier will compare the original strings when Meta returns a
    // non-standard URL. Invalid destinations are rejected before this point.
  }
  return value;
}

export function normalizeFacebookCtaUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const unwrapped = unwrapFacebookRedirect(value.trim());
  try {
    const parsed = new URL(unwrapped);
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return unwrapped.replace(/\/$/, "");
  }
}

/** A successful mutation response is not proof. All three observable fields must match. */
export function isFacebookOriginalCtaVerified(
  state: FacebookOriginalCtaState,
  expectedType: Exclude<AdCtaType, "NO_BUTTON">,
  expectedUrl: string,
): boolean {
  return state.attachmentType === "video_direct_response"
    && state.ctaType === expectedType
    && normalizeFacebookCtaUrl(state.destinationUrl) === normalizeFacebookCtaUrl(expectedUrl);
}
