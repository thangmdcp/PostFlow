export const META_AD_MIN_MEDIA_WIDTH = 500;
export const INSTAGRAM_MEDIA_TARGET_WIDTH = 720;

/**
 * Meta rejects Instagram ad media narrower than 500px. Keep media that
 * already satisfies the requirement untouched, and give smaller media a
 * little headroom so rounding or transcoding cannot put it below the limit.
 */
export function instagramUpscaleWidth(width: number | null | undefined): number | null {
  if (!Number.isFinite(width) || Number(width) <= 0) return null;
  return Number(width) < META_AD_MIN_MEDIA_WIDTH ? INSTAGRAM_MEDIA_TARGET_WIDTH : null;
}
