export const AD_PUBLISHER_PLATFORMS = [
  "facebook",
  "instagram",
  "messenger",
  "audience_network",
  "threads",
] as const;

export const AD_DEVICE_PLATFORMS = ["mobile", "desktop"] as const;

export type AdPublisherPlatform = (typeof AD_PUBLISHER_PLATFORMS)[number];
export type AdDevicePlatform = (typeof AD_DEVICE_PLATFORMS)[number];

export const AD_POSITIONS = {
  facebook: ["feed", "right_hand_column", "marketplace", "video_feeds", "story", "search", "instream_video", "facebook_reels", "facebook_reels_overlay", "profile_feed", "notification"],
  instagram: ["stream", "story", "explore", "explore_home", "reels", "profile_feed", "ig_search", "profile_reels"],
  messenger: ["messenger_home", "sponsored_messages", "story"],
  audience_network: ["classic", "rewarded_video"],
  threads: ["threads_stream"],
} as const satisfies Record<AdPublisherPlatform, readonly string[]>;

export interface AdPlacementConfig {
  publisherPlatforms: AdPublisherPlatform[];
  devicePlatforms: AdDevicePlatform[];
  facebookPositions: string[];
  instagramPositions: string[];
  messengerPositions: string[];
  audienceNetworkPositions: string[];
  threadsPositions: string[];
}

export const EMPTY_AD_PLACEMENTS: AdPlacementConfig = {
  publisherPlatforms: [],
  devicePlatforms: [],
  facebookPositions: [],
  instagramPositions: [],
  messengerPositions: [],
  audienceNetworkPositions: [],
  threadsPositions: [],
};

const POSITION_FIELD: Record<AdPublisherPlatform, keyof AdPlacementConfig> = {
  facebook: "facebookPositions",
  instagram: "instagramPositions",
  messenger: "messengerPositions",
  audience_network: "audienceNetworkPositions",
  threads: "threadsPositions",
};

function uniqueStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string"))]
    : [];
}

export function parseAdPlacementConfig(value: unknown): AdPlacementConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  return {
    publisherPlatforms: uniqueStrings(source.publisherPlatforms).filter((item): item is AdPublisherPlatform => AD_PUBLISHER_PLATFORMS.includes(item as AdPublisherPlatform)),
    devicePlatforms: uniqueStrings(source.devicePlatforms).filter((item): item is AdDevicePlatform => AD_DEVICE_PLATFORMS.includes(item as AdDevicePlatform)),
    facebookPositions: uniqueStrings(source.facebookPositions).filter((item) => AD_POSITIONS.facebook.includes(item as never)),
    instagramPositions: uniqueStrings(source.instagramPositions).filter((item) => AD_POSITIONS.instagram.includes(item as never)),
    messengerPositions: uniqueStrings(source.messengerPositions).filter((item) => AD_POSITIONS.messenger.includes(item as never)),
    audienceNetworkPositions: uniqueStrings(source.audienceNetworkPositions).filter((item) => AD_POSITIONS.audience_network.includes(item as never)),
    threadsPositions: uniqueStrings(source.threadsPositions).filter((item) => AD_POSITIONS.threads.includes(item as never)),
  };
}

export function validateAdPlacements(
  value: unknown,
  options: { instagramOnly?: boolean; hasInstagram?: boolean } = {},
): string | null {
  const config = parseAdPlacementConfig(value);
  if (!config) return "Hãy chọn vị trí quảng cáo.";
  if (!config.publisherPlatforms.length) return "Chọn ít nhất một nền tảng quảng cáo.";
  if (!config.devicePlatforms.length) return "Chọn ít nhất một loại thiết bị quảng cáo.";
  if (options.instagramOnly && (config.publisherPlatforms.length !== 1 || config.publisherPlatforms[0] !== "instagram")) {
    return "Quảng cáo dùng bài Instagram chỉ được phân phối trên Instagram.";
  }
  if (!options.hasInstagram && config.publisherPlatforms.some((platform) => platform === "instagram" || platform === "threads")) {
    return "Instagram và Threads yêu cầu Page đã liên kết Instagram Professional.";
  }
  for (const platform of config.publisherPlatforms) {
    if (!(config[POSITION_FIELD[platform]] as string[]).length) {
      return `Hãy chọn ít nhất một vị trí cho ${platform}.`;
    }
  }
  if (config.publisherPlatforms.includes("instagram") && config.instagramPositions.includes("explore_home") && !config.instagramPositions.includes("explore")) {
    return "Trang chủ Khám phá Instagram phải được chọn cùng vị trí Khám phá.";
  }
  return null;
}

const META_PLACEMENT_KEYS = [
  "publisher_platforms",
  "device_platforms",
  "facebook_positions",
  "instagram_positions",
  "messenger_positions",
  "audience_network_positions",
  "threads_positions",
  "whatsapp_positions",
  "oculus_positions",
] as const;

export function applyAdPlacements(
  targeting: Record<string, unknown>,
  value: AdPlacementConfig,
): Record<string, unknown> {
  const config = parseAdPlacementConfig(value) ?? EMPTY_AD_PLACEMENTS;
  const next = { ...targeting };
  for (const key of META_PLACEMENT_KEYS) delete next[key];
  next.publisher_platforms = config.publisherPlatforms;
  next.device_platforms = config.devicePlatforms;
  if (config.publisherPlatforms.includes("facebook")) next.facebook_positions = config.facebookPositions;
  if (config.publisherPlatforms.includes("instagram")) next.instagram_positions = config.instagramPositions;
  if (config.publisherPlatforms.includes("messenger")) next.messenger_positions = config.messengerPositions;
  if (config.publisherPlatforms.includes("audience_network")) next.audience_network_positions = config.audienceNetworkPositions;
  if (config.publisherPlatforms.includes("threads")) next.threads_positions = config.threadsPositions;
  return next;
}

export function placementConfigFromTargeting(targeting: unknown): AdPlacementConfig | null {
  if (!targeting || typeof targeting !== "object" || Array.isArray(targeting)) return null;
  const source = targeting as Record<string, unknown>;
  return parseAdPlacementConfig({
    publisherPlatforms: source.publisher_platforms,
    devicePlatforms: source.device_platforms,
    facebookPositions: source.facebook_positions,
    instagramPositions: source.instagram_positions,
    messengerPositions: source.messenger_positions,
    audienceNetworkPositions: source.audience_network_positions,
    threadsPositions: source.threads_positions,
  });
}
