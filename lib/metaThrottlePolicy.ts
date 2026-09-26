export type MetaThrottleJobKind = "publish" | "ads" | "comment" | "story";

const BASE_SPACING_SECONDS: Record<MetaThrottleJobKind, number> = {
  publish: 2,
  ads: 20,
  comment: 3,
  story: 3,
};

export function spacingFor(kind: MetaThrottleJobKind, usage: number, accessTier?: string | null) {
  let base = BASE_SPACING_SECONDS[kind];
  if (kind === "ads" && /full|standard/i.test(accessTier ?? "")) base = 2;
  if (usage >= 80) return Math.max(30, base * 6);
  if (usage >= 60) return Math.max(10, base * 3);
  return base;
}
