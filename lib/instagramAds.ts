export const APP_DEEP_LINK_TREATMENT = "deeplink_with_web_fallback" as const;

export function restrictTargetingToInstagram(
  templateTargeting: Record<string, unknown>
): Record<string, unknown> {
  const targeting: Record<string, unknown> = {
    ...templateTargeting,
    publisher_platforms: ["instagram"],
  };
  delete targeting.facebook_positions;
  delete targeting.messenger_positions;
  delete targeting.audience_network_positions;
  // Meta removed this legacy field. Older template ad sets may still return it,
  // but sending it back now makes ad-set creation fail with subcode 1870197.
  delete targeting.targeting_optimization;
  return targeting;
}

export function buildFacebookExistingPostCreative(input: {
  name: string;
  objectStoryId: string;
  accessToken: string;
}): Record<string, unknown> {
  return {
    name: input.name,
    object_story_id: input.objectStoryId,
    // Match Meta Ads Manager's “Enable app deep linking” option: open the
    // destination app when installed, otherwise keep the website fallback.
    applink_treatment: APP_DEEP_LINK_TREATMENT,
    access_token: input.accessToken,
  };
}

export function buildInstagramExistingPostCreative(input: {
  name: string;
  pageId: string;
  instagramUserId: string;
  igPostId: string;
  destinationUrl: string;
  accessToken: string;
}): Record<string, unknown> {
  return {
    name: input.name,
    object_id: input.pageId,
    instagram_user_id: input.instagramUserId,
    source_instagram_media_id: input.igPostId,
    applink_treatment: APP_DEEP_LINK_TREATMENT,
    call_to_action: { type: "LEARN_MORE", value: { link: input.destinationUrl } },
    access_token: input.accessToken,
  };
}
